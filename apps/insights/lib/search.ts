import { type SearchResult, type SearchResults, clipText, matchesQuery, readSearchQuery, snippet } from "@synergy/search";
import type { Metabase } from "./metabase";

export const APP = "insights";

/** What suite search can ask Insights for. */
export const KINDS = ["dashboard", "report"];

interface Item {
  id: number;
  model: string;
  name: string;
  description?: string | null;
  collection?: { name?: string | null } | null;
  updated_at?: string | null;
  archived?: boolean;
  creator_common_name?: string | null;
}

/**
 * Suite search for one person: the dashboards and saved questions ("reports") Metabase lets
 * them open, by name, description and collection. Metabase finds candidates for the plain
 * words; the suite's keyword rules (quotes, OR, minus) are then applied here.
 */
export async function searchFor(mb: Metabase, me: { email: string; name: string }, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const wanted = s.kinds.length ? KINDS.filter((k) => s.kinds.includes(k)) : KINDS;
  if (!wanted.length) return { app: APP, results: [] };
  const models = [...(wanted.includes("dashboard") ? ["dashboard"] : []), ...(wanted.includes("report") ? ["card", "dataset", "metric"] : [])];
  // Every hit contains one of the first group's terms, so asking Metabase for each of them
  // finds every candidate; the rest of the query is checked below.
  const seen = new Map<string, Item>();
  for (const term of (s.parsed.groups[0] ?? []).slice(0, 5)) {
    const qs = new URLSearchParams({ q: term, limit: String(Math.min(s.limit * 3, 150)) });
    for (const m of models) qs.append("models", m);
    const r = await mb.asPerson<{ data: Item[] } | Item[]>(me.email, me.name, `/api/search?${qs}`);
    for (const i of Array.isArray(r) ? r : r.data) seen.set(`${i.model}-${i.id}`, i);
  }
  const items = [...seen.values()]
    .filter((i) => !i.archived && models.includes(i.model))
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const results: SearchResult[] = [];
  for (const i of items) {
    const text = [i.name, i.description ?? "", i.collection?.name ?? ""].join(" ");
    if (!matchesQuery(text, s.parsed)) continue;
    const kind = i.model === "dashboard" ? "dashboard" : "report";
    results.push({
      id: `${i.model}-${i.id}`,
      kind,
      title: i.name,
      snippet: i.description ? snippet(i.description, s.parsed) : i.collection?.name ? `In ${i.collection.name}` : "",
      date: i.updated_at ?? new Date(0).toISOString(),
      url: kind === "dashboard" ? `/d/${i.id}` : `${mb.c.studioPath}/question/${i.id}`,
      ...(i.creator_common_name ? { person: i.creator_common_name } : {}),
      ...(s.text ? { text: clipText([i.name, i.description, i.collection?.name ? `Collection: ${i.collection.name}` : ""].filter(Boolean).join("\n")) } : {}),
    });
    if (results.length >= s.limit) break;
  }
  return { app: APP, results };
}
