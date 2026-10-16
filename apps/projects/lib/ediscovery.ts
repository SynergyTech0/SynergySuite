import { type ExportItem, MAX_ATTACHMENT_BYTES, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Projects' content for the Admin center: projects (owned by whoever made them, with the team on
 * them), tasks, time entries and expenses (owned by the person who logged them).
 */
export const KINDS = ["project", "task", "time", "expense"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every kind as the same columns, so one search pages across all of them. */
const ITEMS = `(
  SELECT p.id, 'project' AS kind, p.code || ' ' || p.name AS title, p.created_by AS owner,
    ARRAY(SELECT m.email FROM members m WHERE m.project_id = p.id AND m.email <> p.created_by ORDER BY m.email) AS participants,
    p.modified_at AS at, concat_ws(' ', p.client_name, p.client_email, p.description) AS body, p.held_deleted_at AS held, p.code AS project_code
  FROM projects p
  UNION ALL
  SELECT t.id, 'task', t.title, t.created_by,
    ARRAY(SELECT DISTINCT e FROM unnest(ARRAY(SELECT m.email FROM members m WHERE m.project_id = t.project_id AND m.role = 'manager') || ARRAY[t.assigned_to]) e
      WHERE e IS NOT NULL AND e <> t.created_by ORDER BY e),
    t.modified_at, t.notes, COALESCE(t.held_deleted_at, p.held_deleted_at), p.code
  FROM tasks t JOIN projects p ON p.id = t.project_id
  UNION ALL
  SELECT e.id, 'time', p.code || ' ' || to_char(e.day, 'YYYY-MM-DD') || ' ' || round(e.minutes / 60.0, 2) || ' h' || COALESCE(' ' || k.title, ''),
    e.person, ARRAY(SELECT x FROM unnest(ARRAY[e.decided_by]) x WHERE x IS NOT NULL AND x <> e.person),
    e.modified_at, e.notes || COALESCE(' ' || e.reject_reason, ''), COALESCE(e.held_deleted_at, p.held_deleted_at), p.code
  FROM time_entries e JOIN projects p ON p.id = e.project_id LEFT JOIN tasks k ON k.id = e.task_id
  UNION ALL
  SELECT x.id, 'expense', p.code || ' ' || to_char(x.day, 'YYYY-MM-DD') || ' ' || x.category || ' ' || to_char(x.amount_cents / 100.0, 'FM999999999990.00') || ' ' || p.currency,
    x.person, ARRAY(SELECT y FROM unnest(ARRAY[x.decided_by]) y WHERE y IS NOT NULL AND y <> x.person),
    x.modified_at, concat_ws(' ', x.description, x.receipt_name, x.reject_reason), COALESCE(x.held_deleted_at, p.held_deleted_at), p.code
  FROM expenses x JOIN projects p ON p.id = x.project_id
) i`;

type Row = {
  id: string; kind: string; title: string; owner: string; participants: string[]; at: Date; body: string; held: Date | null;
  project_code: string; total: string;
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

/** Each item in full, with its project, status history and any receipt. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT i.*, 0 AS total FROM ${ITEMS} WHERE i.id = ANY($1::uuid[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const item: ExportItem = { ...hit(r, { query: { groups: [], none: [] } }), app: APP, metadata: { project: r.project_code }, text: [r.title, r.body].filter(Boolean).join("\n") };
    if (r.kind === "project") {
      const [p] = await q<Record<string, unknown>>(
        `SELECT code, name, description, client_name, client_email, status, billing, currency, to_char(start_day, 'YYYY-MM-DD') AS start,
           to_char(finish_day, 'YYYY-MM-DD') AS finish, created_by, created_at FROM projects WHERE id = $1::uuid`,
        [r.id],
      );
      const members = await q(`SELECT email, role, added_by, added_at FROM members WHERE project_id = $1::uuid ORDER BY added_at`, [r.id]);
      item.metadata = { ...p, members, heldDeletedAt: r.held?.toISOString() ?? null };
    } else if (r.kind === "task") {
      const [t] = await q<Record<string, unknown>>(
        `SELECT p.code AS project, t.title, t.notes, to_char(t.start_day, 'YYYY-MM-DD') AS start, to_char(t.finish_day, 'YYYY-MM-DD') AS finish,
           t.estimate_minutes, t.percent_done, t.assigned_to, t.milestone, t.billable, t.planner_card_id, t.created_by, t.created_at
         FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1::uuid`,
        [r.id],
      );
      item.metadata = { ...t, heldDeletedAt: r.held?.toISOString() ?? null };
    } else if (r.kind === "time") {
      const [e] = await q<Record<string, unknown>>(
        `SELECT p.code AS project, k.title AS task, e.person, to_char(e.day, 'YYYY-MM-DD') AS day, e.minutes, e.notes, e.billable, e.status,
           e.submitted_at, e.decided_by, e.decided_at, e.reject_reason, e.rate_cents, e.cost_cents, e.invoice_id IS NOT NULL AS billed, e.created_at
         FROM time_entries e JOIN projects p ON p.id = e.project_id LEFT JOIN tasks k ON k.id = e.task_id WHERE e.id = $1::uuid`,
        [r.id],
      );
      item.metadata = { ...e, heldDeletedAt: r.held?.toISOString() ?? null };
    } else {
      const [x] = await q<Record<string, unknown> & { receipt_name: string | null; receipt_type: string | null; receipt: Buffer | null }>(
        `SELECT p.code AS project, x.person, to_char(x.day, 'YYYY-MM-DD') AS day, x.category, x.description, x.amount_cents, p.currency, x.billable,
           x.status, x.submitted_at, x.decided_by, x.decided_at, x.reject_reason, x.invoice_id IS NOT NULL AS billed, x.created_at,
           x.receipt_name, x.receipt_type, x.receipt
         FROM expenses x JOIN projects p ON p.id = x.project_id WHERE x.id = $1::uuid`,
        [r.id],
      );
      const { receipt, receipt_name, receipt_type, ...rest } = x;
      item.metadata = { ...rest, receiptName: receipt_name, heldDeletedAt: r.held?.toISOString() ?? null };
      if (receipt) {
        const base = { name: receipt_name ?? "receipt", type: receipt_type ?? "application/octet-stream", size: receipt.length };
        item.attachments = [receipt.length > MAX_ATTACHMENT_BYTES ? { ...base, skipped: `Larger than ${MAX_ATTACHMENT_BYTES} bytes` } : { ...base, base64: receipt.toString("base64") }];
      }
    }
    items.push(item);
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
