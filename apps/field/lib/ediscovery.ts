import { type ExportItem, MAX_ATTACHMENT_BYTES, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Field Service's content for the Admin center: work orders (owned by whoever opened them, with
 * the technicians booked on them), notes and files on a job (owned by whoever wrote or added
 * them), customers and their equipment (owned by whoever entered them). Items deleted under a
 * hold are included and marked deleted.
 */
export const KINDS = ["work_order", "note", "file", "customer", "asset"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TECHS = `ARRAY(SELECT DISTINCT b.technician FROM bookings b WHERE b.work_order_id = w.id AND b.technician <> w.created_by ORDER BY 1)`;

/** Every kind as the same columns, so one search pages across all of them. */
const ITEMS = `(
  SELECT w.id, 'work_order' AS kind, w.number || ' ' || w.title AS title, w.created_by AS owner, ${TECHS} AS participants,
    w.modified_at AS at, concat_ws(' ', c.name, w.address, w.description, w.resolution, w.signed_by, w.desk_ticket) AS body,
    w.held_deleted_at AS held, w.number AS work_order
  FROM work_orders w JOIN customers c ON c.id = w.customer_id
  UNION ALL
  SELECT n.id, 'note', w.number || ' note', n.author, ARRAY(SELECT x FROM unnest(${TECHS} || ARRAY[w.created_by]) x WHERE x <> n.author ORDER BY 1),
    n.created_at, n.body, COALESCE(n.held_deleted_at, w.held_deleted_at), w.number
  FROM notes n JOIN work_orders w ON w.id = n.work_order_id WHERE NOT n.event
  UNION ALL
  SELECT f.id, 'file', f.name, f.added_by, ARRAY(SELECT x FROM unnest(${TECHS} || ARRAY[w.created_by]) x WHERE x <> f.added_by ORDER BY 1),
    f.added_at, w.number || ' ' || f.type, COALESCE(f.held_deleted_at, w.held_deleted_at), w.number
  FROM files f JOIN work_orders w ON w.id = f.work_order_id
  UNION ALL
  SELECT c.id, 'customer', c.name, c.created_by, ARRAY[]::text[], c.modified_at, concat_ws(' ', c.email, c.phone, c.address, c.notes), c.held_deleted_at, NULL
  FROM customers c
  UNION ALL
  SELECT a.id, 'asset', a.name, a.created_by, ARRAY[]::text[], a.modified_at,
    concat_ws(' ', c.name, a.make, a.model, a.serial, a.location, a.ops_tag, a.notes), COALESCE(a.held_deleted_at, c.held_deleted_at), NULL
  FROM assets a JOIN customers c ON c.id = a.customer_id
) i`;

type Row = {
  id: string; kind: string; title: string; owner: string; participants: string[]; at: Date; body: string; held: Date | null;
  work_order: string | null; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.at.toISOString(),
    snippet: snippet(r.body || r.title, s.query),
    size: Buffer.byteLength(`${r.title} ${r.body ?? ""}`),
    ...(r.held ? { deleted: true } : {}),
  };
}

/** Items matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, kinds];
  const words = queryToSql(s.query, ["i.title", "i.body"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT i.*, COUNT(*) OVER () AS total FROM ${ITEMS}
     WHERE i.kind = ANY($6) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR i.owner = ANY($1) OR i.participants && $1::text[])
       AND ($2::timestamptz IS NULL OR i.at >= $2)
       AND ($3::timestamptz IS NULL OR i.at < $3)
     ORDER BY i.at DESC, i.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each item in full: a work order with its visits, steps, labor, parts and timeline; a file with its bytes. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT i.*, 0 AS total FROM ${ITEMS} WHERE i.id = ANY($1::uuid[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const item: ExportItem = {
      ...hit(r, { query: { groups: [], none: [] } }), app: APP, metadata: { workOrder: r.work_order, heldDeletedAt: r.held?.toISOString() ?? null },
      text: [r.title, r.body].filter(Boolean).join("\n"),
    };
    if (r.kind === "work_order") {
      const [w] = await q<Record<string, unknown>>(
        `SELECT w.number, w.title, w.description, w.kind, w.priority, w.status, c.name AS customer, a.name AS asset, w.address, w.contact_name,
           w.contact_phone, to_char(w.due_day, 'YYYY-MM-DD') AS due, w.desk_ticket, w.resolution, w.signed_by, w.completed_at, w.completed_by,
           w.invoice_status, w.books_number, w.invoice_total_cents, w.invoice_lines, w.created_by, w.created_at
         FROM work_orders w JOIN customers c ON c.id = w.customer_id LEFT JOIN assets a ON a.id = w.asset_id WHERE w.id = $1::uuid`,
        [r.id],
      );
      const [visits, steps, labor, parts, timeline] = await Promise.all([
        q("SELECT technician, starts_at, ends_at, status, travel_at, arrived_at, finished_at, booked_by FROM bookings WHERE work_order_id = $1::uuid ORDER BY starts_at", [r.id]),
        q("SELECT title, done_by, done_at FROM checklist WHERE work_order_id = $1::uuid ORDER BY position", [r.id]),
        q("SELECT technician, to_char(day, 'YYYY-MM-DD') AS day, minutes, rate_cents, notes FROM labor WHERE work_order_id = $1::uuid ORDER BY day", [r.id]),
        q("SELECT sku, name, unit, qty, unit_price_cents, sync_status, added_by, added_at FROM parts WHERE work_order_id = $1::uuid ORDER BY id", [r.id]),
        q("SELECT author, body, event, created_at, held_deleted_at IS NOT NULL AS deleted FROM notes WHERE work_order_id = $1::uuid ORDER BY created_at", [r.id]),
      ]);
      item.metadata = { ...w, visits, steps, labor, parts, timeline, heldDeletedAt: r.held?.toISOString() ?? null };
      const [sig] = await q<{ signature: string | null }>("SELECT signature FROM work_orders WHERE id = $1::uuid", [r.id]);
      if (sig?.signature) {
        const data = Buffer.from(sig.signature.replace(/^data:image\/png;base64,/, ""), "base64");
        item.attachments = [{ name: "signature.png", type: "image/png", size: data.length, base64: data.toString("base64") }];
      }
    } else if (r.kind === "file") {
      const [f] = await q<{ name: string; type: string; data: Buffer }>("SELECT name, type, data FROM files WHERE id = $1::uuid", [r.id]);
      const base = { name: f.name, type: f.type, size: f.data.length };
      item.attachments = [f.data.length > MAX_ATTACHMENT_BYTES ? { ...base, skipped: `Larger than ${MAX_ATTACHMENT_BYTES} bytes` } : { ...base, base64: f.data.toString("base64") }];
    } else if (r.kind === "customer") {
      const [c] = await q<Record<string, unknown>>("SELECT name, email, phone, address, notes, created_by, created_at FROM customers WHERE id = $1::uuid", [r.id]);
      item.metadata = { ...c, heldDeletedAt: r.held?.toISOString() ?? null };
    } else if (r.kind === "asset") {
      const [a] = await q<Record<string, unknown>>(
        `SELECT c.name AS customer, a.name, a.make, a.model, a.serial, a.location, to_char(a.installed_on, 'YYYY-MM-DD') AS installed_on,
           to_char(a.warranty_until, 'YYYY-MM-DD') AS warranty_until, a.ops_tag, a.notes, a.created_by, a.created_at
         FROM assets a JOIN customers c ON c.id = a.customer_id WHERE a.id = $1::uuid`,
        [r.id],
      );
      item.metadata = { ...a, heldDeletedAt: r.held?.toISOString() ?? null };
    }
    items.push(item);
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
