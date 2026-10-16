import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { isAdmin, membershipsOf } from "./groups";
import { KIND_LABEL, type Kind } from "./types";

/** What suite search can ask Groups for. */
export const KINDS = ["group"];

type Row = { id: string; kind: Kind; name: string; description: string; email: string | null; modified_at: Date };

/**
 * Suite search for one person: groups they are in, and public ones they could join, by name,
 * description and address. Private groups they aren't in stay hidden (an admin sees all).
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("group")) return { app: APP, results: [] };
  const mine = (await membershipsOf(me.email)).map((m) => m.id);
  const params: unknown[] = [mine, s.limit, isAdmin(me.email)];
  const words = queryToSql(s.parsed, ["g.name", "g.description", "coalesce(g.email, '')"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT g.id, g.kind, g.name, g.description, g.email, g.modified_at FROM groups g
     WHERE g.deleted_at IS NULL AND (g.id = ANY($1::uuid[]) OR g.privacy = 'public' OR $3) AND ${words.sql}
     ORDER BY g.modified_at DESC, g.id LIMIT $2`,
    params,
  );
  const results: SearchResult[] = rows.map((r) => ({
    id: r.id,
    kind: "group",
    title: r.name,
    snippet: r.description ? snippet(r.description, s.parsed) : [KIND_LABEL[r.kind], r.email].filter(Boolean).join(" · "),
    date: r.modified_at.toISOString(),
    url: `/g/${r.id}`,
    ...(s.text ? { text: clipText([r.name, KIND_LABEL[r.kind], r.email, r.description].filter(Boolean).join("\n")) } : {}),
  }));
  return { app: APP, results };
}
