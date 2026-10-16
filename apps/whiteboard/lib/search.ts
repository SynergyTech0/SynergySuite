import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";

/** What suite search can ask Whiteboard for. */
export const KINDS = ["board"];

/** Boards a person can open and keeps in their list: their own, shared with them, or opened through a link. */
export const MY_BOARDS = `(b.owner = $1
  OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.email = $1)
  OR (b.link_access <> 'none' AND EXISTS (SELECT 1 FROM board_visits v WHERE v.board_id = b.id AND v.email = $1)))`;

type Row = { id: string; title: string; text: string; owner: string; modified_at: Date };

/** Suite search for one person: the boards they can open, by name and the words written on them. */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("board")) return { app: APP, results: [] };
  const params: unknown[] = [me.email, s.limit];
  const words = queryToSql(s.parsed, ["b.title", "b.text"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT b.id, b.title, b.text, b.owner, b.modified_at FROM boards b
     WHERE ${MY_BOARDS} AND b.held_deleted_at IS NULL AND ${words.sql}
     ORDER BY b.modified_at DESC, b.id
     LIMIT $2`,
    params,
  );
  const results = rows.map((r): SearchResult => ({
    id: r.id,
    kind: "board",
    title: r.title,
    snippet: r.text ? snippet(r.text, s.parsed) : "Whiteboard",
    date: r.modified_at.toISOString(),
    url: `/b/${r.id}`,
    person: r.owner,
    ...(s.text ? { text: clipText([r.title, r.text].filter(Boolean).join("\n")) } : {}),
  }));
  return { app: APP, results };
}
