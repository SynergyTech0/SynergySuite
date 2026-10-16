import { type ExportAttachment, type ExportItem, MAX_ATTACHMENT_BYTES, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { UUID } from "./access.mjs";
import { fileName } from "./drive";
import { decodeScene, toExcalidrawFile } from "./ydoc";

/** Whiteboard's one kind of content for the Admin center: boards, with their words and drawing. */
export const KINDS = ["board"];

/** Everyone else on a board: the people it is shared with and whoever changed it last. */
const PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(
  ARRAY(SELECT m.email FROM board_members m WHERE m.board_id = b.id) || ARRAY[b.modified_by]
) e WHERE e IS NOT NULL AND e <> b.owner ORDER BY e)`;

type Row = {
  id: string; title: string; text: string; owner: string; participants: string[]; modified_at: Date;
  held_deleted_at: Date | null; element_count: number; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: "board",
    title: r.title,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.modified_at.toISOString(),
    snippet: snippet(r.text || r.title, s.query),
    size: Buffer.byteLength(`${r.title} ${r.text}`),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

const SELECT = `SELECT b.id, b.title, b.text, b.owner, ${PEOPLE} AS participants, b.modified_at, b.held_deleted_at, b.element_count`;

/** Boards matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("board")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["b.title", "b.text"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `${SELECT}, COUNT(*) OVER () AS total
     FROM boards b
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR b.owner = ANY($1) OR ${PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR b.modified_at >= $2)
       AND ($3::timestamptz IS NULL OR b.modified_at < $3)
     ORDER BY b.modified_at DESC, b.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** The board's drawing as an .excalidraw file, which Whiteboard or Excalidraw opens. */
function drawing(title: string, ydoc: Buffer | null): ExportAttachment {
  const bytes = Buffer.from(toExcalidrawFile(decodeScene(ydoc)));
  const name = fileName(title, "excalidraw");
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { name, type: "application/json", size: bytes.length, skipped: "Too large to include" };
  return { name, type: "application/json", size: bytes.length, base64: bytes.toString("base64") };
}

/** Each board in full: its words, who it is shared with, and the drawing as an .excalidraw file. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    link_access: string; source: string | null; created_at: Date; modified_by: string | null; ydoc: Buffer | null;
    members: { email: string; role: string }[] | null;
  }>(
    `${SELECT}, 0 AS total, b.link_access, b.source, b.created_at, b.modified_by, b.ydoc,
       (SELECT json_agg(json_build_object('email', m.email, 'role', m.role) ORDER BY m.added_at) FROM board_members m WHERE m.board_id = b.id) AS members
     FROM boards b WHERE b.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => ({
    ...hit(r, { query: { groups: [], none: [] } }),
    app: APP,
    metadata: {
      createdAt: r.created_at.toISOString(),
      modifiedBy: r.modified_by,
      linkAccess: r.link_access,
      source: r.source,
      members: r.members ?? [],
      shapes: r.element_count,
      heldDeletedAt: r.held_deleted_at?.toISOString() ?? null,
    },
    text: [r.title, r.text].filter(Boolean).join("\n"),
    attachments: [drawing(r.title, r.ydoc)],
  }));
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
