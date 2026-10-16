import { readFile } from "node:fs/promises";
import path from "node:path";
import { enginePassword, personKey, serviceAccount } from "./keys";
import { UserError } from "./util";

/**
 * The flow engine (Activepieces community edition) as Flow uses it. The engine runs on the
 * compose network; people reach its designer at flow-studio.<domain>, signed in by Flow:
 * each suite person gets their own engine account and project, with a password only Flow
 * knows (see keys.ts), and the gateway refuses the engine's own sign-in and sign-up pages.
 */

export const PIECE_NAME = "@synergy/piece-synergy";
export const CONNECTION_ID = "synergy";

export interface Person {
  email: string;
  name: string;
  /** The gateway's X-Auth-Request-User for this person. */
  subject: string;
}

export interface Session {
  token: string;
  projectId: string;
  userId: string;
}

export interface EngineOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export function engineUrl(env: NodeJS.ProcessEnv = process.env): string {
  const u = env.FLOW_ENGINE_URL || (env.NODE_ENV === "production" ? "http://flow-engine:80" : "http://localhost:8080");
  return u.replace(/\/+$/, "");
}

/** Where the engine reaches Flow, which the Synergy piece calls back. */
export function flowInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  const u = env.FLOW_INTERNAL_URL || (env.NODE_ENV === "production" ? "http://flow:3780" : "http://localhost:3780");
  return u.replace(/\/+$/, "");
}

export class EngineError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function api<T>(method: string, p: string, opts: EngineOptions & { token?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const f = opts.fetch ?? fetch;
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;
  let res: Response;
  try {
    res = await f(`${engineUrl(opts.env)}/api${p}`, { method, headers, body, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new EngineError("The flow engine isn't answering", 503);
  }
  const textBody = await res.text();
  let data: any = null;
  try {
    data = textBody ? JSON.parse(textBody) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new EngineError(data?.message || data?.code || `The flow engine answered ${res.status}`, res.status, data?.code);
  return data as T;
}

function names(name: string, email: string) {
  const clean = (name || email.split("@")[0]).trim().slice(0, 80) || "Synergy";
  const [first, ...rest] = clean.split(/\s+/);
  return { firstName: first, lastName: rest.join(" ") || "User" };
}

type AuthResponse = { token: string; projectId: string | null; id: string };

/** Signs in to the engine as this account, creating it the first time. */
async function signInOrUp(email: string, password: string, who: { firstName: string; lastName: string }, opts: EngineOptions): Promise<AuthResponse> {
  try {
    return await api<AuthResponse>("POST", "/v1/authentication/sign-in", { ...opts, json: { email, password } });
  } catch (e) {
    if (!(e instanceof EngineError) || e.status >= 500) throw e;
  }
  try {
    return await api<AuthResponse>("POST", "/v1/authentication/sign-up", {
      ...opts,
      json: { email, password, ...who, trackEvents: false, newsLetter: false },
    });
  } catch (e) {
    if (e instanceof EngineError && /EXIST/i.test(`${e.code} ${e.message}`)) {
      // The account is there but our password doesn't open it: FLOW_SECRET changed, or someone
      // made the account by hand. An admin removes it in the designer's platform settings.
      throw new UserError("Your flow engine account can't be opened with this server's FLOW_SECRET. Ask an admin to remove it so Flow can recreate it.", 409);
    }
    throw e;
  }
}

let service: { token: string; at: number } | null = null;

/** The engine's service account. The first account on a new engine becomes its platform admin, so Flow claims it first. */
export async function serviceSession(opts: EngineOptions = {}): Promise<string> {
  if (service && Date.now() - service.at < 6 * 3600_000) return service.token;
  const acct = serviceAccount(opts.env);
  const res = await signInOrUp(acct.email, acct.password, { firstName: "Synergy", lastName: "Flow" }, opts);
  service = { token: res.token, at: Date.now() };
  return res.token;
}

/** Test hook. */
export function resetServiceSession() {
  service = null;
  sessions.clear();
  pieceReady = null;
}

let pieceReady: Promise<void> | null = null;

/** Installs (or upgrades) the Synergy piece on the engine once per process. */
export function ensurePiece(opts: EngineOptions = {}): Promise<void> {
  pieceReady ??= installPiece(opts).catch((e) => {
    pieceReady = null;
    throw e;
  });
  return pieceReady;
}

export function pieceDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.FLOW_PIECE_DIR || path.join(process.cwd(), "piece", "dist");
}

/** The name and version of the Synergy piece this build of Flow carries. */
export async function pieceMeta(env?: NodeJS.ProcessEnv): Promise<{ name: string; version: string }> {
  return JSON.parse(await readFile(path.join(pieceDir(env), "piece.json"), "utf8"));
}

async function installPiece(opts: EngineOptions): Promise<void> {
  const dir = pieceDir(opts.env);
  const meta = await pieceMeta(opts.env);
  const token = await serviceSession(opts);
  try {
    const have = await api<{ version: string }>("GET", `/v1/pieces/${encodeURIComponent(meta.name)}?version=${encodeURIComponent(meta.version)}`, { ...opts, token });
    if (have?.version === meta.version) return;
  } catch (e) {
    if (!(e instanceof EngineError) || e.status !== 404) throw e;
  }
  const form = new FormData();
  form.set("packageType", "ARCHIVE");
  form.set("scope", "PLATFORM");
  form.set("pieceName", meta.name);
  form.set("pieceVersion", meta.version);
  form.set("pieceArchive", new Blob([new Uint8Array(await readFile(path.join(dir, "synergy-piece.tgz")))]), "synergy-piece.tgz");
  await api("POST", "/v1/pieces", { ...opts, token, form });
}

/** Signs this person in to the engine (creating their account the first time) and makes sure their Synergy connection exists. */
export async function personSession(person: Person, opts: EngineOptions = {}): Promise<Session> {
  const email = person.email.toLowerCase();
  const hit = sessions.get(email);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS && hit.subject === person.subject) return hit.session;
  await serviceSession(opts);
  const res = await signInOrUp(email, enginePassword(email, opts.env), names(person.name, email), opts);
  const session = toSession(res);
  try {
    await ensurePiece(opts);
    await ensureConnection(session, { ...person, email }, opts);
  } catch (e) {
    // Flows can still be built without the suite's own steps; the next visit tries again.
    console.error("[flow] Synergy piece or connection not ready:", (e as Error).message);
    return session;
  }
  sessions.set(email, { session, at: Date.now(), subject: person.subject });
  return session;
}

/** Engine tokens last days; Flow re-signs people in every half hour, which also refreshes their connection. */
const SESSION_TTL_MS = 30 * 60_000;
const sessions = new Map<string, { session: Session; at: number; subject: string }>();

/** Signs in only: null for someone who has never opened Flow (search must not create accounts). */
export async function existingSession(person: Person, opts: EngineOptions = {}): Promise<Session | null> {
  const email = person.email.toLowerCase();
  try {
    return toSession(await api<AuthResponse>("POST", "/v1/authentication/sign-in", { ...opts, json: { email, password: enginePassword(email, opts.env) } }));
  } catch (e) {
    if (e instanceof EngineError && e.status < 500) return null;
    throw e;
  }
}

function toSession(res: AuthResponse): Session {
  if (!res.projectId) throw new EngineError("The flow engine gave you no project", 502);
  return { token: res.token, projectId: res.projectId, userId: res.id };
}

async function ensureConnection(s: Session, person: Person, opts: EngineOptions): Promise<void> {
  await api("POST", "/v1/app-connections", {
    ...opts,
    token: s.token,
    json: {
      externalId: CONNECTION_ID,
      displayName: "Synergy",
      pieceName: PIECE_NAME,
      projectId: s.projectId,
      type: "CUSTOM_AUTH",
      value: { type: "CUSTOM_AUTH", props: { baseUrl: flowInternalUrl(opts.env), key: personKey(person, opts.env) } },
    },
  });
}

// ---- Flows and runs

export interface FlowSummary {
  id: string;
  name: string;
  enabled: boolean;
  published: boolean;
  trigger: string;
  updated: string;
}

export interface RunSummary {
  id: string;
  flowId: string;
  flowName: string;
  status: string;
  started: string | null;
  finished: string | null;
}

type Page<T> = { data: T[]; next: string | null };

function triggerLabel(t: any): string {
  if (!t || t.type === "EMPTY") return "No trigger yet";
  const piece = String(t.settings?.pieceName || "").replace(/^@[^/]+\/piece-/, "");
  const app = piece ? piece[0].toUpperCase() + piece.slice(1).replace(/-/g, " ") : "";
  return t.displayName ? (app ? `${t.displayName} (${app})` : t.displayName) : app || t.type;
}

export function toFlowSummary(f: any): FlowSummary {
  return {
    id: String(f.id),
    name: String(f.version?.displayName || "Untitled flow"),
    enabled: f.status === "ENABLED",
    published: !!f.publishedVersionId,
    trigger: triggerLabel(f.version?.trigger),
    updated: String(f.updated || f.created || ""),
  };
}

export async function listFlows(s: Session, opts: EngineOptions = {}): Promise<FlowSummary[]> {
  const out: FlowSummary[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ projectId: s.projectId, limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page: Page<any> = await api("GET", `/v1/flows?${q}`, { ...opts, token: s.token });
    out.push(...page.data.map(toFlowSummary));
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}

export async function listRuns(s: Session, opts: EngineOptions & { limit?: number; flowId?: string } = {}): Promise<RunSummary[]> {
  const q = new URLSearchParams({ projectId: s.projectId, limit: String(opts.limit ?? 25) });
  if (opts.flowId) q.append("flowId", opts.flowId);
  const page: Page<any> = await api("GET", `/v1/flow-runs?${q}`, { ...opts, token: s.token });
  return page.data.map((r) => ({
    id: String(r.id),
    flowId: String(r.flowId),
    flowName: String(r.flowVersion?.displayName || r.flowDisplayName || r.flow?.version?.displayName || ""),
    status: String(r.status),
    started: r.startTime ?? r.created ?? null,
    finished: r.finishTime ?? null,
  }));
}

export async function createFlow(s: Session, name: string, opts: EngineOptions = {}): Promise<FlowSummary> {
  const f = await api<any>("POST", "/v1/flows", { ...opts, token: s.token, json: { displayName: name, projectId: s.projectId } });
  return toFlowSummary(f);
}

export async function setFlowEnabled(s: Session, flowId: string, enabled: boolean, opts: EngineOptions = {}): Promise<FlowSummary> {
  const f = await api<any>("POST", `/v1/flows/${encodeURIComponent(flowId)}`, {
    ...opts,
    token: s.token,
    json: { type: "CHANGE_STATUS", request: { status: enabled ? "ENABLED" : "DISABLED" } },
  });
  return toFlowSummary(f);
}

export async function deleteFlow(s: Session, flowId: string, opts: EngineOptions = {}): Promise<void> {
  await api("DELETE", `/v1/flows/${encodeURIComponent(flowId)}`, { ...opts, token: s.token });
}

/** Replaces a new flow's steps with a recipe (see recipes.ts). */
export async function importFlow(s: Session, flowId: string, recipe: { displayName: string; trigger: unknown; schemaVersion: string }, opts: EngineOptions = {}): Promise<FlowSummary> {
  const f = await api<any>("POST", `/v1/flows/${encodeURIComponent(flowId)}`, {
    ...opts,
    token: s.token,
    json: { type: "IMPORT_FLOW", request: { displayName: recipe.displayName, trigger: recipe.trigger, schemaVersion: recipe.schemaVersion, notes: null } },
  });
  return toFlowSummary(f);
}
