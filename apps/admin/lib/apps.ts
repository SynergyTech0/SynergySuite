import { apps, appUrl, type SuiteApp } from "@synergy/config";

/**
 * The suite's apps as the Admin center sees them: where to reach each one on the internal network,
 * whether it is up, and whether it answers the compliance protocol.
 */

/** Apps that keep people's content, with the kinds of content each reports (suggestions for retention rules). */
export const CONTENT_KINDS: Record<string, string[]> = {
  mail: ["message"],
  drive: ["file"],
  chat: ["message"],
  calendar: ["event"],
  notes: ["page"],
  forms: ["response"],
  contacts: ["contact"],
  todo: ["task"],
  engage: ["post", "comment"],
  bookings: ["appointment"],
  crm: ["lead", "account", "contact", "opportunity", "partner", "activity"],
  desk: ["ticket"],
  phone: ["call", "voicemail"],
  diagrams: ["diagram"],
  projects: ["project", "task", "time", "expense"],
  field: ["work_order", "note", "file", "customer", "asset"],
  groups: ["group", "group-change"],
  contracts: ["contract", "obligation", "file", "approval"],
  devices: ["device", "alert"],
  ops: ["work_order", "maintenance", "asset"],
  hr: ["employee", "timeoff", "paycheck"],
  stream: ["video", "comment", "project"],
  whiteboard: ["board"],
  loop: ["page", "component"],
  sign: ["document"],
  campaigns: ["campaign", "template"],
  law: ["matter", "client", "document", "time", "trust", "conflict_check"],
  sites: ["page"],
};

/** Every app in the registry except this one. */
export function suiteApps(): SuiteApp[] {
  return apps.filter((a) => a.id !== "admin");
}

export function appName(id: string): string {
  return apps.find((a) => a.id === id)?.name ?? id;
}

function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const v = JSON.parse(env.COMPLIANCE_APP_URLS || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    console.error("[admin] COMPLIANCE_APP_URLS is not valid JSON; ignoring it");
    return {};
  }
}

/** The apps a search or export covers when none are picked: the content apps, plus any given their own URL. */
export function complianceApps(env: NodeJS.ProcessEnv = process.env): string[] {
  const known = new Set(suiteApps().map((a) => a.id));
  const ids = new Set(Object.keys(CONTENT_KINDS));
  for (const id of Object.keys(overrides(env))) if (known.has(id)) ids.add(id);
  return [...ids].filter((id) => known.has(id));
}

/** Where the Admin center reaches an app: http://<id>:<port> in production, localhost otherwise. */
export function internalUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = overrides(env)[id];
  if (o) return o.replace(/\/$/, "");
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.NODE_ENV === "production" ? `http://${app.id}:${app.port}` : `http://localhost:${app.port}`;
}

/** The sign-in service from here: AUTH_INTERNAL_URL, else the compose host in production, else its public URL. */
export function authInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  const u = env.AUTH_INTERNAL_URL || (env.NODE_ENV === "production" ? "http://auth:3500" : appUrl("auth", env));
  return u.replace(/\/$/, "");
}

export type Compliance = "connected" | "token" | "unsupported" | "unreachable" | "error" | "n/a";
export type AppStatus = {
  id: string; name: string; m365: string; core: boolean; url: string; internalUrl: string;
  up: boolean; ms: number | null; httpStatus: number | null; compliance: Compliance; complianceDetail: string; contentApp: boolean;
};

type Fetch = typeof fetch;

async function timed(f: Fetch, url: string, init: RequestInit, ms: number): Promise<{ status: number | null; ms: number; error: string }> {
  const start = Date.now();
  try {
    const res = await f(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(ms) });
    await res.arrayBuffer().catch(() => {});
    return { status: res.status, ms: Date.now() - start, error: "" };
  } catch (e) {
    const err = e as Error;
    return { status: null, ms: Date.now() - start, error: err.name === "TimeoutError" ? `No answer within ${ms / 1000} s` : "Could not connect" };
  }
}

/** What a compliance probe's answer means. */
export function complianceFromStatus(status: number | null, error = ""): { compliance: Compliance; detail: string } {
  if (status === null) return { compliance: "unreachable", detail: error || "No answer" };
  if (status === 200) return { compliance: "connected", detail: "Answers searches" };
  if (status === 401 || status === 403) return { compliance: "token", detail: "COMPLIANCE_TOKEN does not match the app's" };
  if (status === 404 || status === 405) return { compliance: "unsupported", detail: "Does not take part in eDiscovery" };
  return { compliance: "error", detail: `Answered ${status}` };
}

/** Probes one app: any HTTP answer on / means it is up; POST /api/compliance/search with limit 1 says whether it takes part. */
export async function probe(app: SuiteApp, opts: { fetch?: Fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<AppStatus> {
  const env = opts.env ?? process.env;
  const f = opts.fetch ?? fetch;
  const ms = opts.timeoutMs ?? 2500;
  const base = internalUrl(app.id, env);
  const contentApp = app.id in CONTENT_KINDS || app.id in overrides(env);
  const skip = app.id === "auth" || app.id === "home";
  const [health, comp] = await Promise.all([
    timed(f, `${base}/`, { method: "GET" }, ms),
    skip
      ? Promise.resolve(null)
      : timed(f, `${base}/api/compliance/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.COMPLIANCE_TOKEN ?? ""}`, "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 1 }),
        }, ms),
  ]);
  const up = health.status !== null || (comp?.status ?? null) !== null;
  let c: { compliance: Compliance; detail: string } = { compliance: "n/a", detail: "Keeps no content of its own" };
  if (comp) c = up ? complianceFromStatus(comp.status, comp.error) : { compliance: "unreachable", detail: "The app isn't answering" };
  if (c.compliance === "token" && !env.COMPLIANCE_TOKEN) c.detail = "COMPLIANCE_TOKEN is not set here";
  return {
    id: app.id, name: app.name, m365: app.m365, core: app.core, url: appUrl(app.id, env), internalUrl: base,
    up, ms: health.status !== null ? health.ms : null, httpStatus: health.status, compliance: c.compliance, complianceDetail: c.detail, contentApp,
  };
}

const cache: { at: number; list: AppStatus[] | null; inflight: Promise<AppStatus[]> | null } = { at: 0, list: null, inflight: null };

export async function statuses(fresh = false): Promise<AppStatus[]> {
  if (!fresh && cache.list && Date.now() - cache.at < 15_000) return cache.list;
  cache.inflight ??= Promise.all(suiteApps().map((a) => probe(a)))
    .then((list) => {
      cache.list = list;
      cache.at = Date.now();
      return list;
    })
    .finally(() => {
      cache.inflight = null;
    });
  return cache.inflight;
}
