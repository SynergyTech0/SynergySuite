import { describe, expect, it } from "vitest";
import { formBody, formKey, listManualFlows, manualTrigger, runFlow } from "../lib/run";

const env = { FLOW_ENGINE_URL: "http://engine" } as unknown as NodeJS.ProcessEnv;
const s = { token: "tok", projectId: "proj", userId: "u" };

const respond = (piece: string) => ({
  name: "step_1",
  type: "PIECE",
  settings: { pieceName: piece, actionName: "return_response", input: {} },
});

function formVersion(id: string, opts: { reply?: boolean; inputs?: unknown[] } = {}) {
  return {
    id,
    displayName: "Approve request",
    trigger: {
      type: "PIECE_TRIGGER",
      settings: {
        pieceName: "@activepieces/piece-forms",
        triggerName: "form_submission",
        input: {
          inputs: opts.inputs ?? [
            { displayName: "Customer name", type: "text", required: true },
            { displayName: "Urgent", type: "toggle" },
            { displayName: "Notes", type: "text_area" },
          ],
        },
      },
      ...(opts.reply ? { nextAction: respond("@activepieces/piece-forms") } : {}),
    },
  };
}

function hookVersion(id: string, authType = "none") {
  return {
    id,
    displayName: "Hook",
    trigger: {
      type: "PIECE_TRIGGER",
      settings: { pieceName: "@activepieces/piece-webhook", triggerName: "catch_webhook", input: { authType } },
      nextAction: { name: "step_1", type: "CODE", settings: {}, nextAction: respond("@activepieces/piece-webhook") },
    },
  };
}

/** A stand-in engine holding these flows; records webhook calls. */
function engine(flows: any[], webhook: (path: string, body: any) => Response, runs: any[] = []) {
  const calls: { path: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api/, "");
    const ok = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (p === "/v1/flows") return ok({ data: flows, next: null });
    const one = p.match(/^\/v1\/flows\/([^/]+)$/);
    if (one) {
      const f = flows.find((x) => x.id === one[1]);
      return ok({ ...f, version: f.versions[u.searchParams.get("versionId")!] });
    }
    if (p === "/v1/flow-runs") return ok({ data: runs.filter((r) => r.flowId === u.searchParams.get("flowId")) });
    if (p.startsWith("/v1/webhooks/")) {
      const body = JSON.parse(String(init.body));
      calls.push({ path: p, body });
      return webhook(p, body);
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const flow = (id: string, version: any, extra: Record<string, unknown> = {}) => ({
  id,
  status: "ENABLED",
  publishedVersionId: version.id,
  version,
  versions: { [version.id]: version },
  ...extra,
});

describe("flows other apps can start", () => {
  it("matches the engine's form field keys", () => {
    expect(formKey("Customer name")).toBe("customerName");
    expect(formKey("Email Address")).toBe("emailAddress");
    expect(formKey("It's  urgent")).toBe("itsUrgent");
  });

  it("recognises Web Form and open Catch Webhook triggers only", () => {
    expect(manualTrigger(formVersion("v1"))).toEqual({
      kind: "form",
      responds: false,
      inputs: [
        { name: "customerName", type: "text", label: "Customer name", required: true },
        { name: "urgent", type: "boolean", label: "Urgent", required: false },
        { name: "notes", type: "text", label: "Notes", required: false },
      ],
    });
    expect(manualTrigger(formVersion("v1", { reply: true }))?.responds).toBe(true);
    expect(manualTrigger(hookVersion("v2"))).toEqual({ kind: "webhook", responds: true });
    expect(manualTrigger(hookVersion("v2", "basic"))).toBeNull();
    expect(manualTrigger({ trigger: { type: "PIECE_TRIGGER", settings: { pieceName: "@synergy/piece-synergy", triggerName: "new_email" } } })).toBeNull();
    expect(manualTrigger(null)).toBeNull();
  });

  it("lists enabled flows by their published version", async () => {
    const draft = { id: "draft", displayName: "Edited", trigger: { type: "EMPTY" } };
    const pub = formVersion("pub");
    const e = engine(
      [
        { ...flow("f1", pub), version: draft, versions: { pub } },
        flow("f2", hookVersion("h")),
        flow("f3", formVersion("off"), { status: "DISABLED" }),
        flow("f4", formVersion("x"), { publishedVersionId: null }),
        flow("f5", hookVersion("locked", "header")),
      ],
      () => new Response("{}"),
    );
    const out = await listManualFlows(s, { env, fetch: e.f });
    expect(out.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(out[0].inputs?.map((i) => i.name)).toEqual(["customerName", "urgent", "notes"]);
    expect(out[1]).toEqual({ id: "f2", name: "Hook" });
  });

  it("builds the form body by key or label, with booleans and required checks", () => {
    const inputs = manualTrigger(formVersion("v"))!.inputs!;
    expect(formBody(inputs, { customerName: "Ann", Urgent: "true" })).toEqual({ customerName: "Ann", urgent: true, notes: "" });
    expect(formBody(inputs, { "customer name": "Bo", notes: { a: 1 } })).toEqual({ customerName: "Bo", urgent: false, notes: '{"a":1}' });
    expect(() => formBody(inputs, { urgent: true })).toThrow(/"Customer name" is required/);
  });

  it("waits for a replying flow and returns its answer", async () => {
    const now = new Date().toISOString();
    const e = engine(
      [flow("f1", formVersion("v", { reply: true }))],
      () => new Response(JSON.stringify({ type: "markdown", value: "Approved", files: [] })),
      [{ id: "run-1", flowId: "f1", status: "SUCCEEDED", created: now }],
    );
    const r = await runFlow(s, "f1", { customerName: "Ann" }, { env, fetch: e.f, tries: 1 });
    expect(r).toEqual({ runId: "run-1", status: "succeeded", outputs: { message: "Approved" } });
    expect(e.calls).toEqual([{ path: "/v1/webhooks/f1/sync", body: { customerName: "Ann", urgent: false, notes: "" } }]);
  });

  it("starts a flow without a reply step and doesn't wait", async () => {
    const e = engine([flow("f2", formVersion("v"))], () => new Response("{}"), []);
    const r = await runFlow(s, "f2", { customerName: "Ann" }, { env, fetch: e.f, tries: 1 });
    expect(r).toEqual({ runId: null, status: "running" });
    expect(e.calls[0].path).toBe("/v1/webhooks/f2");
  });

  it("reports failed and slow replying runs", async () => {
    const failing = engine([flow("f1", hookVersion("h"))], () => new Response(JSON.stringify({ message: "failed" }), { status: 500 }));
    expect(await runFlow(s, "f1", { qty: 1 }, { env, fetch: failing.f, tries: 1 })).toEqual({ runId: null, status: "failed" });
    expect(failing.calls[0].body).toEqual({ qty: 1 });
    const slow = engine([flow("f1", hookVersion("h"))], () => new Response("{}", { status: 408 }));
    expect(await runFlow(s, "f1", {}, { env, fetch: slow.f, tries: 1 })).toEqual({ runId: null, status: "running" });
  });

  it("refuses flows that aren't the caller's, aren't on, or can't be started from an app", async () => {
    const e = engine([flow("f1", formVersion("v"), { status: "DISABLED" }), flow("f2", hookVersion("h", "hmac"))], () => new Response("{}"));
    for (const id of ["f1", "f2", "someone-elses"]) {
      await expect(runFlow(s, id, {}, { env, fetch: e.f, tries: 1 })).rejects.toMatchObject({ status: 404 });
    }
    expect(e.calls).toEqual([]);
  });
});
