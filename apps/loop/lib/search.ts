import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { ydoc } from "./loop";

/** What suite search can ask Loop for. */
export const KINDS = ["page", "component"];

/** Workspaces the person ($1) is in. */
export const MY_WORKSPACES = `(SELECT w.id FROM workspaces w
  LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.email = $1
  WHERE w.held_deleted_at IS NULL AND (w.owner = $1 OR m.email IS NOT NULL))`;

/**
 * Components the person ($1) can open and has reason to know about: theirs, ones they were added
 * to, ones in their workspaces, and ones shared by organization link that they have opened. A
 * link nobody gave them stays out of their results even though it would open.
 */
export const MY_COMPONENTS = `(SELECT c.id FROM components c WHERE c.held_deleted_at IS NULL AND (
  c.owner = $1
  OR EXISTS (SELECT 1 FROM component_members cm WHERE cm.component_id = c.id AND cm.email = $1)
  OR c.workspace_id IN ${MY_WORKSPACES}
  OR (c.link_access <> 'people' AND EXISTS (SELECT 1 FROM visits v WHERE v.email = $1 AND v.item_kind = 'component' AND v.item_id = c.id))
))`;

type Row = { id: string; kind: string; title: string; body: string; place: string; place_id: string | null; person: string | null; modified_at: Date };

/** Suite search for one person: pages in their workspaces and the components they can open. */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const rows: Row[] = [];
  if (want("page")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["p.title", "p.text", "w.name"], params.length + 1);
    params.push(...words.params);
    rows.push(
      ...(await q<Row>(
        `SELECT p.id, 'page' AS kind, p.title, p.text AS body, w.name AS place, p.workspace_id AS place_id,
           COALESCE(p.modified_by, p.created_by) AS person, p.modified_at
         FROM pages p JOIN workspaces w ON w.id = p.workspace_id
         WHERE p.workspace_id IN ${MY_WORKSPACES} AND p.held_deleted_at IS NULL AND ${words.sql}
         ORDER BY p.modified_at DESC, p.id LIMIT $2`,
        params,
      )),
    );
  }
  if (want("component")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["c.title", "c.text"], params.length + 1);
    params.push(...words.params);
    rows.push(
      ...(await q<Row>(
        `SELECT c.id, 'component' AS kind, c.title, c.text AS body, c.kind AS place, NULL AS place_id,
           COALESCE(c.modified_by, c.owner) AS person, c.modified_at
         FROM components c
         WHERE c.id IN ${MY_COMPONENTS} AND ${words.sql}
         ORDER BY c.modified_at DESC, c.id LIMIT $2`,
        params,
      )),
    );
  }
  rows.sort((a, b) => b.modified_at.getTime() - a.modified_at.getTime());
  const results = rows.slice(0, s.limit).map((r): SearchResult => {
    const where = r.kind === "page" ? `Page in ${r.place}` : (ydoc.kindInfo(r.place)?.name ?? "Component");
    return {
      id: r.id,
      kind: r.kind,
      title: r.title || "Untitled page",
      snippet: r.body ? snippet(r.body, s.parsed) : where,
      date: r.modified_at.toISOString(),
      url: r.kind === "page" ? `/w/${r.place_id}?page=${r.id}` : `/c/${r.id}`,
      ...(r.person ? { person: r.person } : {}),
      ...(s.text ? { text: clipText([r.title, where, r.body].filter(Boolean).join("\n")) } : {}),
    };
  });
  return { app: APP, results };
}
