import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { ydoc } from "./loop";

/** Loop's content for the Admin center: workspace pages and components. */
export const KINDS = ["page", "component"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose content an item is. A page: its workspace's owner, members and whoever wrote it. A
 * component: its owner, the people added to it and whoever last changed it.
 */
const PAGE_PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(
  ARRAY(SELECT m.email FROM workspace_members m WHERE m.workspace_id = x.workspace_id) || ARRAY[x.created_by, x.modified_by]
) e WHERE e IS NOT NULL AND e <> x.owner ORDER BY e)`;
const COMPONENT_PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(
  ARRAY(SELECT m.email FROM component_members m WHERE m.component_id = x.id) || ARRAY[x.modified_by]
) e WHERE e IS NOT NULL AND e <> x.owner ORDER BY e)`;

/** Both kinds as one set of rows, so they can be searched and paged together. */
const ITEMS = `(
  SELECT 'page' AS kind, p.id, p.title, p.text, w.owner, p.workspace_id, w.name AS place, p.created_by, p.modified_by,
    p.created_at, p.modified_at, COALESCE(p.held_deleted_at, w.held_deleted_at) AS held_deleted_at, NULL::text AS link_access
  FROM pages p JOIN workspaces w ON w.id = p.workspace_id
  UNION ALL
  SELECT 'component', c.id, c.title, c.text, c.owner, c.workspace_id, c.kind, c.owner, c.modified_by,
    c.created_at, c.modified_at, c.held_deleted_at, c.link_access
  FROM components c
)`;

const PEOPLE = `CASE WHEN x.kind = 'page' THEN ${PAGE_PEOPLE} ELSE ${COMPONENT_PEOPLE} END`;

type Row = {
  kind: "page" | "component"; id: string; title: string; text: string; owner: string; workspace_id: string | null; place: string;
  created_by: string; modified_by: string | null; created_at: Date; modified_at: Date; held_deleted_at: Date | null;
  link_access: string | null; participants: string[]; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title || (r.kind === "page" ? "Untitled page" : "Untitled component"),
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.modified_at.toISOString(),
    snippet: snippet(r.text || r.title, s.query),
    size: Buffer.byteLength(`${r.title} ${r.text}`),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

/** Pages and components matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, kinds];
  const words = queryToSql(s.query, ["x.title", "x.text", "x.place"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT x.*, ${PEOPLE} AS participants, COUNT(*) OVER () AS total
     FROM ${ITEMS} x
     WHERE x.kind = ANY($6) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR x.owner = ANY($1) OR ${PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR x.modified_at >= $2)
       AND ($3::timestamptz IS NULL OR x.modified_at < $3)
     ORDER BY x.modified_at DESC, x.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each page or component in full, with where it lives and who is on it. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & { workspace_name: string | null; members: string[] }>(
    `SELECT x.*, ${PEOPLE} AS participants, 0 AS total, w.name AS workspace_name,
       CASE WHEN x.kind = 'page'
         THEN ARRAY(SELECT m.email FROM workspace_members m WHERE m.workspace_id = x.workspace_id ORDER BY m.added_at)
         ELSE ARRAY(SELECT m.email FROM component_members m WHERE m.component_id = x.id ORDER BY m.added_at) END AS members
     FROM ${ITEMS} x LEFT JOIN workspaces w ON w.id = x.workspace_id
     WHERE x.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => ({
    ...hit(r, { query: { groups: [], none: [] } }),
    app: APP,
    metadata: {
      ...(r.kind === "page"
        ? { workspace: r.workspace_name, workspaceId: r.workspace_id, workspaceMembers: r.members }
        : {
            componentKind: ydoc.kindInfo(r.place)?.name ?? r.place,
            homeWorkspace: r.workspace_name,
            homeWorkspaceId: r.workspace_id,
            linkAccess: r.link_access,
            members: r.members,
          }),
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      modifiedBy: r.modified_by,
      heldDeletedAt: r.held_deleted_at?.toISOString() ?? null,
    },
    text: [r.title, r.text].filter(Boolean).join("\n\n"),
  }));
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
