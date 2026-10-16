/** RunFlow's link to Synergy Flow, against a stand-in for Flow's API. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { listFlows, runFlow } from "@/lib/services";

const me = "maker@example.com";

function flowAnswers(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  process.env.FLOW_INTERNAL_URL = "http://flow.test";
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FLOW_INTERNAL_URL;
});

describe("flows", () => {
  it("lists manual flows and runs one by name as the person using the app", async () => {
    const calls = flowAnswers((url) =>
      url.endsWith("/api/flows?trigger=manual")
        ? { status: 200, body: { flows: [{ id: "f_123456", name: "Send report", inputs: [{ name: "to", type: "text" }] }] } }
        : { status: 200, body: { runId: "r1", status: "succeeded", outputs: { sent: true } } },
    );
    expect(await listFlows(me)).toEqual([{ id: "f_123456", name: "Send report", inputs: [{ name: "to", type: "text" }] }]);
    const r = await runFlow(me, "Send report", { to: "a@example.com" });
    expect(r).toEqual({ runId: "r1", status: "succeeded", outputs: { sent: true } });
    const run = calls.at(-1)!;
    expect(run.url).toBe("http://flow.test/api/flows/f_123456/run");
    expect(JSON.parse(String(run.init.body))).toEqual({ inputs: { to: "a@example.com" } });
    expect((run.init.headers as Record<string, string>)["x-auth-request-email"]).toBe(me);
  });

  it("treats a Flow without the app endpoints as not ready", async () => {
    flowAnswers(() => ({ status: 200, body: { flows: [{ id: "f_1", name: "Any" }], runs: [] } }));
    await expect(listFlows(me)).rejects.toMatchObject({ status: 501 });
    flowAnswers(() => ({ status: 404, body: { error: "Not found" } }));
    await expect(listFlows(me)).rejects.toMatchObject({ status: 501 });
  });
});
