/**
 * POST /api/search: suite search on behalf of the signed-in person (see @synergy/search). It
 * covers the apps they can open (makers and editors see drafts too; users only published apps),
 * by name and description. Records shown in apps are Base's to search.
 */
import { clipText, matchesQuery, readSearchQuery, snippet, type SearchResult, type SearchResults } from "@synergy/search";
import { listApps } from "./apps";
import { APP } from "./compliance";

export const KINDS = ["app"] as const;

export async function searchFor(email: string, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("app")) return { app: APP, results: [] };
  const results: SearchResult[] = [];
  for (const a of await listApps(email)) {
    const text = `${a.name}\n${a.description}`;
    if (!matchesQuery(text, s.parsed)) continue;
    results.push({
      id: a.id,
      kind: "app",
      title: a.name,
      snippet: snippet(a.description || (a.published ? "App" : "Draft app"), s.parsed),
      date: a.updatedAt,
      url: a.published ? `/play/${a.id}` : `/studio/${a.id}`,
      person: a.createdBy,
      ...(s.text ? { text: clipText(text) } : {}),
    });
    if (results.length >= s.limit) break;
  }
  return { app: APP, results };
}
