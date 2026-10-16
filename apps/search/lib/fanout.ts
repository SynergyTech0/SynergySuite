import { apps, appUrl } from "@synergy/config";
import { MAX_TEXT, type SearchQuery, type SearchResult } from "@synergy/search";
import type { Viewer } from "./api";

/**
 * Sends one query to every content app on behalf of the signed-in person. Each app answers
 * POST /api/search behind its normal sign-in, so it is given the same gateway headers the
 * person's own browser request carries (and PROXY_SHARED_SECRET), and returns only what that
 * person can open there. One app being down, slow or old never breaks the others' results.
 */

/** Apps that answer POST /api/search, in the order their results win a tie. */
export const SEARCHABLE = ["mail", "drive", "chat", "calendar", "notes", "forms", "contacts", "todo", "crm", "desk", "office", "planner", "sites", "base", "engage", "insights", "stream"] as const;

export type AppState = "ok" | "not-supported" | "unavailable" | "error";

export interface AppOutcome {
  app: string;
  name: string;
  status: AppState;
  count: number;
  /** Why it didn't answer, in words a person can read. */
  detail?: string;
}

/** A result with the app it came from and an absolute link. */
export interface Hit extends SearchResult {
  app: string;
  appName: string;
}

export interface FanoutResult {
  hits: Hit[];
  apps: AppOutcome[];
}

export interface FanoutOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Per app, default 4000 ms. */
  timeoutMs?: number;
  /** Limit to some of the searchable apps. */
  apps?: string[];
}

export function appName(id: string): string {
  return apps.find((a) => a.id === id)?.name ?? id;
}

function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const v = JSON.parse(env.SEARCH_APP_URLS || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    console.error("[search] SEARCH_APP_URLS is not valid JSON; ignoring it");
    return {};
  }
}

/** Where the Search app reaches an app: SEARCH_APP_URLS, else http://<id>:<port> in production, localhost otherwise. */
export function internalUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = overrides(env)[id];
  if (typeof o === "string" && o) return o.replace(/\/+$/, "");
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.NODE_ENV === "production" ? `http://${app.id}:${app.port}` : `http://localhost:${app.port}`;
}

/** The searchable apps a request covers: all of them, or the ones asked for. */
export function searchApps(only?: string[]): string[] {
  const known = new Set(apps.map((a) => a.id));
  const list = SEARCHABLE.filter((id) => known.has(id)) as string[];
  if (!only?.length) return list;
  const want = new Set(only);
  return list.filter((id) => want.has(id));
}

/**
 * The link a person can follow: a path in the app becomes a link on the app's public address;
 * a full http(s) URL is kept. Anything else (javascript:, data:, relative junk) is dropped.
 */
export function safeLink(app: string, url: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (!u || /[\u0000-\u001F\u007F\s]/.test(u)) return null;
  let full: string;
  if (u.startsWith("/") && !u.startsWith("//") && !u.startsWith("/\\")) full = appUrl(app, env) + u;
  else if (/^https?:\/\//i.test(u)) full = u;
  else return null;
  try {
    const parsed = new URL(full);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");

function isoDate(v: unknown): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** One app's raw result, checked: strings of sane length, a valid date, a safe absolute link. Null drops it. */
export function cleanResult(app: string, raw: unknown, env: NodeJS.ProcessEnv): Hit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 300);
  const url = safeLink(app, r.url, env);
  if (!id || !url) return null;
  const hit: Hit = {
    app,
    appName: appName(app),
    id,
    kind: str(r.kind, 40) || "item",
    title: str(r.title, 300).trim() || "(untitled)",
    snippet: str(r.snippet, 600),
    date: isoDate(r.date),
    url,
  };
  const person = str(r.person, 200).trim();
  if (person) hit.person = person;
  if (typeof r.text === "string") hit.text = r.text.slice(0, MAX_TEXT + 1);
  return hit;
}

/** The headers a content app's identify() reads, as the gateway would set them for this person. */
export function viewerHeaders(viewer: Viewer, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-auth-request-email": viewer.email,
    "x-auth-request-preferred-username": viewer.name,
    "x-auth-request-user": viewer.subject || viewer.email,
  };
  if (env.PROXY_SHARED_SECRET) h["x-proxy-auth-secret"] = env.PROXY_SHARED_SECRET;
  return h;
}

async function searchOne(app: string, viewer: Viewer, query: SearchQuery, opts: FanoutOptions): Promise<{ outcome: AppOutcome; hits: Hit[] }> {
  const env = opts.env ?? process.env;
  const f = opts.fetch ?? fetch;
  const ms = opts.timeoutMs ?? 4000;
  const name = appName(app);
  const out = (status: AppState, detail?: string, hits: Hit[] = []) => ({ outcome: { app, name, status, count: hits.length, ...(detail ? { detail } : {}) }, hits });
  let url: string;
  try {
    url = `${internalUrl(app, env)}/api/search`;
  } catch {
    return out("error", "Not in the suite registry");
  }
  const signal = AbortSignal.timeout(ms);
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: viewerHeaders(viewer, env), body: JSON.stringify(query), signal, redirect: "manual" });
  } catch (e) {
    const err = e as Error;
    return out("unavailable", err?.name === "TimeoutError" || signal.aborted ? `No answer within ${ms / 1000} s` : "Could not connect");
  }
  if (res.status === 404 || res.status === 405) {
    void res.body?.cancel().catch(() => {});
    return out("not-supported", "Doesn't take part in search yet");
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    if (res.status === 401 || res.status === 403) return out("error", "Refused the search (check PROXY_SHARED_SECRET)");
    return out("error", `Answered ${res.status}`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError" || signal.aborted) return out("unavailable", `No answer within ${ms / 1000} s`);
    return out("error", "Answer isn't JSON");
  }
  const list = (data as { results?: unknown })?.results;
  if (!Array.isArray(list)) return out("error", "Answer has no results list");
  const hits = list.map((r) => cleanResult(app, r, env)).filter((h): h is Hit => h !== null);
  return out("ok", undefined, hits);
}

/** Searches every (or the chosen) searchable app at once. Results are in app order; rank them with rank(). */
export async function fanOut(viewer: Viewer, query: SearchQuery, opts: FanoutOptions = {}): Promise<FanoutResult> {
  const ids = searchApps(opts.apps);
  const settled = await Promise.all(ids.map((app) => searchOne(app, viewer, query, opts).catch(() => ({ outcome: { app, name: appName(app), status: "error" as const, count: 0, detail: "Search failed" }, hits: [] as Hit[] }))));
  return { hits: settled.flatMap((s) => s.hits), apps: settled.map((s) => s.outcome) };
}
