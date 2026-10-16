import { MAX_EXPORT_IDS, MAX_PAGE, type ExportItem, type SearchHit, type SearchRequest, type SearchResponse } from "@synergy/compliance";

/**
 * Talking to the apps: one search goes to every chosen app at once, each with its own time limit,
 * so a slow or broken app shows up as an error next to the others' results instead of holding
 * them up. Exports page through every hit and fetch the items in batches.
 */

export type Caller = {
  fetch: typeof fetch;
  urlFor: (app: string) => string;
  token: string;
  /** Per call, in milliseconds. */
  timeoutMs: number;
};

export type AppHit = SearchHit & { app: string };

export type AppResult = {
  app: string;
  ok: boolean;
  hits: AppHit[];
  total?: number;
  nextCursor?: string;
  error?: string;
  ms: number;
};

export class AppCallError extends Error {}

function explain(status: number): string {
  if (status === 401 || status === 403) return "The app refused the compliance token (COMPLIANCE_TOKEN differs)";
  if (status === 404 || status === 405) return "This app doesn't take part in eDiscovery yet";
  if (status === 400) return "The app refused the search";
  return `The app answered ${status}`;
}

async function call<T>(c: Caller, app: string, path: string, body: unknown, timeoutMs = c.timeoutMs): Promise<T> {
  let res: Response;
  try {
    res = await c.fetch(`${c.urlFor(app)}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new AppCallError(`No answer within ${Math.round(timeoutMs / 1000)} s`);
    throw new AppCallError("Could not reach the app");
  }
  if (!res.ok) {
    await res.arrayBuffer().catch(() => {});
    throw new AppCallError(explain(res.status));
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new AppCallError("The app sent something that isn't JSON");
  }
}

function cleanHit(app: string, h: SearchHit): AppHit | null {
  if (!h || typeof h !== "object" || typeof h.id !== "string" || !h.id) return null;
  return {
    app,
    id: h.id,
    kind: String(h.kind ?? ""),
    title: String(h.title ?? ""),
    owner: String(h.owner ?? "").toLowerCase(),
    participants: Array.isArray(h.participants) ? h.participants.map(String) : undefined,
    date: String(h.date ?? ""),
    snippet: String(h.snippet ?? "").slice(0, 600),
    size: typeof h.size === "number" ? h.size : undefined,
    deleted: h.deleted === true ? true : undefined,
  };
}

export async function searchOne(app: string, req: SearchRequest, c: Caller): Promise<AppResult> {
  const start = Date.now();
  try {
    const r = await call<SearchResponse>(c, app, "/api/compliance/search", { ...req, limit: Math.min(req.limit ?? 50, MAX_PAGE) });
    if (!r || !Array.isArray(r.hits)) throw new AppCallError("The app's answer has no hits list");
    return {
      app,
      ok: true,
      hits: r.hits.map((h) => cleanHit(app, h)).filter((h): h is AppHit => !!h),
      total: typeof r.total === "number" ? r.total : undefined,
      nextCursor: typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined,
      ms: Date.now() - start,
    };
  } catch (e) {
    return { app, ok: false, hits: [], error: e instanceof AppCallError ? e.message : "Something went wrong", ms: Date.now() - start };
  }
}

/** Newest first; ties broken by app and id so pages are stable. */
export function mergeHits(results: AppResult[]): AppHit[] {
  const all = results.flatMap((r) => r.hits);
  const t = (h: AppHit) => {
    const v = Date.parse(h.date);
    return Number.isNaN(v) ? 0 : v;
  };
  return all.sort((a, b) => t(b) - t(a) || a.app.localeCompare(b.app) || a.id.localeCompare(b.id));
}

/** Runs one search in every app in parallel. `cursors` continues apps from an earlier page; an app left out of it starts over. */
export async function fanOut(apps: string[], req: SearchRequest, c: Caller, cursors?: Record<string, string>): Promise<{ results: AppResult[]; hits: AppHit[] }> {
  const targets = cursors ? apps.filter((a) => cursors[a]) : apps;
  const results = await Promise.all(targets.map((app) => searchOne(app, { ...req, cursor: cursors?.[app] }, c)));
  return { results, hits: mergeHits(results) };
}

/** Every hit in one app, page by page, up to `max`. */
export async function collectAll(app: string, req: SearchRequest, c: Caller, max: number): Promise<{ hits: AppHit[]; truncated: boolean; total?: number; error?: string }> {
  const hits: AppHit[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let total: number | undefined;
  for (let page = 0; page < 10_000; page++) {
    const r = await searchOne(app, { ...req, limit: Math.min(MAX_PAGE, max - hits.length), cursor }, c);
    if (!r.ok) return { hits, truncated: hits.length > 0, total, error: r.error };
    total ??= r.total;
    for (const h of r.hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      hits.push(h);
    }
    if (!r.nextCursor || r.nextCursor === cursor) return { hits, truncated: false, total };
    if (hits.length >= max) return { hits: hits.slice(0, max), truncated: true, total };
    // An app that keeps sending empty pages with a cursor would loop forever.
    if (!r.hits.length && page > 2) return { hits, truncated: true, total, error: "The app kept sending empty pages" };
    cursor = r.nextCursor;
  }
  return { hits, truncated: true, total };
}

/** Fetches full items for these ids, MAX_EXPORT_IDS at a time. */
export async function exportItems(app: string, ids: string[], c: Caller, onBatch: (items: ExportItem[]) => Promise<void> | void): Promise<void> {
  for (let i = 0; i < ids.length; i += MAX_EXPORT_IDS) {
    const batch = ids.slice(i, i + MAX_EXPORT_IDS);
    const r = await call<{ items: ExportItem[] }>(c, app, "/api/compliance/export", { ids: batch }, c.timeoutMs * 4);
    if (!r || !Array.isArray(r.items)) throw new AppCallError("The app's export answer has no items list");
    await onBatch(r.items.map((it) => ({ ...it, app })));
  }
}
