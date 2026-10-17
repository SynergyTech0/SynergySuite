import { beforeEach, describe, expect, it, vi } from "vitest";

// The editor's AI window posts OpenAI-format chats to /api/ai/chat; the suite's model answers.
process.env.PROXY_SHARED_SECRET = "gateway-secret";
let incoming = new Headers();
vi.mock("next/headers", () => ({ headers: async () => incoming }));
const chat = vi.fn(async (_opts: { system?: string; prompt: string }) => "```mermaid\ngraph TD\n  A-->B\n```");
vi.mock("@synergy/ai", async (orig) => ({ ...(await orig<typeof import("@synergy/ai")>()), chat: (o: { system?: string; prompt: string }) => chat(o) }));

const { editorAiSettings, readChat } = await import("../lib/ai");
const route = await import("../app/api/ai/chat/route");

const ON = { DIAGRAMS_AI_BASE_URL: "http://models.local/v1", DIAGRAMS_AI_MODEL: "local-model" };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(new Request("http://diagrams/api/ai/chat", { method: "POST", headers: { host: "diagrams", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("diagrams AI", () => {
  beforeEach(() => {
    chat.mockClear();
    incoming = new Headers({ "x-auth-request-email": "alice@example.com", "x-proxy-auth-secret": "gateway-secret" });
    for (const k of Object.keys(ON)) delete process.env[k];
    delete process.env.AI_MODEL;
  });

  it("points draw.io's AI window at this app only when a model is set", async () => {
    expect(await editorAiSettings({})).toEqual({ enableAi: false });
    const s = (await editorAiSettings(ON)) as Record<string, any>;
    expect(s.enableAi).toBe(true);
    expect(s.aiConfigs.synergy.endpoint).toBe("/api/ai/chat");
    expect(s.aiConfigs.synergy.requestHeaders).toEqual({});
    expect(s.aiModels).toEqual([{ name: "Suite model (local-model)", model: "suite", config: "synergy" }]);
    // Never the real key.
    expect(JSON.stringify(s)).not.toMatch(/sk-|models\.local/);
  });

  it("reads the system and user text of a chat", () => {
    expect(readChat({ messages: [{ role: "system", content: "Be brief" }, { role: "user", content: "A flowchart" }] })).toEqual({ system: "Be brief", prompt: "A flowchart" });
    expect(() => readChat({ messages: [] })).toThrow();
    expect(() => readChat({ messages: [{ role: "system", content: "x" }] })).toThrow(/what the diagram/);
  });

  it("answers in OpenAI's format with the suite's model", async () => {
    Object.assign(process.env, ON);
    const res = await post({ model: "suite", messages: [{ role: "system", content: "Make diagrams" }, { role: "user", content: "Login flow" }] });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toContain("graph TD");
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ system: "Make diagrams", prompt: "Login flow" }));
  });

  it("says AI is off, refuses strangers and other sites, in draw.io's error shape", async () => {
    const off = await post({ messages: [{ role: "user", content: "x" }] });
    expect(off.status).toBe(503);
    expect((await off.json()).error.message).toMatch(/AI is off/);
    Object.assign(process.env, ON);
    incoming = new Headers();
    expect((await post({ messages: [{ role: "user", content: "x" }] })).status).toBe(401);
    incoming = new Headers({ "x-auth-request-email": "alice@example.com", "x-proxy-auth-secret": "gateway-secret" });
    expect((await post({ messages: [{ role: "user", content: "x" }] }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("{not json")).status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });
});
