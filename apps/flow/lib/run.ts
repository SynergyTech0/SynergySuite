import { api, EngineError, engineUrl, type EngineOptions, type Session } from "./engine";
import { UserError } from "./util";

/**
 * Flows other suite apps can start, like a Builder app's button starting a flow. A flow qualifies
 * when it is on and its published version starts with the engine's Web Form trigger (Human Input
 * piece; its fields become the flow's inputs) or with a Catch Webhook trigger that needs no
 * credentials. Flow starts it through the engine's webhook as the caller, and only for flows in
 * the caller's own project.
 */

const FORMS = "@activepieces/piece-forms";
const WEBHOOK = "@activepieces/piece-webhook";

export type InputType = "text" | "boolean" | "file";

export interface FlowInput {
  /** The key the caller sends the value under. */
  name: string;
  type: InputType;
  /** The field's name as written in the designer. */
  label: string;
  required: boolean;
}

export interface ManualFlow {
  id: string;
  name: string;
  inputs?: FlowInput[];
}

interface ManualTrigger {
  kind: "form" | "webhook";
  inputs?: FlowInput[];
  /** The flow replies to its caller, so the run is waited for. */
  responds: boolean;
}

/** The Web Form trigger's key for a field (the engine's createKeyForFormInput). */
export function formKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (c) => c.toLowerCase())
    .replace(/[\\"'\n\r\t]/g, "");
}

const TYPES: Record<string, InputType> = { text: "text", text_area: "text", toggle: "boolean", file: "file" };

function steps(version: any): any[] {
  const out: any[] = [];
  const walk = (a: any) => {
    for (let s = a; s; s = s.nextAction) {
      out.push(s);
      for (const k of ["onSuccessAction", "onFailureAction", "firstLoopAction"]) if (s[k]) walk(s[k]);
      if (Array.isArray(s.children)) for (const c of s.children) walk(c);
    }
  };
  walk(version?.trigger?.nextAction);
  return out;
}

/** What starts this flow version, when another app can start it; null otherwise. */
export function manualTrigger(version: any): ManualTrigger | null {
  const t = version?.trigger;
  const st = t?.settings;
  if (!t || t.type !== "PIECE_TRIGGER" || !st) return null;
  const responds = steps(version).some((s) => s?.settings?.actionName === "return_response" && [FORMS, WEBHOOK].includes(s.settings.pieceName));
  if (st.pieceName === FORMS && st.triggerName === "form_submission") {
    const rows: any[] = Array.isArray(st.input?.inputs) ? st.input.inputs : [];
    const inputs = rows
      .filter((r) => r && typeof r.displayName === "string" && r.displayName.trim())
      .map((r) => ({ name: formKey(r.displayName), type: TYPES[r.type] ?? "text", label: r.displayName, required: !!r.required }));
    return { kind: "form", inputs, responds };
  }
  if (st.pieceName === WEBHOOK && st.triggerName === "catch_webhook") {
    const auth = st.input?.authType;
    if (auth && auth !== "none") return null;
    return { kind: "webhook", responds };
  }
  return null;
}

async function publishedVersion(s: Session, f: any, opts: EngineOptions): Promise<any> {
  if (!f.publishedVersionId) return null;
  if (f.version?.id === f.publishedVersionId) return f.version;
  const full = await api<any>("GET", `/v1/flows/${encodeURIComponent(f.id)}?versionId=${encodeURIComponent(f.publishedVersionId)}`, { ...opts, token: s.token });
  return full?.version ?? null;
}

async function enabledFlows(s: Session, opts: EngineOptions): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ projectId: s.projectId, limit: "100", status: "ENABLED" });
    if (cursor) q.set("cursor", cursor);
    const page: { data: any[]; next: string | null } = await api("GET", `/v1/flows?${q}`, { ...opts, token: s.token });
    out.push(...page.data.filter((f) => f.status === "ENABLED"));
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}

/** The person's flows another app can start. */
export async function listManualFlows(s: Session, opts: EngineOptions = {}): Promise<ManualFlow[]> {
  const out: ManualFlow[] = [];
  for (const f of await enabledFlows(s, opts)) {
    const t = manualTrigger(await publishedVersion(s, f, opts));
    if (!t) continue;
    out.push({ id: String(f.id), name: String(f.version?.displayName || "Untitled flow"), ...(t.inputs ? { inputs: t.inputs } : {}) });
  }
  return out;
}

/** The webhook body for a Web Form flow: values under each field's key, toggles as booleans. */
export function formBody(inputs: FlowInput[], given: Record<string, unknown>): Record<string, unknown> {
  const byLabel = new Map(Object.entries(given).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const body: Record<string, unknown> = {};
  for (const i of inputs) {
    let v = Object.prototype.hasOwnProperty.call(given, i.name) ? given[i.name] : byLabel.get(i.label.trim().toLowerCase());
    if (i.type === "boolean") v = v === true || v === "true" || v === 1 || v === "1";
    else if (i.type === "text") v = v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    if (i.required && (v === undefined || v === null || v === "")) throw new UserError(`"${i.label}" is required`);
    body[i.name] = v;
  }
  return body;
}

export interface RunResult {
  runId: string | null;
  status: "succeeded" | "failed" | "running";
  outputs?: Record<string, unknown>;
}

function toOutputs(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    // The Web Form's "Respond on UI" step answers { type: "markdown", value, files }.
    if (o.type === "markdown" && typeof o.value === "string") return { message: o.value, ...(Array.isArray(o.files) && o.files.length ? { files: o.files } : {}) };
    return o;
  }
  return { value: v };
}

/** The newest run of this flow started at or after `since`; runs show up a moment after the webhook answers. */
async function findRun(s: Session, flowId: string, since: number, opts: EngineOptions & { tries?: number }): Promise<{ id: string; status: string } | null> {
  for (let i = 0; i < (opts.tries ?? 6); i++) {
    const q = new URLSearchParams({ projectId: s.projectId, limit: "5" });
    q.append("flowId", flowId);
    const page: { data: any[] } = await api("GET", `/v1/flow-runs?${q}`, { ...opts, token: s.token });
    const hit = page.data.find((r) => Date.parse(r.created) >= since - 2000);
    if (hit) return { id: String(hit.id), status: String(hit.status) };
    if (i + 1 < (opts.tries ?? 6)) await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function runStatus(s: string | undefined): RunResult["status"] {
  if (s === "SUCCEEDED") return "succeeded";
  if (!s || ["RUNNING", "QUEUED", "PAUSED", "SCHEDULED"].includes(s)) return "running";
  return "failed";
}

/** Starts one of the person's flows with these inputs; waits for its answer when the flow replies. */
export async function runFlow(s: Session, flowId: string, given: Record<string, unknown>, opts: EngineOptions & { tries?: number } = {}): Promise<RunResult> {
  const flow = (await enabledFlows(s, opts)).find((f) => String(f.id) === flowId);
  const trigger = flow ? manualTrigger(await publishedVersion(s, flow, opts)) : null;
  if (!flow || !trigger) throw new UserError("No flow you can run from an app has that id", 404);
  const payload = trigger.kind === "form" ? formBody(trigger.inputs ?? [], given) : given;

  const since = Date.now();
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${engineUrl(opts.env)}/api/v1/webhooks/${encodeURIComponent(flowId)}${trigger.responds ? "/sync" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(trigger.responds ? 60_000 : 15_000),
    });
  } catch {
    throw new EngineError("The flow engine isn't answering", 503);
  }
  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : undefined;
  } catch {
    /* plain text answer */
  }
  if (res.status === 404) throw new UserError("That flow isn't published", 404);
  if (res.status === 429) throw new UserError("Too many runs right now; try again shortly", 429);

  const run = await findRun(s, flowId, since, opts).catch(() => null);
  if (!trigger.responds) return { runId: run?.id ?? null, status: run ? runStatus(run.status) : "running" };
  // A replying flow answers once its reply step runs; the engine gives up waiting after 30 seconds (408).
  if (res.status === 408) return { runId: run?.id ?? null, status: "running" };
  if (!res.ok) return { runId: run?.id ?? null, status: "failed" };
  const outputs = toOutputs(data);
  return { runId: run?.id ?? null, status: "succeeded", ...(outputs ? { outputs } : {}) };
}
