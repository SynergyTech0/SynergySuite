/**
 * Sort, filter and search for a datasheet, compiled to SQL. Fields are looked up by id in the
 * table's own field list, so only generated column names reach the SQL text; every value is a
 * parameter, converted by the field's rules first.
 */
import { coerce, type Field } from "./fields";

export const OPERATORS = ["eq", "ne", "lt", "lte", "gt", "gte", "contains", "notcontains", "startswith", "empty", "notempty"] as const;
export type Operator = (typeof OPERATORS)[number];

export type Condition = { field: string; op: Operator; value?: unknown };
export type FilterSpec = { match: "all" | "any"; conditions: Condition[] };
export type SortSpec = { field: string; dir: "asc" | "desc" }[];

export const OP_LABELS: Record<Operator, string> = {
  eq: "equals",
  ne: "does not equal",
  lt: "is less than",
  lte: "is at most",
  gt: "is greater than",
  gte: "is at least",
  contains: "contains",
  notcontains: "does not contain",
  startswith: "begins with",
  empty: "is blank",
  notempty: "is not blank",
};

const TEXTUAL = new Set(["text", "longtext", "email", "hyperlink", "phone", "choice"]);

/** Which operators make sense for a field. */
export function operatorsFor(field: Pick<Field, "type">): Operator[] {
  if (TEXTUAL.has(field.type)) return ["eq", "ne", "contains", "notcontains", "startswith", "empty", "notempty"];
  if (field.type === "multichoice") return ["contains", "notcontains", "empty", "notempty"];
  if (field.type === "yesno") return ["eq", "ne"];
  // Lookups match the related record's text first; equals/does not equal take its ID.
  if (field.type === "lookup" || field.type === "multilookup") return ["contains", "notcontains", "eq", "ne", "empty", "notempty"];
  return ["eq", "ne", "lt", "lte", "gt", "gte", "empty", "notempty"];
}

export class FilterError extends Error {
  status = 400;
}

const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Col = (f: Field) => string;

/**
 * Where columns come from. `col` is a field's own column; `label`, for lookup fields, is the
 * text shown for the related record (null when it has none); `id` is the record's ID column.
 */
export type Cols = { col: Col; label?: (f: Field) => string | null; id?: string };

/**
 * One condition as SQL. `col` returns the quoted column for a field; `p` adds a parameter and
 * returns its placeholder.
 */
function conditionSql(f: Field, c: Condition, col: string, p: (v: unknown) => string, label: string | null): string {
  if (!operatorsFor(f).includes(c.op)) throw new FilterError(`${f.name} can't be filtered with "${OP_LABELS[c.op] ?? c.op}"`);
  if ((f.type === "lookup" || f.type === "multilookup") && (c.op === "contains" || c.op === "notcontains")) {
    const text = label ?? `${col}::text`;
    const like = p(`%${escLike(String(c.value ?? ""))}%`);
    return c.op === "contains" ? `${text} ILIKE ${like}` : `(${text} IS NULL OR ${text} NOT ILIKE ${like})`;
  }
  if (c.op === "empty") return f.type === "multichoice" ? `(${col} IS NULL OR cardinality(${col}) = 0)` : TEXTUAL.has(f.type) ? `(${col} IS NULL OR ${col} = '')` : `${col} IS NULL`;
  if (c.op === "notempty") return f.type === "multichoice" ? `cardinality(${col}) > 0` : TEXTUAL.has(f.type) ? `(${col} <> '')` : `${col} IS NOT NULL`;
  if (f.type === "multilookup") {
    // Equals: the list holds that record; does not equal: it doesn't.
    let v: unknown;
    try {
      v = coerce({ ...f, type: "lookup" }, c.value);
    } catch (e) {
      throw new FilterError((e as Error).message);
    }
    if (v === null) throw new FilterError(`Enter a record ID to compare ${f.name} with`);
    return c.op === "eq" ? `${p(v)}::bigint = ANY(${col})` : `NOT (${p(v)}::bigint = ANY(coalesce(${col}, '{}')))`;
  }
  if (f.type === "multichoice") {
    const v = String(c.value ?? "").trim();
    return c.op === "contains" ? `${p(v)} = ANY(${col})` : `NOT (${p(v)} = ANY(coalesce(${col}, '{}')))`;
  }
  if (TEXTUAL.has(f.type)) {
    const v = String(c.value ?? "");
    switch (c.op) {
      case "eq":
        return `lower(${col}) = lower(${p(v)})`;
      case "ne":
        return `(${col} IS NULL OR lower(${col}) <> lower(${p(v)}))`;
      case "contains":
        return `${col} ILIKE ${p(`%${escLike(v)}%`)}`;
      case "notcontains":
        return `(${col} IS NULL OR ${col} NOT ILIKE ${p(`%${escLike(v)}%`)})`;
      case "startswith":
        return `${col} ILIKE ${p(`${escLike(v)}%`)}`;
    }
  }
  // Numbers, currency, dates, yes/no and the ID: compare typed values.
  const asField = f.type === "autonumber" ? { ...f, type: "number" as const } : f;
  let v: unknown;
  try {
    v = coerce(asField, c.value);
  } catch (e) {
    throw new FilterError((e as Error).message);
  }
  if (v === null) throw new FilterError(`Enter a value to compare ${f.name} with`);
  const sqlOp = { eq: "=", ne: "IS DISTINCT FROM", lt: "<", lte: "<=", gt: ">", gte: ">=" }[c.op as "eq"];
  return `${col} ${sqlOp} ${p(v)}`;
}

/**
 * WHERE and ORDER BY for a datasheet. `params` is appended to; placeholders continue from its
 * current length.
 */
export function compile(
  fields: Field[],
  cols: Col | Cols,
  params: unknown[],
  opts: { filter?: FilterSpec | null; sort?: SortSpec | null; search?: string | null; require?: Condition[] | null },
): { where: string; orderBy: string } {
  const { col, label = () => null, id = `"id"` } = typeof cols === "function" ? { col: cols } : cols;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const clauses: string[] = [];

  const conds = opts.filter?.conditions ?? [];
  if (conds.length > 50) throw new FilterError("At most 50 filter conditions");
  if (conds.length) {
    const parts = conds.map((c) => {
      const f = byId.get(c.field);
      if (!f) throw new FilterError("A filter refers to a field that no longer exists");
      return conditionSql(f, c, col(f), p, label(f));
    });
    clauses.push(`(${parts.join(opts.filter!.match === "any" ? " OR " : " AND ")})`);
  }

  // Conditions every record must meet whatever the filter says (a subdatasheet's link).
  for (const c of (opts.require ?? []).slice(0, 5)) {
    const f = byId.get(c.field);
    if (!f) throw new FilterError("A filter refers to a field that no longer exists");
    clauses.push(conditionSql(f, c, col(f), p, label(f)));
  }

  const q = opts.search?.trim();
  if (q) {
    const like = p(`%${escLike(q)}%`);
    const parts = fields.map((f) =>
      f.type === "multichoice" ? `array_to_string(${col(f)}, ' ') ILIKE ${like}` : `${label(f) ?? `${col(f)}::text`} ILIKE ${like}`,
    );
    clauses.push(`(${parts.join(" OR ")})`);
  }

  const order: string[] = [];
  for (const s of opts.sort ?? []) {
    const f = byId.get(s.field);
    if (!f) continue;
    const dir = s.dir === "desc" ? "DESC NULLS LAST" : "ASC NULLS LAST";
    const l = label(f);
    order.push(l ? `lower(${l}) ${dir}` : TEXTUAL.has(f.type) ? `lower(${col(f)}) ${dir}` : `${col(f)} ${dir}`);
  }
  order.push(`${id} ASC`);

  return { where: clauses.length ? clauses.join(" AND ") : "true", orderBy: order.join(", ") };
}

/** Parses the `filter` and `sort` query parameters (JSON). Bad input reads as none. */
export function parseSpec<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new FilterError("The filter or sort couldn't be read");
  }
}
