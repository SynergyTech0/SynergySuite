import { describe, expect, it } from "vitest";
import { runOp } from "../lib/connect";
import { UserError } from "../lib/util";

const person = { email: "ada@example.com", subject: "sub-123", name: "Ada Lovelace" };
const env = { NODE_ENV: "production", PROXY_SHARED_SECRET: "gw-secret" } as unknown as NodeJS.ProcessEnv;

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fake(routes: Record<string, (c: Call) => unknown>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body };
    calls.push(c);
    const key = `${c.method} ${url}`;
    const h = Object.entries(routes).find(([k]) => key.startsWith(k));
    if (!h) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    const out = h[1](c);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Synergy steps", () => {
  it("calls apps as the person, with the gateway's headers", async () => {
    const { f, calls } = fake({ "GET http://forms:3110/api/forms": () => [{ id: 3, title: "Sign-up" }] });
    const out = await runOp("forms.list", {}, person, { fetch: f, env });
    expect(out).toEqual({ options: [{ label: "Sign-up", value: "3" }] });
    expect(calls[0].headers).toMatchObject({
      "x-auth-request-email": "ada@example.com",
      "x-auth-request-user": "sub-123",
      "x-auth-request-preferred-username": "Ada Lovelace",
      "x-proxy-auth-secret": "gw-secret",
    });
    // A server-side call carries no Origin, so the apps' same-origin check lets it through.
    expect(Object.keys(calls[0].headers).map((h) => h.toLowerCase())).not.toContain("origin");
  });

  it("sends mail as a form post from the person's own mailbox", async () => {
    const { f, calls } = fake({ "POST http://mail:3200/api/send": () => ({ messageId: "<1@x>" }) });
    const out = await runOp("mail.send", { to: "a@x.com; b@x.com", subject: "Hi", body: "<b>Hello</b>", html: true }, person, { fetch: f, env });
    expect(out).toEqual({ sent: true, messageId: "<1@x>", to: ["a@x.com", "b@x.com"] });
    const form = new URLSearchParams(String(calls[0].body));
    expect(form.get("account")).toBe("suite");
    expect(form.get("to")).toBe("a@x.com, b@x.com");
    expect(form.get("html")).toBe("<b>Hello</b>");
    expect(form.get("text")).toBeNull();
    expect(calls[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("turns form responses into trigger items, newest first, answers by label", async () => {
    const { f } = fake({
      "GET http://forms:3110/api/forms/7/submissions": () => [
        { id: 4, data: { f0: "Ada" }, submitted_at: "2026-01-01T00:00:00Z" },
        { id: 9, data: { f0: "Grace", zz: "?" }, submitted_at: "2026-01-02T00:00:00Z" },
      ],
      "GET http://forms:3110/api/forms/7": () => ({ id: 7, title: "Sign-up", fields: [{ id: "f0", label: "Name" }] }),
    });
    const out = (await runOp("forms.responses", { formId: "7" }, person, { fetch: f, env })) as { items: { id: number; data: any }[] };
    expect(out.items.map((i) => i.id)).toEqual([9, 4]);
    expect(out.items[0].data).toMatchObject({ formTitle: "Sign-up", answers: { Name: "Grace", zz: "?" }, summary: "Name: Grace\nzz: ?" });
  });

  it("adds To Do notes with a follow-up change, since create doesn't take them", async () => {
    const { f, calls } = fake({
      "POST http://todo:3195/api/tasks": () => ({ id: "t1", title: "Call Ada" }),
      "PATCH http://todo:3195/api/tasks/t1": () => ({ id: "t1", title: "Call Ada", notes: "about the report" }),
    });
    const out = await runOp("todo.create", { title: "Call Ada", notes: "about the report", due: "2026-03-04" }, person, { fetch: f, env });
    expect(out).toMatchObject({ notes: "about the report" });
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ title: "Call Ada", due: "2026-03-04" });
    expect(JSON.parse(String(calls[0].body)).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("saves to Drive as raw bytes with a length", async () => {
    const { f, calls } = fake({ "PUT http://drive:3180/api/upload": () => ({ id: "d1", name: "a.txt", size: 5, version: 1 }) });
    await runOp("drive.save", { path: "/Reports/a.txt", text: "hello" }, person, { fetch: f, env });
    expect(calls[0].url).toBe("http://drive:3180/api/upload?path=Reports%2Fa.txt");
    expect(calls[0].headers["content-length"]).toBe("5");
    expect(Buffer.from(calls[0].body as Uint8Array).toString()).toBe("hello");
  });

  it("passes on an app's refusal as the person's error", async () => {
    const { f } = fake({ "POST http://chat:3080/api/channels/5/messages": () => new Response(JSON.stringify({ error: "not a member" }), { status: 403 }) });
    await expect(runOp("chat.post", { channelId: "5", body: "hi" }, person, { fetch: f, env })).rejects.toThrow("Chat: not a member");
  });

  it("refuses unknown operations and missing fields", async () => {
    const { f } = fake({});
    await expect(runOp("toString", {}, person, { fetch: f, env })).rejects.toBeInstanceOf(UserError);
    await expect(runOp("planner.create", { title: "x" }, person, { fetch: f, env })).rejects.toThrow("Bucket is required");
    await expect(runOp("mail.send", { to: "" }, person, { fetch: f, env })).rejects.toThrow("recipient");
  });
});
