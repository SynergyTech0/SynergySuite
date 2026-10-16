import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { db, ready } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { allControls, type AppDef } from "./model";

/**
 * Builder's content for the Admin center: apps, owned by the person who made them, with the
 * people they're shared with. The records an app shows live in Base, which answers for them.
 */
export const KINDS = ["app"];

/** Everyone else on an app (not the organization-wide '*'). */
const PEOPLE = `ARRAY(SELECT m.email FROM builder_members m WHERE m.app_id = a.id AND m.email <> a.created_by AND m.email <> '*' ORDER BY m.email)`;

type Row = {
  id: string; name: string; description: string; created_by: string; participants: string[]; updated_at: Date;
  held_deleted_at: Date | null; draft: AppDef; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: "app",
    title: r.name,
    owner: r.created_by,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.updated_at.toISOString(),
    snippet: snippet(r.description || r.name, s.query),
    size: Buffer.byteLength(JSON.stringify(r.draft)),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

const SELECT = `SELECT a.id, a.name, a.description, a.created_by, ${PEOPLE} AS participants, a.updated_at, a.held_deleted_at, a.draft`;

/** Apps matching an eDiscovery search, by name, description and their formulas; held deletions included. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("app")) return { app: APP, hits: [], total: 0 };
  await ready();
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["a.name", "a.description", "a.draft::text"], params.length + 1);
  params.push(...words.params);
  const { rows } = await db().q<Row>(
    `${SELECT}, COUNT(*) OVER () AS total
     FROM builder_apps a
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR a.created_by = ANY($1) OR ${PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR a.updated_at >= $2)
       AND ($3::timestamptz IS NULL OR a.updated_at < $3)
     ORDER BY a.updated_at DESC, a.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** The formulas of an app as readable text: each screen, control and property. */
export function formulasText(def: AppDef): string {
  const lines: string[] = [];
  if (def.onStart) lines.push(`App.OnStart = ${def.onStart}`);
  for (const s of def.screens) {
    for (const [p, f] of Object.entries(s.props)) if (f) lines.push(`${s.name}.${p} = ${f}`);
    for (const { control } of allControls({ screens: [s] })) {
      for (const [p, f] of Object.entries(control.props)) if (f) lines.push(`${control.name}.${p} = ${f}`);
    }
  }
  return lines.join("\n");
}

/** Each app in full: its draft and published definitions, sharing and versions. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => /^[a-z0-9]{12}$/.test(i));
  if (!wanted.length) return { items: [] };
  await ready();
  const { rows } = await db().q<Row & {
    published: AppDef | null; published_version: number; published_at: Date | null; created_at: Date; updated_by: string;
    members: { email: string; role: string }[];
  }>(
    `${SELECT}, 0 AS total, a.published, a.published_version, a.published_at, a.created_at, a.updated_by,
       (SELECT json_agg(json_build_object('email', m.email, 'role', m.role) ORDER BY m.email) FROM builder_members m WHERE m.app_id = a.id) AS members
     FROM builder_apps a WHERE a.id = ANY($1)`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => ({
    ...hit(r, { query: { groups: [], none: [] } }),
    app: APP,
    metadata: {
      description: r.description,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      updatedBy: r.updated_by,
      publishedVersion: r.published_version,
      publishedAt: r.published_at?.toISOString() ?? null,
      members: r.members ?? [],
      dataSources: r.draft.dataSources.map((d) => ({ name: d.name, table: d.tableName, databaseId: d.databaseId, tableId: d.tableId })),
      draft: r.draft,
      published: r.published,
      heldDeletedAt: r.held_deleted_at?.toISOString() ?? null,
    },
    text: [r.name, r.description, formulasText(r.draft)].filter(Boolean).join("\n"),
  }));
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
