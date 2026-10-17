import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Groups' records for the Admin center: each group (owned by whoever made it, with its members as
 * participants, deleted ones included) and its change log. What people said and shared in a team
 * is Chat's and Drive's to answer for.
 */
export const KINDS = ["group", "group-change"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ITEMS = `(
  SELECT g.id::text AS id, 'group' AS kind, g.name AS title, g.created_by AS owner,
    ARRAY(SELECT m.member FROM members m WHERE m.group_id = g.id AND m.member <> g.created_by AND m.member NOT LIKE 'group:%' ORDER BY m.member) AS participants,
    g.modified_at AS at, concat_ws(' ', g.kind, g.email, g.description) AS body, g.deleted_at AS deleted
  FROM groups g
  UNION ALL
  SELECT 'a' || a.id, 'group-change', g.name || ': ' || a.action, a.actor, ARRAY[]::text[], a.at, a.detail, g.deleted_at
  FROM audit a JOIN groups g ON g.id = a.group_id
) i`;

type Row = { id: string; kind: string; title: string; owner: string; participants: string[]; at: Date; body: string; deleted: Date | null; total: string };

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
    ...(r.deleted ? { deleted: true } : {}),
  };
}

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

/** Each group with its members, channels and what it made in other apps; each change as logged. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const groupIds = ids.filter((i) => UUID.test(i));
  const auditIds = ids.filter((i) => /^a\d{1,18}$/.test(i)).map((i) => i.slice(1));
  if (!groupIds.length && !auditIds.length) return { items: [] };
  const rows = await q<Row>(
    `SELECT i.*, 0 AS total FROM ${ITEMS} WHERE (i.kind = 'group' AND i.id = ANY($1::text[])) OR (i.kind = 'group-change' AND i.id = ANY($2::text[]))`,
    [groupIds, auditIds.map((a) => `a${a}`)],
  );
  const items: ExportItem[] = [];
  for (const r of rows) {
    const item: ExportItem = { ...hit(r, { query: { groups: [], none: [] } }), app: APP, metadata: {}, text: [r.title, r.body].filter(Boolean).join("\n") };
    if (r.kind === "group") {
      const [g] = await q<Record<string, unknown>>(
        `SELECT kind, name, description, email, privacy, allow_external, created_by, created_at, deleted_at, deleted_by FROM groups WHERE id = $1::uuid`,
        [r.id],
      );
      const members = await q(`SELECT member, role, added_by, added_at FROM members WHERE group_id = $1::uuid ORDER BY added_at`, [r.id]);
      const channels = await q(`SELECT key, name, topic, created_by, created_at FROM channels WHERE group_id = $1::uuid ORDER BY position`, [r.id]);
      const resources = await q(`SELECT app, ref, name, url, status, synced_at FROM resources WHERE group_id = $1::uuid ORDER BY app`, [r.id]);
      item.metadata = { ...g, members, channels, resources };
    }
    items.push(item);
  }
  items.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
  return { items };
}
