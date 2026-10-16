import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * What Ops holds about people, for the Admin center: work orders (whoever raised them, and who
 * they are assigned to), maintenance orders (who reported the fault, and who works on it) and
 * assets (who has them). Ids are "<kind>:<row id>".
 */
export const KINDS = ["work_order", "maintenance", "asset"];

/** One row per piece of content, in the shape every search below filters. */
const CONTENT = `
  SELECT 'work_order:' || w.id AS id, 'work_order' AS kind, w.number || ' ' || i.sku || ' ' || i.name AS title,
    lower(w.created_by) AS owner, ARRAY_REMOVE(ARRAY[NULLIF(lower(w.assignee), '')], NULL) AS participants, w.updated_at AS date,
    concat_ws(' ', w.number, i.sku, i.name, w.notes) AS body
  FROM work_orders w JOIN items i ON i.id = w.item_id WHERE w.created_by <> ''
  UNION ALL
  SELECT 'maintenance:' || o.id, 'maintenance', o.number || ' ' || o.title,
    lower(o.requested_by), ARRAY_REMOVE(ARRAY[NULLIF(lower(o.assignee), '')], NULL), o.updated_at,
    concat_ws(' ', o.number, o.title, a.tag, a.name, o.description, o.resolution)
  FROM maint_orders o JOIN assets a ON a.id = o.asset_id WHERE o.requested_by NOT IN ('', 'scheduler') OR o.assignee <> ''
  UNION ALL
  SELECT 'asset:' || a.id, 'asset', a.tag || ' ' || a.name,
    lower(COALESCE(NULLIF(a.assignee, ''), a.created_by)), ARRAY[]::text[], a.updated_at,
    concat_ws(' ', a.tag, a.name, a.category, a.location, a.make, a.model, a.serial, a.notes)
  FROM assets a WHERE a.assignee <> '' OR a.created_by <> ''`;

type Row = { id: string; kind: string; title: string; owner: string; participants: string[]; date: Date; body: string; total?: string };

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  // Scheduled maintenance has nobody behind it; whoever does the work is who it is about.
  const owner = r.owner && r.owner !== "scheduler" ? r.owner : r.participants[0] ?? "";
  const participants = r.participants.filter((p) => p !== owner);
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    owner,
    ...(participants.length ? { participants } : {}),
    date: new Date(r.date).toISOString(),
    snippet: snippet(r.body, s.query),
    size: Buffer.byteLength(r.body),
  };
}

/** Content matching an eDiscovery search, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [kinds, s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["c.body"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT c.*, COUNT(*) OVER () AS total FROM (${CONTENT}) c
     WHERE c.kind = ANY($1::text[]) AND ${words.sql}
       AND (cardinality($2::text[]) = 0 OR c.owner = ANY($2::text[]) OR c.participants && $2::text[])
       AND ($3::timestamptz IS NULL OR c.date >= $3)
       AND ($4::timestamptz IS NULL OR c.date < $4)
     ORDER BY c.date DESC, c.id
     LIMIT $5 OFFSET $6`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

const ID = /^(work_order|maintenance|asset):(\d{1,18})$/;

/** Each item in full: the record's own fields, plus its operations, parts or work history. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => ID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT c.* FROM (${CONTENT}) c WHERE c.id = ANY($1::text[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const [, kind, raw] = ID.exec(r.id)!;
    const id = Number(raw);
    let metadata: Record<string, unknown> = {};
    if (kind === "work_order") {
      const [w] = await q("SELECT w.*, i.sku, i.name FROM work_orders w JOIN items i ON i.id = w.item_id WHERE w.id = $1", [id]);
      const ops = await q("SELECT o.seq, o.name, c.code AS work_center, o.planned_minutes, o.actual_minutes, o.status, o.done_by, o.done_at FROM wo_operations o JOIN work_centers c ON c.id = o.work_center_id WHERE o.wo_id = $1 ORDER BY o.seq", [id]);
      const mats = await q("SELECT i.sku, m.qty_required, m.qty_issued, m.cost_issued FROM wo_materials m JOIN items i ON i.id = m.item_id WHERE m.wo_id = $1 ORDER BY m.id", [id]);
      metadata = { ...w, operations: ops, materials: mats };
    } else if (kind === "maintenance") {
      const [o] = await q("SELECT o.*, a.tag, a.name AS asset_name FROM maint_orders o JOIN assets a ON a.id = o.asset_id WHERE o.id = $1", [id]);
      const parts = await q("SELECT i.sku, p.qty, p.unit_cost, p.by_email, p.added_at FROM maint_parts p JOIN items i ON i.id = p.item_id WHERE p.order_id = $1 ORDER BY p.id", [id]);
      metadata = { ...o, parts };
    } else {
      const [a] = await q("SELECT * FROM assets WHERE id = $1", [id]);
      const history = await q("SELECT number, kind, title, status, requested_by, assignee, created_at, completed_at FROM maint_orders WHERE asset_id = $1 ORDER BY id", [id]);
      const readings = await q("SELECT value, by_email, read_at FROM meter_readings WHERE asset_id = $1 ORDER BY read_at", [id]);
      metadata = { ...a, maintenance: history, meterReadings: readings };
    }
    items.push({ ...hit(r, { query: { groups: [], none: [] } }), app: APP, metadata, text: r.body });
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
