import type { ExportItem, SearchRequest } from "@synergy/compliance";
import { record } from "./audit";
import { complianceApps, internalUrl, suiteApps } from "./apps";
import { exportItems, fanOut, type AppResult, type Caller } from "./fanout";
import type { Me } from "./types";
import { UserError, emailList, isoDate, text } from "./util";

/** Content search across the suite, as an admin or eDiscovery manager runs it. */

export type SearchInput = { query: string; custodians: string[]; apps: string[]; from: string | null; to: string | null };

export function cleanSearch(v: Record<string, unknown>): SearchInput {
  const query = text(v.query, 2000);
  const custodians = emailList(v.custodians ?? [], 1000);
  const from = isoDate(v.from, "start date");
  const to = isoDate(v.to, "end date");
  if (from && to && from > to) throw new UserError("The start date is after the end date");
  let apps: string[] = [];
  if (Array.isArray(v.apps) && v.apps.length) {
    const known = new Set(suiteApps().map((a) => a.id));
    apps = [...new Set(v.apps.map((a) => text(a, 40)))].filter((a) => known.has(a)).sort();
  }
  return { query, custodians, apps, from, to };
}

/** The apps a search goes to: the ones picked, or every app that keeps content. */
export function targets(s: SearchInput): string[] {
  return s.apps.length ? s.apps : complianceApps();
}

export function toRequest(s: SearchInput, limit?: number): SearchRequest {
  const r: SearchRequest = {};
  if (s.query) r.query = s.query;
  if (s.custodians.length) r.custodians = s.custodians;
  if (s.from) r.from = s.from;
  if (s.to) r.to = s.to;
  if (limit) r.limit = limit;
  return r;
}

export function caller(timeoutMs = 15_000): Caller {
  return { fetch, urlFor: (app) => internalUrl(app), token: process.env.COMPLIANCE_TOKEN ?? "", timeoutMs };
}

function requireToken() {
  if (!process.env.COMPLIANCE_TOKEN) throw new UserError("Set COMPLIANCE_TOKEN (the same value in every app) so the Admin center can search them", 409);
}

export type SearchResult = { results: Omit<AppResult, "hits">[]; hits: AppResult["hits"]; counts: Record<string, number> };

export async function run(me: Me, s: SearchInput, cursors?: Record<string, string>, c: Caller = caller()): Promise<SearchResult> {
  requireToken();
  const apps = targets(s);
  const { results, hits } = await fanOut(apps, toRequest(s, 50), c, cursors);
  const counts: Record<string, number> = {};
  for (const r of results) if (r.ok) counts[r.app] = r.total ?? r.hits.length;
  if (!cursors) {
    await record(me.email, "search.run", s.query || "(no keywords)", {
      ...s, apps: s.apps.length ? s.apps : "all",
      results: Object.fromEntries(results.map((r) => [r.app, r.ok ? r.total ?? r.hits.length : `error: ${r.error}`])),
    });
  }
  return { results: results.map(({ hits: _h, ...r }) => r), hits, counts };
}

/** One item in full, through the app's export call. */
export async function viewItem(me: Me, app: string, id: string, c: Caller = caller()): Promise<ExportItem> {
  requireToken();
  if (!suiteApps().some((a) => a.id === app)) throw new UserError("Unknown app");
  const itemId = text(id, 1000);
  if (!itemId) throw new UserError("Which item?");
  let found: ExportItem | undefined;
  try {
    await exportItems(app, [itemId], c, (items) => {
      found = items.find((i) => i.id === itemId) ?? items[0];
    });
  } catch (e) {
    throw new UserError((e as Error).message, 502);
  }
  if (!found) throw new UserError("The app no longer has that item", 404);
  await record(me.email, "search.view_item", `${app}:${itemId}`, { app, id: itemId, title: found.title, owner: found.owner });
  return found;
}
