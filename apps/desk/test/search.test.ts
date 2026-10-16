import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own next to
// that one ("<name>_search"), so it can run alongside the other suites.
const base = process.env.TEST_DATABASE_URL;
process.env.PROXY_SHARED_SECRET = "gateway-secret";

// Route handlers read the request's headers through next/headers; the test sets them per call.
let current = new Headers();
vi.mock("next/headers", () => ({ headers: async () => current }));

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_search`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const agent = "agent@example.com";
const other = "other.agent@example.com";

describe.skipIf(!base)("desk search", async () => {
  if (base) process.env.DATABASE_URL = process.env.DESK_DATABASE_URL = await ownDatabase(base);
  const tickets = await import("../lib/tickets");
  const kb = await import("../lib/kb");
  const { outbox } = await import("../lib/mailer");
  const { q, db } = await import("../lib/db");
  const searchRoute = await import("../app/api/search/route");
  outbox.send = async () => ({ emailed: true, messageId: `<out-${Math.random()}@desk.test>` });

  const call = (email: string | null, body: unknown, secret = "gateway-secret") => {
    current = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": secret } : {});
    return searchRoute.POST(
      new Request("http://desk/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const titles = (r: SearchResults) => r.results.map((h) => `${h.kind}:${h.title.replace(/^T-\d+-\d+ /, "")}`).sort();

  let printer: { id: number }, login: { id: number };
  let draft: { id: number }, pub: { id: number };

  beforeAll(async () => {
    await q("TRUNCATE tickets, ticket_messages, ticket_counters, canned_replies, kb_articles RESTART IDENTITY CASCADE");
    printer = await tickets.create(
      { subject: "Printer jams", requesterEmail: "pat@example.org", requesterName: "Pat", body: "The printer on floor 2 jams every morning", assignee: agent },
      { source: "manual" },
    );
    await tickets.reply(printer.id, agent, { body: "Escalate to facilities if the printer jams again", internal: true });
    login = await tickets.create({ subject: "Can't sign in", requesterEmail: "sam@example.org", body: "Password reset loops" }, { source: "manual" });
    await q("UPDATE tickets SET updated_at = '2020-01-01T12:00:00Z' WHERE id = $1", [login.id]);
    draft = await kb.create(agent, { title: "Printer troubleshooting", body: "Clear the paper path", published: false });
    pub = await kb.create(other, { title: "Reset your password", body: "Use the printer-free reset page", published: true });
  });
  afterAll(async () => {
    await db().close();
  });

  it("finds tickets and articles, newest first, with links that open them", async () => {
    const r = await search(agent, { query: "printer" });
    expect(r.app).toBe("desk");
    expect(titles(r)).toEqual(["article:Printer troubleshooting (draft)", "article:Reset your password", "ticket:Printer jams"]);
    const dates = r.results.map((h) => h.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(r.results.find((h) => h.kind === "ticket")).toMatchObject({ id: `ticket:${printer.id}`, url: `/?ticket=${printer.id}`, person: "Pat" });
    expect(r.results.find((h) => h.title.startsWith("Reset"))).toMatchObject({ url: `/?article=${pub.id}`, person: other });
    const [note] = (await search(agent, { query: "facilities", text: true })).results;
    expect(note.snippet).toContain("facilities");
    expect(note.text).toContain("Escalate to facilities");
  });

  it("shows every signed-in person what the Desk's own lists show them: all tickets and all articles", async () => {
    // Desk has no roles: anyone signed in is staff, so another agent sees tickets assigned to someone
    // else and drafts written by someone else, as the ticket list and knowledge base do.
    expect(titles(await search(other, { query: "printer", kinds: ["ticket"] }))).toEqual(["ticket:Printer jams"]);
    expect(titles(await search(other, { query: "troubleshooting" }))).toEqual(["article:Printer troubleshooting (draft)"]);
    expect(titles(await search(other, { query: "sign" }))).toEqual(["ticket:Can't sign in"]);
    expect((await search(other, { query: "troubleshooting" })).results[0].url).toBe(`/?article=${draft.id}`);
  });

  it("honours kinds and limit", async () => {
    expect(titles(await search(agent, { query: "printer", kinds: ["article"] }))).toEqual(["article:Printer troubleshooting (draft)", "article:Reset your password"]);
    expect((await search(agent, { query: "printer", kinds: ["file"] })).results).toEqual([]);
    expect((await search(agent, { query: "printer", limit: 2 })).results).toHaveLength(2);
    expect(titles(await search(agent, { query: "printer -password" }))).toEqual(["article:Printer troubleshooting (draft)", "ticket:Printer jams"]);
  });

  it("needs a signed-in person and a query", async () => {
    expect((await call(null, { query: "printer" })).status).toBe(401);
    expect((await call(agent, { query: "printer" }, "wrong")).status).toBe(401);
    const empty = await call(agent, { query: " " });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBeTruthy();
    expect((await call(agent, {})).status).toBe(400);
  });
});
