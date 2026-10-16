/**
 * The query designer's definition (Access's design grid) and its translation to SQL over the
 * database's views. It runs in the browser, to show the SQL as the grid changes, and on the
 * server, where the SQL then goes through the same checks as any other query (lib/sql.ts).
 *
 * Criteria use Access's own syntax: `>100`, `"Smith"`, `Like "S*"`, `Between #1/1/2026# And
 * #3/31/2026#`, `Is Null`, `In ("a", "b")`, `Not "x"`, `>5 And <10`, `Date()`. Several criteria
 * rows are alternatives (OR); criteria in the same row must all hold (AND).
 */
import type { Field } from "./fields";
import { quoteName } from "./names";

export const TOTALS = ["group", "sum", "avg", "min", "max", "count", "stddev", "var", "where"] as const;
export type Total = (typeof TOTALS)[number];

export const TOTAL_LABELS: Record<Total, string> = {
  group: "Group By",
  sum: "Sum",
  avg: "Avg",
  min: "Min",
  max: "Max",
  count: "Count",
  stddev: "StDev",
  var: "Var",
  where: "Where",
};

/** How two tables in the query are joined: Access's join properties 1, 2 and 3. */
export type JoinKind = "inner" | "many" | "one";

export type QueryColumn = {
  /** A field of one of the query's tables, or an expression. */
  table?: string;
  field?: string;
  expression?: string;
  /** Heading in the results (Access's "Alias: [Field]"). */
  alias?: string;
  total?: Total;
  sort?: "asc" | "desc";
  show?: boolean;
  /** One entry per criteria row; rows are ORed. */
  criteria?: string[];
};

export type QueryDef = {
  /** Table ids, in the order they were added; the first is the FROM. */
  tables: string[];
  /** Join kind per lookup field id joining two of the tables (inner when absent). */
  joins?: Record<string, JoinKind>;
  columns: QueryColumn[];
  totals?: boolean;
  distinct?: boolean;
  /** Access's Top Values. */
  limit?: number;
};

export type DesignTable = { id: string; name: string; fields: Field[] };

export class DesignError extends Error {
  status = 400;
}

const AGG_SQL: Record<string, string> = { sum: "sum", avg: "avg", min: "min", max: "max", count: "count", stddev: "stddev_samp", var: "var_samp" };

const NUMBER: Field = { id: "", name: "", pgName: "", type: "number", options: {}, required: false, description: "", position: 0 };

const TEXTUAL = new Set(["text", "longtext", "choice", "email", "hyperlink", "phone"]);

/** A relationship the query can join on: a lookup field from one of its tables to another. */
export type Link = { fieldId: string; from: string; to: string; fieldName: string };

export function linksBetween(tables: DesignTable[], ids: string[]): Link[] {
  const set = new Set(ids);
  return tables
    .filter((t) => set.has(t.id))
    .flatMap((t) =>
      t.fields
        .filter((f) => (f.type === "lookup" || f.type === "multilookup") && f.options.targetTable && set.has(f.options.targetTable) && f.options.targetTable !== t.id)
        .map((f) => ({ fieldId: f.id, from: t.id, to: f.options.targetTable!, fieldName: f.name })),
    );
}

/** The SQL for a designer definition. */
export function designSql(def: QueryDef, all: DesignTable[]): string {
  const byId = new Map(all.map((t) => [t.id, t]));
  const tables = [...new Set(def.tables)].map((id) => {
    const t = byId.get(id);
    if (!t) throw new DesignError("A table in the query no longer exists");
    return t;
  });
  if (!tables.length) throw new DesignError("Add a table to the query");
  const tq = (t: DesignTable) => quoteName(t.name);
  const fq = (t: DesignTable, f: Field) => `${tq(t)}.${quoteName(f.name)}`;

  // FROM and joins, following lookups between the tables in the order they were added.
  const links = linksBetween(all, tables.map((t) => t.id));
  const placed = [tables[0]];
  let from = tq(tables[0]);
  const pending = tables.slice(1);
  while (pending.length) {
    const i = pending.findIndex((t) => links.some((l) => (l.from === t.id && placed.some((p) => p.id === l.to)) || (l.to === t.id && placed.some((p) => p.id === l.from))));
    if (i < 0) throw new DesignError(`${pending[0].name} isn't related to the other tables; add a Lookup field between them or remove it`);
    const t = pending.splice(i, 1)[0];
    const on = links.filter((l) => (l.from === t.id && placed.some((p) => p.id === l.to)) || (l.to === t.id && placed.some((p) => p.id === l.from)));
    const kind = def.joins?.[on[0].fieldId] ?? "inner";
    // "many" keeps every record of the table holding the lookup; "one" every record it looks up.
    const keepNew = (kind === "many" && on[0].from === t.id) || (kind === "one" && on[0].to === t.id);
    const keepPlaced = kind !== "inner" && !keepNew;
    const join = keepNew ? "RIGHT JOIN" : keepPlaced ? "LEFT JOIN" : "JOIN";
    const cond = on
      .map((l) => {
        const a = byId.get(l.from)!;
        const b = byId.get(l.to)!;
        const lookup = a.fields.find((f) => f.id === l.fieldId)!;
        const id = b.fields.find((f) => f.type === "autonumber")!;
        return lookup.type === "multilookup" ? `${fq(b, id)} = ANY(${fq(a, lookup)})` : `${fq(a, lookup)} = ${fq(b, id)}`;
      })
      .join(" AND ");
    from += ` ${join} ${tq(t)} ON ${cond}`;
    placed.push(t);
  }

  const totals = !!def.totals;
  const select: string[] = [];
  const where: string[][] = [];
  const having: string[][] = [];
  const group: string[] = [];
  const order: string[] = [];
  const rows = Math.max(0, ...def.columns.map((c) => c.criteria?.length ?? 0));
  for (let r = 0; r < rows; r++) {
    where.push([]);
    having.push([]);
  }
  def.columns.forEach((c, i) => {
    let expr: string;
    let field: Field | null = null;
    let name: string;
    if (typeof c.expression === "string") {
      if (!c.expression.trim()) throw new DesignError(`Write the expression for ${c.alias?.trim() || `column ${i + 1}`}`);
      expr = `(${c.expression.trim()})`;
      name = c.alias?.trim() || `Expr${i + 1}`;
    } else {
      const t = tables.find((x) => x.id === c.table);
      if (!t) throw new DesignError("A column's table isn't in the query");
      if (c.field === "*") {
        if (totals) throw new DesignError("Pick fields one by one in a totals query");
        if (c.show !== false) select.push(`${tq(t)}.*`);
        return;
      }
      field = t.fields.find((f) => f.id === c.field) ?? null;
      if (!field) throw new DesignError(`A field in the query no longer exists in ${t.name}`);
      expr = fq(t, field);
      name = c.alias?.trim() || field.name;
    }
    const total: Total = totals ? c.total ?? "group" : "group";
    const agg = totals && total !== "group" && total !== "where";
    const out = agg ? `${AGG_SQL[total]}(${expr})` : expr;
    if (agg && !c.alias?.trim()) name = `${TOTAL_LABELS[total]}Of${name.replace(/\s+/g, "")}`;
    const show = c.show !== false && total !== "where";
    if (show) select.push(out === expr && field && name === field.name ? out : `${out} AS ${quoteName(name)}`);
    if (totals && total === "group") group.push(expr);
    (c.criteria ?? []).forEach((text, r) => {
      if (!text?.trim()) return;
      // Totals other than Min and Max are numbers whatever they total.
      const typed = !agg || total === "min" || total === "max" ? field : NUMBER;
      const cond = criteriaSql(text, agg ? out : expr, typed);
      (agg ? having : where)[r].push(cond);
    });
    if (c.sort) order.push(`${out} ${c.sort === "desc" ? "DESC" : "ASC"}`);
  });
  if (!select.length) throw new DesignError("Show at least one field");

  const anyOf = (rs: string[][]) => {
    const parts = rs.filter((r) => r.length).map((r) => r.join(" AND "));
    if (!parts.length) return "";
    return parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(" OR ");
  };
  // A row of criteria with only aggregate conditions still filters groups; one with both splits
  // into WHERE and HAVING, as Access does.
  const w = anyOf(where);
  const h = anyOf(having);
  let sql = `SELECT ${def.distinct ? "DISTINCT " : ""}${select.join(", ")}\nFROM ${from}`;
  if (w) sql += `\nWHERE ${w}`;
  if (totals && group.length) sql += `\nGROUP BY ${group.join(", ")}`;
  if (h) sql += `\nHAVING ${h}`;
  if (order.length) sql += `\nORDER BY ${order.join(", ")}`;
  if (def.limit && Number.isInteger(def.limit) && def.limit > 0) sql += `\nLIMIT ${def.limit}`;
  return sql;
}

// ---- Criteria ------------------------------------------------------------------------

type Tok = { t: "str" | "date" | "num" | "word" | "op" | "punct"; v: string };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < text.length) {
        if (text[j] === ch && text[j + 1] === ch) {
          s += ch;
          j += 2;
        } else if (text[j] === ch) break;
        else s += text[j++];
      }
      if (j >= text.length) throw new DesignError(`A quote isn't closed in the criteria ${text}`);
      out.push({ t: "str", v: s });
      i = j + 1;
    } else if (ch === "#") {
      const j = text.indexOf("#", i + 1);
      if (j < 0) throw new DesignError(`A date isn't closed with # in the criteria ${text}`);
      out.push({ t: "date", v: text.slice(i + 1, j).trim() });
      i = j + 1;
    } else if (/[0-9.]/.test(ch) || (ch === "-" && /[0-9.]/.test(text[i + 1] ?? "") && (out.length === 0 || out[out.length - 1].t === "op" || out[out.length - 1].v === "(" || out[out.length - 1].v === ","))) {
      const m = text.slice(i).match(/^-?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?/i)!;
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
    } else if (/[<>=!]/.test(ch)) {
      const m = text.slice(i).match(/^(<>|<=|>=|!=|<|>|=)/);
      if (!m) throw new DesignError(`Can't read the criteria ${text}`);
      out.push({ t: "op", v: m[0] === "!=" ? "<>" : m[0] });
      i += m[0].length;
    } else if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ t: "punct", v: ch });
      i++;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      out.push({ t: "word", v: m[0] });
      i += m[0].length;
    } else {
      throw new DesignError(`Can't read "${ch}" in the criteria ${text}`);
    }
  }
  return out;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** An Access date (#3/31/2026#, #2026-03-31#, with an optional time) as an ISO literal. */
function dateLit(v: string): string {
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(.+))?$/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    const d = `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return lit(us[4] ? `${d} ${us[4]}` : d);
  }
  if (/^\d{4}-\d{2}-\d{2}([ T][\d:.]+)?$/.test(v)) return lit(v);
  throw new DesignError(`#${v}# isn't a date; write it as #3/31/2026# or #2026-03-31#`);
}

/** Turns a criteria text into a condition on `expr`. */
export function criteriaSql(text: string, expr: string, field: Field | null): string {
  const toks = tokens(text);
  let p = 0;
  const peek = () => toks[p];
  const word = (w: string) => peek()?.t === "word" && peek().v.toLowerCase() === w;
  const take = () => toks[p++];
  const expectWord = (w: string) => {
    if (!word(w)) throw new DesignError(`Expected ${w.toUpperCase()} in the criteria ${text}`);
    p++;
  };
  const textual = !!field && TEXTUAL.has(field.type);
  const yesno = field?.type === "yesno";

  const value = (): string => {
    const tok = take();
    if (!tok) throw new DesignError(`The criteria ${text} ends too soon`);
    if (tok.t === "str") return lit(tok.v);
    if (tok.t === "date") return dateLit(tok.v);
    if (tok.t === "num") return field && !textual ? tok.v : lit(tok.v);
    if (tok.t === "word") {
      const w = tok.v.toLowerCase();
      if (w === "true" || w === "yes" || w === "on") return "true";
      if (w === "false" || w === "no" || w === "off") return "false";
      if (w === "null") return "NULL";
      if ((w === "date" || w === "now" || w === "time") && peek()?.v === "(") {
        take();
        if (take()?.v !== ")") throw new DesignError(`${tok.v}() takes nothing between the brackets`);
        return w === "date" ? "current_date" : w === "now" ? "now()" : "localtime";
      }
      // A bare word, as Access allows for text: Smith means "Smith".
      return lit(tok.v);
    }
    throw new DesignError(`Can't read the criteria ${text}`);
  };
  const ci = (v: string) => (textual && v.startsWith("'") ? `lower(${v})` : v);
  const left = textual ? `lower(${expr})` : expr;

  const term = (): string => {
    if (word("not")) {
      p++;
      if (word("like") || word("in") || word("between")) return `NOT (${term()})`;
      if (word("is")) throw new DesignError("Write Is Not Null");
      return `${left} <> ${ci(value())}`;
    }
    if (word("is")) {
      p++;
      const not = word("not");
      if (not) p++;
      expectWord("null");
      return `${expr} IS ${not ? "NOT " : ""}NULL`;
    }
    if (word("like")) {
      p++;
      const tok = take();
      if (tok?.t !== "str") throw new DesignError('Like needs a pattern in quotes, such as Like "S*"');
      const pattern = tok.v.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "%").replace(/\?/g, "_");
      return `${expr}::text ILIKE ${lit(pattern)}`;
    }
    if (word("between")) {
      p++;
      const a = value();
      expectWord("and");
      const b = value();
      return `${expr} BETWEEN ${a} AND ${b}`;
    }
    if (word("in")) {
      p++;
      if (take()?.v !== "(") throw new DesignError('In needs a list in brackets, such as In ("a", "b")');
      const vals = [ci(value())];
      while (peek()?.v === ",") {
        take();
        vals.push(ci(value()));
      }
      if (take()?.v !== ")") throw new DesignError("The In list isn't closed");
      return `${left} IN (${vals.join(", ")})`;
    }
    if (peek()?.t === "op") {
      const op = take().v;
      const v = value();
      if (v === "NULL") return `${expr} IS ${op === "<>" ? "NOT " : ""}NULL`;
      return op === "=" || op === "<>" ? `${left} ${op} ${ci(v)}` : `${expr} ${op} ${v}`;
    }
    const v = value();
    if (v === "NULL") return `${expr} IS NULL`;
    if (yesno && (v === "true" || v === "false")) return `${expr} = ${v}`;
    return `${left} = ${ci(v)}`;
  };
  const and = (): string => {
    const parts = [term()];
    while (word("and")) {
      p++;
      parts.push(term());
    }
    return parts.length > 1 ? `(${parts.join(" AND ")})` : parts[0];
  };
  const parts = [and()];
  while (word("or")) {
    p++;
    parts.push(and());
  }
  if (p < toks.length) throw new DesignError(`Can't read the end of the criteria ${text}`);
  return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
}

/** Keeps only the known parts of a definition from the browser. */
export function cleanDef(input: unknown): QueryDef {
  const d = (input ?? {}) as Record<string, any>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const tables = Array.isArray(d.tables) ? d.tables.filter((x: unknown) => typeof x === "string").slice(0, 32) : [];
  const joins: Record<string, JoinKind> = {};
  for (const [k, v] of Object.entries(d.joins ?? {})) if (v === "inner" || v === "many" || v === "one") joins[k] = v;
  const columns: QueryColumn[] = (Array.isArray(d.columns) ? d.columns : []).slice(0, 255).map((c: any) => ({
    table: str(c?.table, 40),
    field: str(c?.field, 40),
    expression: str(c?.expression, 2000),
    alias: str(c?.alias, 64),
    total: TOTALS.includes(c?.total) ? c.total : undefined,
    sort: c?.sort === "asc" || c?.sort === "desc" ? c.sort : undefined,
    show: c?.show === false ? false : undefined,
    criteria: Array.isArray(c?.criteria) ? c.criteria.slice(0, 10).map((x: unknown) => (typeof x === "string" ? x.slice(0, 500) : "")) : undefined,
  }));
  const limit = Number.isInteger(d.limit) && d.limit > 0 ? Math.min(d.limit, 1_000_000) : undefined;
  return { tables, joins, columns, totals: d.totals === true, distinct: d.distinct === true, limit };
}
