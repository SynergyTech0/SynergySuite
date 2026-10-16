import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/** Engage's content for the Admin center: posts, and the replies people wrote on them. */
export const KINDS = ["post", "comment"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Posts and replies as one list. A post's people are the ones it names or praises and everyone who
 * replied; a reply's are the post's author and anyone it names. Deleted-under-hold rows are included.
 */
const ITEMS = `(
  SELECT 'post' AS kind, p.id, p.author AS owner, NULLIF(p.title, '') AS title, p.body,
    ARRAY(SELECT DISTINCT e FROM unnest(p.mentions || p.praised || ARRAY(SELECT cm.author FROM comments cm WHERE cm.post_id = p.id)) e
      WHERE e <> p.author ORDER BY e) AS participants,
    COALESCE(p.edited_at, p.created_at) AS at, p.held_deleted_at IS NOT NULL OR c.held_deleted_at IS NOT NULL AS deleted,
    c.name AS community, p.id AS post_id
  FROM posts p LEFT JOIN communities c ON c.id = p.community_id
  UNION ALL
  SELECT 'comment', cm.id, cm.author, NULL, cm.body,
    ARRAY(SELECT DISTINCT e FROM unnest(cm.mentions || ARRAY[p.author]) e WHERE e <> cm.author ORDER BY e),
    COALESCE(cm.edited_at, cm.created_at), cm.held_deleted_at IS NOT NULL OR p.held_deleted_at IS NOT NULL OR c.held_deleted_at IS NOT NULL,
    c.name, p.id
  FROM comments cm JOIN posts p ON p.id = cm.post_id LEFT JOIN communities c ON c.id = p.community_id
)`;

type Row = {
  kind: "post" | "comment"; id: string; owner: string; title: string | null; body: string; participants: string[];
  at: Date; deleted: boolean; community: string | null; post_id: string; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const first = r.body.split("\n")[0].slice(0, 120);
  return {
    id: r.id,
    kind: r.kind,
    title: r.title || (r.kind === "comment" ? `Reply: ${first}` : first) || "Post",
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.at.toISOString(),
    snippet: snippet(r.body || r.title, s.query),
    size: Buffer.byteLength(`${r.title ?? ""} ${r.body}`),
    ...(r.deleted ? { deleted: true } : {}),
  };
}

/** Posts and replies matching an eDiscovery search, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, kinds];
  const words = queryToSql(s.query, ["i.title", "i.body", "i.community"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT i.*, COUNT(*) OVER () AS total FROM ${ITEMS} i
     WHERE i.kind = ANY($6) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR i.owner = ANY($1) OR i.participants && $1::text[])
       AND ($2::timestamptz IS NULL OR i.at >= $2)
       AND ($3::timestamptz IS NULL OR i.at < $3)
     ORDER BY i.at DESC, i.id LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each post or reply in full: the post's poll, praise and replies, or the post a reply is on. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    community_id: string | null; created_at: Date; post_kind: string; topics: string[]; praised: string[]; badge: string | null;
    announcement: boolean; parent_id: string | null; post_title: string; post_author: string;
    replies: { author: string; body: string; at: string; deleted: boolean }[] | null;
    poll: { label: string; votes: number }[] | null;
  }>(
    `SELECT i.*, 0 AS total, p.community_id, p.created_at, p.kind AS post_kind, p.topics, p.praised, p.badge, p.announcement,
       p.title AS post_title, p.author AS post_author,
       (SELECT cm.parent_id FROM comments cm WHERE cm.id = i.id) AS parent_id,
       CASE WHEN i.kind = 'post' THEN (SELECT json_agg(json_build_object('author', cm.author, 'body', cm.body, 'at', cm.created_at,
         'deleted', cm.held_deleted_at IS NOT NULL) ORDER BY cm.created_at) FROM comments cm WHERE cm.post_id = p.id) END AS replies,
       CASE WHEN i.kind = 'post' THEN (SELECT json_agg(json_build_object('label', o.label,
         'votes', (SELECT count(*) FROM poll_votes v WHERE v.option_id = o.id)) ORDER BY o.position) FROM poll_options o WHERE o.post_id = p.id) END AS poll
     FROM ${ITEMS} i JOIN posts p ON p.id = i.post_id WHERE i.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => {
    const base = { ...hit(r, { query: { groups: [], none: [] } }), app: APP };
    if (r.kind === "comment") {
      return {
        ...base,
        metadata: { postId: r.post_id, postTitle: r.post_title, postAuthor: r.post_author, parentId: r.parent_id, community: r.community },
        text: r.body,
      };
    }
    const replies = r.replies ?? [];
    return {
      ...base,
      metadata: {
        kind: r.post_kind,
        community: r.community,
        communityId: r.community_id,
        createdAt: r.created_at.toISOString(),
        topics: r.topics,
        praised: r.praised,
        badge: r.badge,
        announcement: r.announcement,
        poll: r.poll,
        replies,
      },
      text: [r.title, r.body, ...replies.map((x) => `${x.author}: ${x.body}`)].filter(Boolean).join("\n"),
    };
  });
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
