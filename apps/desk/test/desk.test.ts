import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Outgoing } from "../lib/mailer";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.DESK_DATABASE_URL = url;
}

const staff = "agent@example.com";
const customer = "pat@example.org";
const staffV = { email: staff, name: "Agent", role: "agent" as const, scope: "all" as const };

describe.skipIf(!url)("desk", async () => {
  const tickets = await import("../lib/tickets");
  const kb = await import("../lib/kb");
  const canned = await import("../lib/canned");
  const { outbox } = await import("../lib/mailer");
  const { q, db } = await import("../lib/db");

  // Captures what would have been emailed instead of talking to an SMTP server.
  let sent: Outgoing[] = [];
  let n = 0;
  outbox.send = async (m) => {
    sent.push(m);
    return { emailed: true, messageId: `<out-${++n}@desk.test>` };
  };

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE tickets, ticket_messages, ticket_counters, canned_replies, kb_articles, agents RESTART IDENTITY CASCADE");
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await db().close();
  });

  const year = new Date().getFullYear();

  it("numbers tickets per year without collisions", async () => {
    const made = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        tickets.create({ subject: `Load ${i}`, requesterEmail: `u${i}@example.org` }, { source: "api" })),
    );
    const numbers = made.map((t) => t.number).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers[0]).toBe(`T-${year}-0001`);
    expect(numbers[11]).toBe(`T-${year}-0012`);
  });

  it("validates new tickets", async () => {
    await expect(tickets.create({ subject: "", requesterEmail: customer }, { source: "manual" })).rejects.toThrow(/subject/);
    await expect(tickets.create({ subject: "x", requesterEmail: "nope" }, { source: "manual" })).rejects.toThrow(/email/);
    await expect(tickets.create({ subject: "x", requesterEmail: customer, priority: "meh" }, { source: "manual" })).rejects.toThrow(/priority/);
  });

  let id: number;
  let number: string;

  it("creates, replies, notes and changes a ticket", async () => {
    const t = await tickets.create(
      { subject: "Printer jam", requesterEmail: "Pat@Example.org", requesterName: "Pat Doe", body: "It eats paper", priority: "high" },
      { source: "manual", author: staff },
    );
    id = t.id;
    number = t.number;
    expect(t.requesterEmail).toBe(customer);
    expect(t.status).toBe("open");

    const r = await tickets.reply(id, staff, { body: "Try tray 2." });
    expect(r.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(customer);
    expect(sent[0].subject).toBe(`Re: Printer jam [${number}]`);
    expect((await tickets.get(id)).status).toBe("pending");

    await tickets.update(id, { status: "solved" });
    await tickets.reply(id, staff, { body: "Customer is VIP", internal: true });
    expect(sent).toHaveLength(1); // notes are never emailed
    const after = await tickets.get(id);
    expect(after.status).toBe("solved"); // and keep the status
    expect(after.solvedAt).not.toBeNull();
    expect(after.messages.map((m) => m.direction)).toEqual(["inbound", "outbound", "note"]);

    const changed = await tickets.update(id, { priority: "urgent", assignee: staff, status: "open" });
    expect(changed.priority).toBe("urgent");
    expect(changed.assignee).toBe(staff);
    expect(changed.solvedAt).toBeNull();
    await expect(tickets.update(id, { status: "done" })).rejects.toThrow(/status/);
    expect((await tickets.list(staffV, { view: "mine" })).map((x) => x.id)).toEqual([id]);
    expect((await tickets.list(staffV, { view: "all", q: "eats" })).map((x) => x.id)).toEqual([id]);
    expect((await tickets.list(staffV, { view: "all", q: "%" })).length).toBe(0);
    expect((await tickets.counts(staffV)).mine).toBe(1);
  });

  it("saves a reply that couldn't be emailed", async () => {
    const real = outbox.send;
    outbox.send = async () => ({ emailed: false, messageId: null, reason: "Email sending isn't set up" });
    const r = await tickets.reply(id, staff, { body: "Saved only" });
    outbox.send = real;
    expect(r.emailed).toBe(false);
    expect(r.message.emailed).toBe(false);
  });

  it("threads an emailed reply by its subject tag and reopens the ticket", async () => {
    await tickets.update(id, { status: "solved" });
    const r = await tickets.receive({
      from: customer, subject: `RE: Printer jam [${number}]`, messageId: "<in-1@mail.example.org>",
      text: "Tray 2 worked.\n\nOn Mon, Support wrote:\n> Try tray 2.",
    });
    expect(r).toEqual({ ticketId: id, created: false });
    const t = await tickets.get(id);
    expect(t.status).toBe("open");
    expect(t.messages.at(-1)!.body).toBe("Tray 2 worked.");
  });

  it("threads by In-Reply-To / References to a message we sent", async () => {
    const r = await tickets.receive({
      from: customer, subject: "Re: your email", messageId: "<in-2@mail.example.org>",
      inReplyTo: null, references: "<unrelated@x> <out-1@desk.test>", text: "One more thing",
    });
    expect(r?.ticketId).toBe(id);
    // The next staff reply answers the latest email in the chain.
    await tickets.reply(id, staff, { body: "Noted" });
    expect(sent[0].inReplyTo).toBe("<in-2@mail.example.org>");
    expect(sent[0].references).toEqual(["<out-1@desk.test>", "<in-1@mail.example.org>", "<in-2@mail.example.org>"]);
  });

  it("files the same email only once", async () => {
    const before = (await tickets.get(id)).messages.length;
    await tickets.receive({ from: customer, subject: "dup", messageId: "<in-2@mail.example.org>", text: "One more thing" });
    expect((await tickets.get(id)).messages.length).toBe(before);
  });

  it("opens a new ticket for a new email", async () => {
    const r = await tickets.receive({ from: "Sam@Example.net", fromName: "Sam", subject: "VPN down", messageId: "new-1@x", text: "Help" });
    expect(r?.created).toBe(true);
    const t = await tickets.get(r!.ticketId);
    expect(t.source).toBe("email");
    expect(t.requesterEmail).toBe("sam@example.net");
    // A reply to that first email (no tag) threads onto it.
    const again = await tickets.receive({ from: "sam@example.net", subject: "Re: VPN down", inReplyTo: "<new-1@x>", messageId: "<new-2@x>", text: "Still down" });
    expect(again).toEqual({ ticketId: t.id, created: false });
    expect(await tickets.receive({ from: "not-an-address", subject: "x", text: "" })).toBeNull();
  });

  it("feeds the portal without internal notes", async () => {
    const feed = await tickets.feedFor(" PAT@example.org ");
    expect(feed).toHaveLength(1);
    const row = feed[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["created_at", "message_count", "number", "priority", "status", "subject", "updated_at"]);
    const all = (await tickets.get(id)).messages;
    expect(row.message_count).toBe(all.filter((m) => m.direction !== "note").length);
    expect(row.number).toBe(number);
    await expect(tickets.feedFor("bad")).rejects.toThrow();
  });

  it("keeps canned replies", async () => {
    const c = await canned.create(staff, { title: "Reset", body: "Hi {{name}}" });
    expect((await canned.list()).map((x) => x.title)).toEqual(["Reset"]);
    expect((await canned.update(c.id, { title: "Reset password", body: "Hi" })).title).toBe("Reset password");
    await expect(canned.create(staff, { title: "x" })).rejects.toThrow();
    await canned.remove(c.id);
    expect(await canned.list()).toEqual([]);
  });

  it("publishes knowledge-base articles", async () => {
    const a = await kb.create(staff, { title: "Reset your password", body: "Go to settings" });
    const b = await kb.create(staff, { title: "Reset your password!", body: "dup title" });
    expect(a.slug).toBe("reset-your-password");
    expect(b.slug).toBe("reset-your-password-2");
    expect(await kb.published()).toEqual([]);
    expect(await kb.publishedBySlug(a.slug)).toBeNull();
    const pub = await kb.update(staff, a.id, { published: true, title: "Reset your password (new)" });
    expect(pub.slug).toBe(a.slug); // slugs stay put
    expect((await kb.published()).map((x) => x.slug)).toEqual([a.slug]);
    expect((await kb.publishedBySlug(a.slug))?.body).toBe("Go to settings");
    await kb.remove(b.id);
    expect((await kb.list()).length).toBe(1);
  });

  it("makes the first agent to arrive an admin, and keeps one", async () => {
    const agents = await import("../lib/agents");
    await q("TRUNCATE agents");
    // No agents at all: whoever opens Desk first runs it.
    expect((await agents.viewer({ email: "First@Example.com", name: "First" })).role).toBe("admin");
    await q("TRUNCATE agents");
    // Existing staff but no admin: a stranger stays a requester; the first agent becomes admin.
    await q("INSERT INTO agents (email) VALUES ($1)", [staff]);
    expect((await agents.viewer({ email: "stranger@example.org", name: "" })).role).toBeNull();
    const boss = await agents.viewer({ email: staff, name: "Agent" });
    expect(boss).toMatchObject({ role: "admin", scope: "all" });
    expect((await agents.viewer({ email: customer, name: "" })).role).toBeNull();
    await expect(agents.save(boss, { email: staff, role: "agent" })).rejects.toThrow(/at least one admin/);
    await expect(agents.remove(boss, staff)).rejects.toThrow(/at least one admin/);
    const rae = await agents.save(boss, { email: "Rae@Example.com", scope: "assigned" });
    expect(rae).toMatchObject({ email: "rae@example.com", role: "agent", scope: "assigned" });
    await expect(agents.save({ ...rae, name: "" }, { email: customer })).rejects.toThrow(/Only a Desk admin/);
    await agents.remove(boss, rae.email);
    expect((await agents.list()).map((a) => a.email)).toEqual([staff]);
  });
});
