import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("livechat", async () => {
  const widgets = await import("../lib/widgets");
  const chat = await import("../lib/chat");
  const { q, db } = await import("../lib/db");
  const startRoute = await import("../app/api/wc/start/route");
  const messageRoute = await import("../app/api/wc/message/route");
  const pollRoute = await import("../app/api/wc/poll/route");
  const configRoute = await import("../app/api/wc/config/route");

  let ip = 0;
  const req = (path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) =>
    new Request(`http://livechat/api/wc/${path}`, {
      method: init.method ?? "POST",
      headers: {
        "content-type": "text/plain",
        "x-forwarded-for": `203.0.113.${++ip % 250}`,
        ...(init.origin === null ? {} : { origin: init.origin ?? "https://www.shop.example" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  beforeAll(async () => {
    await q("TRUNCATE widgets, conversations, messages RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    delete process.env.DESK_SVC_URL;
    delete process.env.DESK_SVC_TOKEN;
    await db().close();
  });

  it("runs a chat from the widget to an agent and back", async () => {
    const w = await widgets.createWidget("admin@example.com", { name: "Shop", domain: "shop.example", greeting: "Hello there", color: "#123456" });
    expect(w.widget_key).toMatch(/^wc_/);

    const cfg = await configRoute.GET(req(`config?k=${w.widget_key}`, { method: "GET" }));
    expect(cfg.status).toBe(200);
    expect(cfg.headers.get("access-control-allow-origin")).toBe("https://www.shop.example");
    expect(await cfg.json()).toEqual({ name: "Shop", greeting: "Hello there", color: "#123456", askEmail: true });

    const started = await startRoute.POST(req("start", { body: { k: w.widget_key, name: "Vera", email: "Vera@Example.com", page: "https://www.shop.example/cart?x=1" } }));
    expect(started.status).toBe(200);
    const { token } = await started.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // Only a hash of the token is stored.
    expect(JSON.stringify(await q("SELECT * FROM conversations"))).not.toContain(token);

    expect((await messageRoute.POST(req("message", { body: { token, body: "Where is my order?" } }))).status).toBe(200);

    const [c] = await chat.listConversations("open");
    expect(c.visitor_name).toBe("Vera");
    expect(c.visitor_email).toBe("vera@example.com");
    expect(c.page).toBe("https://www.shop.example/cart");
    expect(c.unread).toBe(1);
    expect(c.last_body).toBe("Where is my order?");

    await chat.agentReply(c.id, "agent@example.com", { body: "Let me check." });
    const [after] = await chat.listConversations("open");
    expect(after.unread).toBe(0);
    expect(after.assigned_to).toBe("agent@example.com");

    const polled = await (await pollRoute.GET(req(`poll?token=${token}&after=0`, { method: "GET" }))).json();
    expect(polled.messages.map((m: { sender: string; body: string }) => [m.sender, m.body])).toEqual([
      ["system", "Hello there"],
      ["visitor", "Where is my order?"],
      ["agent", "Let me check."],
    ]);
    // Agents' addresses don't reach the visitor.
    expect(JSON.stringify(polled)).not.toContain("agent@example.com");
    const last = polled.messages[2].id;
    expect((await (await pollRoute.GET(req(`poll?token=${token}&after=${last}`, { method: "GET" }))).json()).messages).toEqual([]);
  });

  it("refuses other sites, unknown widgets and bad tokens", async () => {
    const [w] = await widgets.listWidgets();
    const wrong = await startRoute.POST(req("start", { body: { k: w.widget_key }, origin: "https://evil.example" }));
    expect(wrong.status).toBe(403);
    expect((await startRoute.POST(req("start", { body: { k: w.widget_key }, origin: null }))).status).toBe(403);
    expect((await startRoute.POST(req("start", { body: { k: "wc_nope" } }))).status).toBe(404);
    expect((await messageRoute.POST(req("message", { body: { token: "x".repeat(32), body: "hi" } }))).status).toBe(404);
    expect((await startRoute.POST(req("start", { body: { k: w.widget_key, email: "not-an-email" } }))).status).toBe(400);
  });

  it("closes and reopens chats; a visitor writing again reopens it", async () => {
    const [c] = await chat.listConversations("open");
    await chat.setStatus(c.id, "closed", "agent@example.com");
    expect(await chat.listConversations("open")).toEqual([]);
    expect((await chat.listConversations("closed")).map((x) => x.id)).toEqual([c.id]);
    await chat.visitorSays(c.id, { body: "Still there?" });
    expect((await chat.listConversations("open")).map((x) => x.id)).toEqual([c.id]);
    expect((await chat.listConversations("open", "someone@example.com"))).toEqual([]);
    expect((await chat.listConversations("open", "agent@example.com")).map((x) => x.id)).toEqual([c.id]);
  });

  it("hands a chat to Desk through its intake API, once", async () => {
    const [c] = await chat.listConversations("open");
    await expect(chat.sendToDesk(c.id, "agent@example.com")).rejects.toThrow(/Desk isn't connected/);
    process.env.DESK_SVC_URL = "http://desk.test:3105/";
    process.env.DESK_SVC_TOKEN = "desk-token";
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeDesk = (async (u: string, init: RequestInit) => {
      calls.push({ url: u, init });
      return new Response(JSON.stringify({ id: 7, number: "2026-0042" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await chat.sendToDesk(c.id, "agent@example.com", fakeDesk)).toEqual({ number: "2026-0042" });
    expect(calls[0].url).toBe("http://desk.test:3105/api/intake");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer desk-token");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.email).toBe("vera@example.com");
    expect(sent.name).toBe("Vera");
    expect(sent.priority).toBe("normal");
    expect(sent.subject).toBe("Live chat: Where is my order?");
    expect(sent.body).toContain("Vera");
    expect(sent.body).toContain("Let me check.");
    const { conversation, messages } = await chat.openConversation(c.id);
    expect(conversation.ticket_number).toBe("2026-0042");
    expect(messages.at(-1)?.body).toContain("2026-0042");
    await expect(chat.sendToDesk(c.id, "agent@example.com", fakeDesk)).rejects.toThrow(/already/);
  });

  it("won't send a chat without an email to Desk, and reports Desk failures", async () => {
    const [w] = await widgets.listWidgets();
    const { id } = await chat.start(w, {});
    await chat.visitorSays(id, { body: "hi" });
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(chat.sendToDesk(id, "agent@example.com", failing)).rejects.toThrow(/email/);
    await chat.visitorSays(id, { body: "it's me", email: "me@example.com" });
    await expect(chat.sendToDesk(id, "agent@example.com", failing)).rejects.toThrow(/didn't take/);
  });

  it("deletes a widget with its chats", async () => {
    const [w] = await widgets.listWidgets();
    await widgets.deleteWidget(w.id);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM messages"))[0].n).toBe(0);
  });
});
