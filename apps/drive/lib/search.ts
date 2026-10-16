import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import { q } from "./db";
import type { Me } from "./api";
import { APP } from "./compliance";
import { LOCATION, VISIBLE, VISIBLE_WHERE } from "./drive";

/** What suite search can ask Drive for. */
export const KINDS = ["file", "folder"];

type Row = {
  id: string;
  name: string;
  kind: "file" | "folder";
  who: string;
  library_id: string | null;
  parent_id: string | null;
  modified_at: Date;
  text: string | null;
  location: string;
  parent_open: boolean;
};

/** A path in Drive's UI that opens the item: a folder itself, a file previewed in its folder. */
function urlOf(r: Row): string {
  if (r.kind === "folder") return `/?parent=${r.id}`;
  const preview = `preview=${r.id}`;
  // Shared with me on its own, its folder out of my reach: open it from "Shared with me".
  if (!r.parent_open) return `/?view=shared&${preview}`;
  if (r.parent_id) return `/?parent=${r.parent_id}&${preview}`;
  if (r.library_id) return `/?library=${r.library_id}&${preview}`;
  return `/?${preview}`;
}

/**
 * Suite search for one person: the files and folders they can open in Drive today (their own,
 * their libraries', and anything shared with them directly or through a folder above it, with
 * Drive's own VISIBLE rule), by name and, for text files, content. The recycle bin, and so
 * anything deleted under a hold, is left out.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const kinds = s.kinds.length ? KINDS.filter((k) => s.kinds.includes(k)) : KINDS;
  if (!kinds.length) return { app: APP, results: [] };
  const params: unknown[] = [me.email, kinds, s.limit];
  const words = queryToSql(s.parsed, ["i.name", "i.text"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `${VISIBLE}
     SELECT i.id, i.name, i.kind, COALESCE(NULLIF(i.owner, ''), i.created_by) AS who, i.library_id, i.parent_id,
       i.modified_at, i.text, ${LOCATION},
       COALESCE(i.space = 'u:' || $1
         OR i.library_id IN (SELECT library_id FROM library_members WHERE email = $1)
         OR i.parent_id IN (SELECT id FROM shared_tree), false) AS parent_open
     FROM items i
     WHERE ${VISIBLE_WHERE} AND i.held_deleted_at IS NULL AND i.kind = ANY($2) AND ${words.sql}
     ORDER BY i.modified_at DESC, i.id
     LIMIT $3`,
    params,
  );
  const results = rows.map((r): SearchResult => ({
    id: r.id,
    kind: r.kind,
    title: r.name,
    snippet: r.text ? snippet(r.text, s.parsed) : r.location,
    date: r.modified_at.toISOString(),
    url: urlOf(r),
    person: r.who,
    ...(s.text ? { text: clipText(r.text ?? "") } : {}),
  }));
  return { app: APP, results };
}
