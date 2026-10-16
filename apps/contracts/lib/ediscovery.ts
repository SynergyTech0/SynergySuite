import { type ExportItem, MAX_ATTACHMENT_BYTES, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Contracts' content for the Admin center: contracts (owned by their owner, with the people shared
 * on them and the approvers), obligations, files and approval decisions.
 */
export const KINDS = ["contract", "obligation", "file", "approval"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every kind as the same columns, so one search pages across all of them. */
const ITEMS = `(
  SELECT c.id, 'contract' AS kind, c.number || ' ' || c.title AS title, c.owner,
    ARRAY(SELECT DISTINCT e FROM (
      SELECT p.email AS e FROM contract_people p WHERE p.contract_id = c.id
      UNION SELECT a.approver FROM approvals a WHERE a.contract_id = c.id
      UNION SELECT c.created_by) x WHERE e <> c.owner ORDER BY e) AS participants,
    c.modified_at AS at, concat_ws(' ', c.counterparty, c.counterparty_email, c.type, c.status, c.body) AS body,
    c.held_deleted_at AS held, c.number AS contract_number
  FROM contracts c
  UNION ALL
  SELECT o.id, 'obligation', o.title, o.created_by,
    ARRAY(SELECT x FROM unnest(ARRAY[o.assignee, c.owner]) x WHERE x IS NOT NULL AND x <> o.created_by),
    o.modified_at, o.notes, COALESCE(o.held_deleted_at, c.held_deleted_at), c.number
  FROM obligations o JOIN contracts c ON c.id = o.contract_id
  UNION ALL
  SELECT f.id, 'file', f.name, f.uploaded_by,
    ARRAY(SELECT x FROM unnest(ARRAY[c.owner]) x WHERE x <> f.uploaded_by),
    f.uploaded_at, f.kind || ' ' || f.type, COALESCE(f.held_deleted_at, c.held_deleted_at), c.number
  FROM contract_files f JOIN contracts c ON c.id = f.contract_id
  UNION ALL
  SELECT a.id, 'approval', c.number || ' ' || a.status || ' by ' || a.approver, a.approver,
    ARRAY(SELECT x FROM unnest(ARRAY[a.requested_by, c.owner]) x WHERE x <> a.approver),
    COALESCE(a.decided_at, a.requested_at), a.comment, c.held_deleted_at, c.number
  FROM approvals a JOIN contracts c ON c.id = a.contract_id
) i`;

type Row = {
  id: string; kind: string; title: string; owner: string; participants: string[]; at: Date; body: string; held: Date | null;
  contract_number: string; total: string;
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

/** Each item in full: a contract with its terms, people, versions and history; files with their bytes. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT i.*, 0 AS total FROM ${ITEMS} WHERE i.id = ANY($1::uuid[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const item: ExportItem = {
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: { contract: r.contract_number },
      text: [r.title, r.body].filter(Boolean).join("\n"),
    };
    if (r.kind === "contract") {
      const [c] = await q<Record<string, unknown> & { body: string }>(
        `SELECT number, title, type, status, counterparty, counterparty_email, owner, value_cents, currency,
           to_char(start_day, 'YYYY-MM-DD') AS start, to_char(end_day, 'YYYY-MM-DD') AS "end", auto_renew, renewal_months, notice_days,
           crm_deal, sign_ref, sign_url, signed_at, terminated_at, body, created_by, created_at FROM contracts WHERE id = $1::uuid`,
        [r.id],
      );
      const { body, ...terms } = c;
      const people = await q(`SELECT email, role, added_by, added_at FROM contract_people WHERE contract_id = $1::uuid ORDER BY added_at`, [r.id]);
      const versions = await q(`SELECT n, note, author, created_at, body FROM contract_versions WHERE contract_id = $1::uuid ORDER BY n`, [r.id]);
      const events = await q(`SELECT kind, detail, actor, at FROM contract_events WHERE contract_id = $1::uuid ORDER BY at, id`, [r.id]);
      item.metadata = { ...terms, people, versions, events, heldDeletedAt: r.held?.toISOString() ?? null };
      item.text = `${c.number} ${c.title}\n\n${body}`;
    } else if (r.kind === "obligation") {
      const [o] = await q<Record<string, unknown>>(
        `SELECT c.number AS contract, o.title, o.notes, to_char(o.due_day, 'YYYY-MM-DD') AS due, o.assignee, o.done_at, o.done_by, o.created_by, o.created_at
         FROM obligations o JOIN contracts c ON c.id = o.contract_id WHERE o.id = $1::uuid`,
        [r.id],
      );
      item.metadata = { ...o, heldDeletedAt: r.held?.toISOString() ?? null };
    } else if (r.kind === "approval") {
      const [a] = await q<Record<string, unknown>>(
        `SELECT c.number AS contract, a.round, a.step, a.approver, a.status, a.comment, a.requested_by, a.requested_at, a.decided_at
         FROM approvals a JOIN contracts c ON c.id = a.contract_id WHERE a.id = $1::uuid`,
        [r.id],
      );
      item.metadata = { ...a };
    } else {
      const [f] = await q<{ contract: string; kind: string; name: string; type: string; size: number; bytes: Buffer; uploaded_by: string; uploaded_at: Date }>(
        `SELECT c.number AS contract, f.kind, f.name, f.type, f.size, f.bytes, f.uploaded_by, f.uploaded_at
         FROM contract_files f JOIN contracts c ON c.id = f.contract_id WHERE f.id = $1::uuid`,
        [r.id],
      );
      const { bytes, ...meta } = f;
      item.metadata = { ...meta, heldDeletedAt: r.held?.toISOString() ?? null };
      const base = { name: f.name, type: f.type, size: bytes.length };
      item.attachments = [bytes.length > MAX_ATTACHMENT_BYTES ? { ...base, skipped: `Larger than ${MAX_ATTACHMENT_BYTES} bytes` } : { ...base, base64: bytes.toString("base64") }];
    }
    items.push(item);
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
