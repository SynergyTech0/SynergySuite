import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Stream's content for the Admin center: videos (with their transcript), comments on videos, and
 * video editor projects. The video files themselves are not attached to exports (they are far
 * past the protocol's attachment limit); each export says where the file is kept instead.
 */
export const KINDS = ["video", "comment", "project"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  kind: "video" | "comment" | "project";
  id: string;
  title: string;
  body: string;
  owner: string;
  participants: string[];
  date: Date;
  size: string | null;
  deleted: boolean;
  total: string;
};

/**
 * One searchable row per item. A comment's owner is its author, and the video's owner is on it
 * too; a video's participants are the people it was shared with.
 */
const ITEMS = `
  SELECT 'video' AS kind, v.id, v.title, concat_ws(' ', v.description, v.summary, v.transcript) AS body, v.owner,
    ARRAY(SELECT m.email FROM video_members m WHERE m.video_id = v.id ORDER BY m.email) AS participants,
    v.created_at AS date, v.size::text AS size, v.held_deleted_at IS NOT NULL AS deleted
  FROM videos v
  UNION ALL
  SELECT 'comment', c.id, 'Comment on ' || v.title, c.body, c.author,
    ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[v.owner]) e WHERE e <> c.author),
    c.created_at, NULL, (c.held_deleted_at IS NOT NULL OR v.held_deleted_at IS NOT NULL)
  FROM comments c JOIN videos v ON v.id = c.video_id
  UNION ALL
  SELECT 'project', p.id, p.name, '', p.owner, '{}'::text[], p.modified_at, p.size::text, p.held_deleted_at IS NOT NULL
  FROM projects p`;

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: `${r.kind}:${r.id}`,
    kind: r.kind,
    title: r.title,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.date.toISOString(),
    snippet: snippet(r.body || r.title, s.query),
    size: r.size ? Number(r.size) : Buffer.byteLength(`${r.title} ${r.body}`),
    ...(r.deleted ? { deleted: true } : {}),
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
    `SELECT i.*, COUNT(*) OVER () AS total FROM (${ITEMS}) i
     WHERE i.kind = ANY($6::text[]) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR i.owner = ANY($1) OR i.participants && $1::text[])
       AND ($2::timestamptz IS NULL OR i.date >= $2)
       AND ($3::timestamptz IS NULL OR i.date < $3)
     ORDER BY i.date DESC, i.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each item in full: a video's details, captions and comments; a comment with its video; a project's details. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids
    .map((i) => /^(video|comment|project):(.+)$/.exec(i))
    .filter((m): m is RegExpExecArray => !!m && UUID.test(m[2]))
    .map((m) => ({ kind: m[1], id: m[2].toLowerCase(), key: m[0] }));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT i.*, 0 AS total FROM (${ITEMS}) i WHERE (i.kind || ':' || i.id) = ANY($1::text[])`, [wanted.map((w) => `${w.kind}:${w.id}`)]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const base = { ...hit(r, { query: { groups: [], none: [] } }), app: APP };
    if (r.kind === "video") {
      const [v] = await q<{
        description: string; summary: string; transcript: string; captions: string | null; source_name: string; duration: number | null;
        visibility: string; share_token: string | null; origin: string; chapters: unknown; held_deleted_at: Date | null;
        comments: { author: string; body: string; at: number | null; created: string; deleted: boolean }[] | null;
      }>(
        `SELECT v.description, v.summary, v.transcript, v.captions, v.source_name, v.duration, v.visibility, v.share_token, v.origin, v.chapters, v.held_deleted_at,
           (SELECT json_agg(json_build_object('author', c.author, 'body', c.body, 'at', c.at_seconds, 'created', c.created_at, 'deleted', c.held_deleted_at IS NOT NULL) ORDER BY c.created_at)
              FROM comments c WHERE c.video_id = v.id) AS comments
         FROM videos v WHERE v.id = $1`,
        [r.id],
      );
      items.push({
        ...base,
        metadata: {
          fileName: v.source_name,
          durationSeconds: v.duration,
          origin: v.origin,
          visibility: v.visibility,
          anyoneWithLink: !!v.share_token,
          sharedWith: r.participants,
          description: v.description,
          summary: v.summary,
          chapters: v.chapters,
          comments: v.comments ?? [],
          heldDeletedAt: v.held_deleted_at?.toISOString() ?? null,
          file: "The video file is kept by Stream (STREAM_DIR/videos/<id>); it is too large to attach to an export.",
        },
        text: [r.title, v.description, v.summary, v.transcript && `Transcript:\n${v.transcript}`].filter(Boolean).join("\n\n"),
        ...(v.captions ? { attachments: [{ name: "captions.vtt", type: "text/vtt", base64: Buffer.from(v.captions).toString("base64"), size: Buffer.byteLength(v.captions) }] } : {}),
      });
    } else if (r.kind === "comment") {
      const [c] = await q<{ video_id: string; video_title: string; at_seconds: number | null }>(
        `SELECT c.video_id, v.title AS video_title, c.at_seconds FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = $1`,
        [r.id],
      );
      items.push({ ...base, metadata: { videoId: c.video_id, video: c.video_title, atSeconds: c.at_seconds }, text: r.body });
    } else {
      const [p] = await q<{ video_ids: string[]; created_at: Date }>(`SELECT video_ids, created_at FROM projects WHERE id = $1`, [r.id]);
      items.push({
        ...base,
        metadata: { videoIds: p.video_ids, createdAt: p.created_at.toISOString(), file: "Kept by Stream (STREAM_DIR/projects/<id>.fcproj)." },
        text: r.title,
      });
    }
  }
  const order = wanted.map((w) => w.key);
  items.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
  return { items };
}
