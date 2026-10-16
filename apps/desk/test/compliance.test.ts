import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside desk.test.ts.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_compliance`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const agent = "agent@example.com";
const lead = "lead@example.com";
const pat = "pat@example.org";
const sam = "sam@example.org";

const held = new Set<string>();
let days: number | null = null;
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async (kind) => (kind === "ticket" ? days : null),
  invalidate() {},
};

describe.skipIf(!base)("desk compliance", async () => {
  if (base) process.env.DATABASE_URL = process.env.DESK_DATABASE_URL = await ownDatabase(base);
  const tickets = await import("../lib/tickets");
  const { outbox } = await import("../lib/mailer");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");
  outbox.send = async () => ({ emailed: true, messageId: `<out-${Math.random()}@desk.test>` });

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://desk/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const search = async (body: Record<string, unknown>) => {
    const res = await call(searchRoute, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResponse;
  };
  const subjects = (r: SearchResponse) => r.hits.map((h) => h.title.replace(/^T-\d+-\d+ /, "")).sort();

  let printer: { id: number };
  let login: { id: number };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE tickets, ticket_messages, ticket_counters, canned_replies, kb_articles RESTART IDENTITY CASCADE");
    printer = await tickets.create(
      { subject: "Printer jams", requesterEmail: "Pat@example.org", body: "The printer on floor 2 jams every morning", assignee: agent },
      { source: "manual" },
    );
    await tickets.reply(printer.id, agent, { body: "Have you tried new paper?" });
    await tickets.reply(printer.id, lead, { body: "Escalate to facilities if it happens again", internal: true });
    login = await tickets.create({ subject: "Can't sign in", requesterEmail: sam, body: "Password reset loops" }, { source: "manual" });
    await q("UPDATE tickets SET updated_at = '2020-01-01T12:00:00Z' WHERE id = $1", [login.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { kinds: [1] })).status).toBe(400);
    expect((await call(exportRoute, { ids: [1] })).status).toBe(400);
  });

  it("searches threads, internal notes included, by custodians, dates and kinds", async () => {
    expect(subjects(await search({}))).toEqual(["Can't sign in", "Printer jams"]);
    expect(subjects(await search({ query: "facilities" }))).toEqual(["Printer jams"]);
    expect(subjects(await search({ query: "printer -paper" }))).toEqual([]);
    expect(subjects(await search({ query: '"password reset" OR toner' }))).toEqual(["Can't sign in"]);
    const forPat = await search({ custodians: [pat] });
    expect(forPat.hits).toEqual([expect.objectContaining({ owner: pat, participants: [agent, lead], kind: "ticket" })]);
    // Staff are found as participants: the assignee and anyone who wrote a note.
    expect(subjects(await search({ custodians: [lead] }))).toEqual(["Printer jams"]);
    expect(subjects(await search({ to: "2020-01-01" }))).toEqual(["Can't sign in"]);
    expect(subjects(await search({ from: "2020-01-02" }))).toEqual(["Printer jams"]);
    expect((await search({ kinds: ["message"] })).hits).toEqual([]);
    const page = await search({ limit: 1 });
    const next = await search({ limit: 1, cursor: page.nextCursor });
    expect([page.hits[0].id, next.hits[0].id].sort()).toEqual([String(printer.id), String(login.id)].sort());
    expect(next.nextCursor).toBeUndefined();
    expect((await search({ query: "floor" })).hits[0].snippet).toContain("floor 2 jams");
  });

  it("exports the whole thread, with internal notes as metadata", async () => {
    const { items } = await (await call(exportRoute, { ids: [String(printer.id), "999"] })).json();
    expect(items).toHaveLength(1);
    const [t] = items;
    expect(t).toMatchObject({ app: "desk", id: String(printer.id), owner: pat });
    expect(t.text).toContain("floor 2 jams");
    expect(t.text).toContain("new paper");
    expect(t.text).not.toContain("facilities");
    expect(t.metadata.messages.map((m: { direction: string }) => m.direction)).toEqual(["inbound", "outbound", "note"]);
    expect(t.metadata.internalNotes).toEqual([expect.objectContaining({ author: lead, body: "Escalate to facilities if it happens again" })]);
    expect(t.metadata).toMatchObject({ assignee: agent, status: "pending", requesterEmail: "pat@example.org" });
  });

  it("applies retention to old closed tickets, except where anyone on them is held", async () => {
    await tickets.update(printer.id, { status: "closed" });
    await tickets.update(login.id, { status: "solved" });
    await q("UPDATE tickets SET updated_at = now() - interval '400 days'");
    expect(await tickets.expireTickets()).toBe(0); // no rule yet
    days = 365;
    held.add(lead);
    expect(await tickets.expireTickets()).toBe(1);
    expect(subjects(await search({}))).toEqual(["Printer jams"]);
    held.clear();
    expect(await tickets.expireTickets()).toBe(1);
    expect(await q("SELECT 1 FROM ticket_messages")).toEqual([]);
    days = null;
  });
});
