/**
 * Synergy Base and Synergy Flow, asked server to server as the signed-in person (the gateway's
 * identity headers, with the shared secret), so their own sharing rules decide what an app can
 * read, change or run. Nothing in either app is changed for this; Builder uses their APIs.
 */
import { apps } from "@synergy/config";
import { HttpError } from "./http";
import type { BaseRow } from "./records";
import type { FieldKind, SourceField } from "./model";

/** Power Apps' data row limit: how many records one data source loads. */
export const MAX_ROWS = 2000;
const PAGE = 500;

function internalUrl(id: "base" | "flow", env: string): string {
  const set = process.env[env];
  if (set) return set.replace(/\/$/, "");
  const app = apps.find((a) => a.id === id);
  const port = app?.port ?? (id === "base" ? 3680 : 0);
  if (!port) return "";
  return process.env.NODE_ENV === "production" ? `http://${id}:${port}` : `http://127.0.0.1:${port}`;
}

async function call<T>(service: "Synergy Base" | "Synergy Flow", base: string, email: string, method: string, path: string, body?: unknown): Promise<T> {
  if (!base) throw new HttpError(502, `${service} isn't set up in this suite`);
  const headers: Record<string, string> = { "x-auth-request-email": email, "x-auth-request-user": email };
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(502, `${service} isn't reachable right now; try again in a moment`);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    if (res.status === 404) throw new HttpError(404, `${service} doesn't have that, or you don't have access to it`);
    if (res.status === 403) throw new HttpError(403, msg ?? `${service} didn't allow that`);
    if (res.status >= 400 && res.status < 500 && msg) throw new HttpError(res.status === 401 ? 502 : 400, msg);
    throw new HttpError(502, `${service} couldn't do that right now`);
  }
  return data as T;
}

const base = (email: string, method: string, path: string, body?: unknown) => call<any>("Synergy Base", internalUrl("base", "BASE_INTERNAL_URL"), email, method, path, body);

// ---- Base ------------------------------------------------------------------------------

export type BaseDatabase = { id: string; name: string; description: string; role: string };
export type BaseTable = { id: string; name: string; fields: SourceField[] };

export async function listDatabases(email: string): Promise<BaseDatabase[]> {
  const r = await base(email, "GET", "/databases");
  return (r.databases ?? []).map((d: any) => ({ id: d.id, name: d.name, description: d.description ?? "", role: d.role }));
}

const toField = (f: any): SourceField => ({
  id: String(f.id),
  name: String(f.name),
  type: f.type as FieldKind,
  ...(f.required ? { required: true } : {}),
  ...(Array.isArray(f.options?.choices) ? { choices: f.options.choices } : {}),
});

/** A database's tables with their fields, as the studio's data picker shows them. */
export async function listTables(email: string, databaseId: string): Promise<BaseTable[]> {
  const r = await base(email, "GET", `/databases/${encodeURIComponent(databaseId)}`);
  return (r.tables ?? []).map((t: any) => ({ id: t.id, name: t.name, fields: (t.fields ?? []).map(toField) }));
}

export async function getTable(email: string, tableId: string): Promise<BaseTable & { databaseId: string }> {
  const r = await base(email, "GET", `/tables/${encodeURIComponent(tableId)}`);
  return { id: r.table.id, name: r.table.name, databaseId: r.table.databaseId, fields: (r.table.fields ?? []).map(toField) };
}

/** Up to MAX_ROWS records, oldest first, read a page at a time. */
export async function listRows(email: string, tableId: string): Promise<{ rows: BaseRow[]; more: boolean }> {
  const rows: BaseRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const r = await base(email, "GET", `/tables/${encodeURIComponent(tableId)}/rows?offset=${offset}&limit=${PAGE}`);
    rows.push(...(r.rows ?? []));
    const total = typeof r.total === "number" ? r.total : null;
    if ((r.rows ?? []).length < PAGE || (total !== null && rows.length >= total)) return { rows, more: false };
  }
  return { rows: rows.slice(0, MAX_ROWS), more: true };
}

export async function insertRow(email: string, tableId: string, values: Record<string, unknown>): Promise<BaseRow> {
  const r = await base(email, "POST", `/tables/${encodeURIComponent(tableId)}/rows`, { records: [values] });
  return r.rows[0];
}

export async function updateRow(email: string, tableId: string, rowId: string, values: Record<string, unknown>): Promise<BaseRow> {
  const r = await base(email, "PATCH", `/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`, { values });
  return r.row;
}

export async function deleteRows(email: string, tableId: string, ids: string[]): Promise<void> {
  await base(email, "DELETE", `/tables/${encodeURIComponent(tableId)}/rows`, { ids });
}

// ---- Flow ------------------------------------------------------------------------------

export type FlowInfo = { id: string; name: string; inputs: { name: string; type: string }[] };

const flowUrl = () => internalUrl("flow", "FLOW_INTERNAL_URL");
const flow = (email: string, method: string, path: string, body?: unknown) => call<any>("Synergy Flow", flowUrl(), email, method, path, body);

/** Whether this suite has Synergy Flow to run flows with. */
export const flowsAvailable = () => !!flowUrl();

/** Thrown when this suite's Flow doesn't serve the app endpoints yet. */
export class FlowsNotReady extends HttpError {
  constructor() {
    super(501, "This suite's Synergy Flow can't run flows from apps yet");
  }
}

/** Flows this person can start from an app (a manual trigger). */
export async function listFlows(email: string): Promise<FlowInfo[]> {
  if (!flowsAvailable()) return [];
  let r: any;
  try {
    r = await flow(email, "GET", "/flows?trigger=manual");
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new FlowsNotReady();
    throw e;
  }
  // A Flow from before the app endpoints ignores ?trigger and answers with its UI's list
  // (flows and runs), which would offer flows that can't be started from an app.
  if (!r || !Array.isArray(r.flows) || "runs" in r) throw new FlowsNotReady();
  return (r.flows ?? []).map((f: any) => ({ id: String(f.id), name: String(f.name), inputs: Array.isArray(f.inputs) ? f.inputs : [] }));
}

/** Runs a flow by id or name with the app's inputs; its outputs come back when it finishes quickly. */
export async function runFlow(email: string, idOrName: string, inputs: Record<string, unknown>): Promise<{ runId: string; status: string; outputs: Record<string, unknown> | null }> {
  let id = idOrName;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(idOrName) || idOrName.includes(" ")) {
    const found = (await listFlows(email)).find((f) => f.name.toLowerCase() === idOrName.toLowerCase());
    if (!found) throw new HttpError(404, `There's no flow called "${idOrName}" that you can run`);
    id = found.id;
  } else {
    const list = await listFlows(email);
    const byName = list.find((f) => f.name.toLowerCase() === idOrName.toLowerCase());
    if (byName) id = byName.id;
  }
  let r: any;
  try {
    r = await flow(email, "POST", `/flows/${encodeURIComponent(id)}/run`, { inputs });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(404, `There's no flow "${idOrName}" that you can run from an app`);
    throw e;
  }
  return { runId: String(r.runId ?? ""), status: String(r.status ?? "running"), outputs: r.outputs ?? null };
}
