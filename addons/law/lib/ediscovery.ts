import { type ExportItem, MAX_ATTACHMENT_BYTES, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Law's content for the Admin center: matters (owned by the responsible lawyer, with the team),
 * clients, case documents, time and expense entries, trust transactions and conflict checks.
 */
export const KINDS = ["matter", "client", "document", "time", "trust", "conflict_check"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ITEMS = `(
  SELECT m.id, 'matter' AS kind, m.number || ' ' || m.title AS title, m.responsible AS owner,
    ARRAY(SELECT DISTINCT e FROM (SELECT p.email AS e FROM matter_people p WHERE p.matter_id = m.id UNION SELECT m.created_by) x
      WHERE e <> m.responsible ORDER BY e) AS participants,
    m.modified_at AS at, concat_ws(' ', c.name, m.practice_area, m.court, m.case_number, m.status, m.description) AS body,
    m.held_deleted_at AS held, m.number AS matter_number
  FROM matters m JOIN clients c ON c.id = m.client_id
  UNION ALL
  SELECT c.id, 'client', c.name, c.created_by, ARRAY[]::text[], c.modified_at,
    concat_ws(' ', c.email, c.phone, c.address, c.notes, array_to_string(c.aliases, ' ')), c.held_deleted_at, NULL
  FROM clients c
  UNION ALL
  SELECT d.id, 'document', d.name, d.uploaded_by, ARRAY(SELECT x FROM unnest(ARRAY[m.responsible]) x WHERE x <> d.uploaded_by),
    d.uploaded_at, d.text, COALESCE(d.held_deleted_at, m.held_deleted_at), m.number
  FROM documents d JOIN matters m ON m.id = d.matter_id
  UNION ALL
  SELECT t.id, 'time', m.number || ' ' || t.kind || ' ' || to_char(t.day, 'YYYY-MM-DD'), t.who,
    ARRAY(SELECT x FROM unnest(ARRAY[m.responsible]) x WHERE x <> t.who), t.modified_at, t.description, m.held_deleted_at, m.number
  FROM time_entries t JOIN matters m ON m.id = t.matter_id
  UNION ALL
  SELECT x.id, 'trust', 'Trust ' || replace(x.kind, '_', ' ') || ' ' || (x.amount_cents / 100.0)::numeric(14,2) || ' ' || c.name, x.entered_by,
    ARRAY(SELECT e FROM unnest(ARRAY[m.responsible, x.voided_by]) e WHERE e IS NOT NULL AND e <> x.entered_by), x.entered_at,
    concat_ws(' ', x.party, x.reference, x.memo, x.void_reason), NULL::timestamptz, m.number
  FROM trust_txns x JOIN clients c ON c.id = x.client_id LEFT JOIN matters m ON m.id = x.matter_id
  UNION ALL
  SELECT k.id, 'conflict_check', 'Conflict check: ' || array_to_string(k.names, ', '), k.checked_by,
    ARRAY(SELECT e FROM unnest(ARRAY[k.decided_by]) e WHERE e IS NOT NULL AND e <> k.checked_by), k.checked_at,
    concat_ws(' ', k.decision, k.note), NULL::timestamptz, m.number
  FROM conflict_checks k LEFT JOIN matters m ON m.id = k.matter_id
) i`;

type Row = {
  id: string; kind: string; title: string; owner: string; participants: string[]; at: Date; body: string; held: Date | null;
  matter_number: string | null; total: string;
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

/** Each item in full; a matter with its team, parties, deadlines and history; documents with their bytes. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT i.*, 0 AS total FROM ${ITEMS} WHERE i.id = ANY($1::uuid[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const item: ExportItem = {
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: r.matter_number ? { matter: r.matter_number } : {},
      text: [r.title, r.body].filter(Boolean).join("\n"),
    };
    const held = { heldDeletedAt: r.held?.toISOString() ?? null };
    if (r.kind === "matter") {
      const [m] = await q<Record<string, unknown>>(
        `SELECT m.number, m.title, c.name AS client, m.practice_area, m.jurisdiction, m.court, m.case_number, m.description, m.status, m.fee_type,
           m.rate_cents, m.flat_cents, m.contingency_pct, m.currency, m.engagement_signed_on, m.opened_on, m.closed_on, m.responsible,
           m.ai_brief, m.created_by, m.created_at
         FROM matters m JOIN clients c ON c.id = m.client_id WHERE m.id = $1`,
        [r.id],
      );
      const people = await q(`SELECT email, role, rate_cents, added_by, added_at FROM matter_people WHERE matter_id = $1 ORDER BY added_at`, [r.id]);
      const parties = await q(`SELECT name, kind, role, notes, added_by, added_at FROM matter_parties WHERE matter_id = $1 ORDER BY added_at`, [r.id]);
      const deadlines = await q(`SELECT title, due_day, basis, assignee, done_at, done_by, created_by, created_at FROM deadlines WHERE matter_id = $1 ORDER BY due_day`, [r.id]);
      const bills = await q(`SELECT number, status, through_day, total_cents, currency, lines, books_number, created_by, created_at FROM bills WHERE matter_id = $1 ORDER BY created_at`, [r.id]);
      const events = await q(`SELECT kind, detail, actor, at FROM matter_events WHERE matter_id = $1 ORDER BY at, id`, [r.id]);
      item.metadata = { ...m, people, parties, deadlines, bills, events, ...held };
    } else if (r.kind === "client") {
      const [c] = await q<Record<string, unknown>>(`SELECT kind, name, aliases, email, phone, address, notes, status, created_by, created_at FROM clients WHERE id = $1`, [r.id]);
      item.metadata = { ...c, ...held };
    } else if (r.kind === "time") {
      const [t] = await q<Record<string, unknown>>(
        `SELECT m.number AS matter, t.kind, t.who, t.day, t.minutes, t.rate_cents, t.amount_cents, t.description, t.billable, b.number AS bill, t.created_at
         FROM time_entries t JOIN matters m ON m.id = t.matter_id LEFT JOIN bills b ON b.id = t.bill_id WHERE t.id = $1`,
        [r.id],
      );
      item.metadata = { ...t };
    } else if (r.kind === "trust") {
      const [t] = await q<Record<string, unknown>>(
        `SELECT a.name AS account, c.name AS client, m.number AS matter, x.kind, x.amount_cents, x.day, x.received_on, x.party, x.reference, x.memo,
           b.number AS bill, x.entered_by, x.entered_at, x.voided_at, x.voided_by, x.void_reason
         FROM trust_txns x JOIN trust_accounts a ON a.id = x.account_id JOIN clients c ON c.id = x.client_id
         LEFT JOIN matters m ON m.id = x.matter_id LEFT JOIN bills b ON b.id = x.bill_id WHERE x.id = $1`,
        [r.id],
      );
      item.metadata = { ...t };
    } else if (r.kind === "conflict_check") {
      const [k] = await q<Record<string, unknown>>(
        `SELECT names, results, hits, decision, note, checked_by, checked_at, decided_by, decided_at FROM conflict_checks WHERE id = $1`,
        [r.id],
      );
      item.metadata = { ...k, matter: r.matter_number };
    } else {
      const [d] = await q<{ matter: string; name: string; type: string; size: number; pages: number | null; analysis: unknown; bytes: Buffer; text: string; uploaded_by: string; uploaded_at: Date }>(
        `SELECT m.number AS matter, d.name, d.type, d.size, d.pages, d.analysis, d.bytes, d.text, d.uploaded_by, d.uploaded_at
         FROM documents d JOIN matters m ON m.id = d.matter_id WHERE d.id = $1`,
        [r.id],
      );
      const { bytes, text, ...meta } = d;
      item.metadata = { ...meta, ...held };
      item.text = text;
      const base = { name: d.name, type: d.type, size: bytes.length };
      item.attachments = [bytes.length > MAX_ATTACHMENT_BYTES ? { ...base, skipped: `Larger than ${MAX_ATTACHMENT_BYTES} bytes` } : { ...base, base64: bytes.toString("base64") }];
    }
    items.push(item);
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
