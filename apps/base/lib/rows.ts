/**
 * Records: read a page of a table with sort, filter and search; add, change and delete records.
 * Values are keyed by field id in and out, and checked by the field's rules (lib/fields.ts)
 * before they're written.
 */
import { canEdit, ident, qualified, type TableRef } from "./catalog";
import { db } from "./db";
import { coerce, FieldValueError, isLookup, type Field } from "./fields";
import { compile, type Cols, type Condition, type FilterSpec, type SortSpec } from "./filter";
import { forbidden, HttpError, notFound } from "./http";

export type Row = {
  id: string;
  values: Record<string, unknown>;
  /** For lookup fields: the text shown for the related record (records, joined by "; "). */
  labels?: Record<string, string | null>;
  /** For multi-value lookup fields: each related record with its text, in order. */
  items?: Record<string, { id: string; label: string }[]>;
};

export const MAX_PAGE = 500;
export const MAX_BATCH = 1000;

const col = (f: Field) => `t.${ident(f.pgName)}`;
const joinAlias = (f: Field) => ident(`j_${f.id}`);

/**
 * The table with its lookups joined in, and the columns the filter code needs. Each lookup
 * field joins its target table once, aliased by the field's id, for the related record's label.
 */
function source(t: TableRef): { from: string; cols: Cols; label: (f: Field) => string | null; items: (f: Field) => string | null } {
  const joins: string[] = [];
  const shown = (f: Field, alias: string): string => {
    const d = t.lookups[f.id]?.display;
    if (!d || d.type === "autonumber") return `${alias}."id"::text`;
    const c = `${alias}.${ident(d.pgName)}`;
    return d.type === "multichoice" ? `array_to_string(${c}, '; ')` : `${c}::text`;
  };
  // A multi-value lookup's related records, in the order they were picked.
  const related = (f: Field, what: string) =>
    `(SELECT ${what} FROM unnest(${col(f)}) WITH ORDINALITY u(x, n) JOIN ${qualified(t.lookups[f.id])} r ON r."id" = u.x)`;
  const label = (f: Field): string | null => {
    const target = t.lookups[f.id];
    if (!isLookup(f) || !target) return null;
    if (f.type === "multilookup") return related(f, `string_agg(coalesce(${shown(f, "r")}, '#' || r."id"), '; ' ORDER BY u.n)`);
    return shown(f, joinAlias(f));
  };
  const items = (f: Field): string | null =>
    f.type === "multilookup" && t.lookups[f.id] ? related(f, `json_agg(json_build_object('id', r."id"::text, 'label', coalesce(${shown(f, "r")}, '#' || r."id")) ORDER BY u.n)`) : null;
  for (const f of t.fields) {
    const target = t.lookups[f.id];
    if (f.type === "lookup" && target) joins.push(`LEFT JOIN ${qualified(target)} ${joinAlias(f)} ON ${joinAlias(f)}."id" = ${col(f)}`);
  }
  return { from: `${qualified(t)} t ${joins.join(" ")}`, cols: { col, label, id: `t."id"` }, label, items };
}

function selectList(t: TableRef, label: (f: Field) => string | null, items: (f: Field) => string | null): string {
  const out = [`t."id" AS "id"`];
  for (const f of t.fields) {
    out.push(`${col(f)} AS ${ident(`v_${f.id}`)}`);
    const l = label(f);
    if (l) out.push(`${l} AS ${ident(`l_${f.id}`)}`);
    const i = items(f);
    if (i) out.push(`${i} AS ${ident(`m_${f.id}`)}`);
  }
  return out.join(", ");
}

function toRow(fields: Field[], r: Record<string, unknown>): Row {
  const values: Record<string, unknown> = {};
  let labels: Record<string, string | null> | undefined;
  let items: Row["items"];
  for (const f of fields) {
    values[f.id] = r[`v_${f.id}`] ?? null;
    if (isLookup(f)) (labels ??= {})[f.id] = (r[`l_${f.id}`] as string | null) ?? null;
    if (f.type === "multilookup") (items ??= {})[f.id] = (r[`m_${f.id}`] as { id: string; label: string }[] | null) ?? [];
  }
  const row: Row = { id: String(r.id), values };
  if (labels) row.labels = labels;
  if (items) row.items = items;
  return row;
}

export async function listRows(
  t: TableRef,
  opts: { filter?: FilterSpec | null; sort?: SortSpec | null; search?: string | null; require?: Condition[] | null; offset?: number; limit?: number } = {},
): Promise<{ rows: Row[]; total: number }> {
  const params: unknown[] = [];
  const { from, cols, label, items } = source(t);
  const { where, orderBy } = compile(t.fields, cols, params, opts);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 100)), MAX_PAGE);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const [{ rows }, count] = await Promise.all([
    db().q(`SELECT ${selectList(t, label, items)} FROM ${from} WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params),
    db().q(`SELECT count(*)::int AS n FROM ${from} WHERE ${where}`, params),
  ]);
  return { rows: rows.map((r) => toRow(t.fields, r)), total: count.rows[0].n };
}

/** The records with these ids, in the order given. */
async function rowsById(t: TableRef, ids: string[], q: Queryable = db().pool): Promise<Row[]> {
  const { from, label, items } = source(t);
  const { rows } = await q.query(`SELECT ${selectList(t, label, items)} FROM ${from} WHERE t."id" = ANY($1::bigint[])`, [ids]);
  const byId = new Map(rows.map((r) => [String(r.id), toRow(t.fields, r)]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * The records a lookup field can point at, as { id, label }, for the picker in a datasheet:
 * matching `q` in the label (or the ID), sorted by label.
 */
export async function lookupChoices(t: TableRef, f: Field, q: string, limit = 50): Promise<{ id: string; label: string }[]> {
  const target = t.lookups[f.id];
  if (!isLookup(f) || !target) throw notFound();
  const d = target.display;
  const lbl = !d || d.type === "autonumber" ? `"id"::text` : d.type === "multichoice" ? `array_to_string(${ident(d.pgName)}, '; ')` : `${ident(d.pgName)}::text`;
  const params: unknown[] = [];
  let where = "true";
  if (q.trim()) {
    params.push(`%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`, q.trim());
    where = `(${lbl} ILIKE $1 OR "id"::text = $2)`;
  }
  const { rows } = await db().q(
    `SELECT "id", ${lbl} AS label FROM ${qualified(target)} WHERE ${where} ORDER BY lower(${lbl}) NULLS LAST, "id" LIMIT ${Math.min(Math.max(1, limit), 200)}`,
    params,
  );
  return rows.map((r) => ({ id: String(r.id), label: r.label ?? `#${r.id}` }));
}

/** Every record matching the view, for export; read in pages so memory stays flat. */
export async function* allRows(t: TableRef, opts: { filter?: FilterSpec | null; sort?: SortSpec | null; search?: string | null } = {}) {
  for (let offset = 0; ; offset += MAX_PAGE) {
    const { rows } = await listRows(t, { ...opts, offset, limit: MAX_PAGE });
    for (const r of rows) yield r;
    if (rows.length < MAX_PAGE) return;
  }
}

function writable(t: TableRef) {
  if (!canEdit(t.role)) throw forbidden("You can view this database but not change it");
}

/** Checked values for the fields named in `values`; unknown field ids are refused. */
function prepare(t: TableRef, values: Record<string, unknown>, isNew: boolean): { cols: string[]; vals: unknown[] } {
  if (!values || typeof values !== "object") throw new HttpError(400, "Expected values");
  const byId = new Map(t.fields.map((f) => [f.id, f]));
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [id, raw] of Object.entries(values)) {
    const f = byId.get(id);
    if (!f) throw new HttpError(400, "A value names a field that doesn't exist");
    if (f.type === "autonumber") continue;
    const v = coerce(f, raw);
    if (v === null && f.required) throw new FieldValueError(`${f.name} is required`);
    cols.push(ident(f.pgName));
    vals.push(v);
  }
  if (isNew) {
    for (const f of t.fields) {
      if (f.type === "autonumber" || id(values, f.id)) continue;
      if (f.options.defaultValue !== undefined) {
        cols.push(ident(f.pgName));
        vals.push(f.options.defaultValue);
      } else if (f.required) {
        throw new FieldValueError(`${f.name} is required`);
      }
    }
  }
  return { cols, vals };
}

const id = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export async function insertRows(t: TableRef, email: string, records: Record<string, unknown>[]): Promise<Row[]> {
  writable(t);
  if (!Array.isArray(records) || records.length === 0) throw new HttpError(400, "Expected records");
  if (records.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} records at a time`);
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const ids: string[] = [];
    for (const values of records) {
      const { cols, vals } = prepare(t, values, true);
      const all = [...cols, `"created_by"`, `"updated_by"`];
      const params = [...vals, email, email];
      const { rows } = await client.query(
        `INSERT INTO ${qualified(t)} (${all.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        params,
      );
      ids.push(String(rows[0].id));
    }
    const out = await rowsById(t, ids, client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function rowId(raw: unknown): string {
  const s = String(raw);
  if (!/^\d{1,18}$/.test(s)) throw notFound();
  return s;
}

export async function updateRow(t: TableRef, email: string, idRaw: unknown, values: Record<string, unknown>): Promise<Row> {
  writable(t);
  const { cols, vals } = prepare(t, values, false);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  sets.push(`"updated_at" = now()`, `"updated_by" = $${vals.length + 2}`);
  const { rows } = await db().q(
    `UPDATE ${qualified(t)} SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
    [rowId(idRaw), ...vals, email],
  );
  if (!rows[0]) throw notFound();
  return (await rowsById(t, [String(rows[0].id)]))[0];
}

export async function deleteRows(t: TableRef, ids: unknown[]): Promise<number> {
  writable(t);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH) throw new HttpError(400, `Send 1 to ${MAX_BATCH} record ids`);
  const { rows } = await db().q(`DELETE FROM ${qualified(t)} WHERE id = ANY($1::bigint[]) RETURNING id`, [ids.map(rowId)]);
  // Their comments go with them (records deleted by a lookup's cascade keep theirs, unseen).
  if (rows.length) await db().q(`DELETE FROM base_comments WHERE table_id = $1 AND row_id = ANY($2::bigint[])`, [t.id, rows.map((r) => r.id)]);
  return rows.length;
}
