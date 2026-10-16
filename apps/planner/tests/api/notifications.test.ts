import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, cardWatchers, cards, notifications, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST: Jira's assignee and reporter, watchers, in-app notifications and @mentions.
 *
 * The property that matters most is not the happy path but the leak: a notification carries a card
 * title and a comment excerpt, so it must only ever reach someone who can see that card. Mentioning a
 * person from another tenant, or assigning to them, must notify nobody.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
type Who = { userId: string; sub: string; email: string };
const actAs = (who: { sub: string; email: string }) => { identity.sub = who.sub; identity.email = who.email; };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function teammate(slug: string, t: Tenant, role: "member" | "observer" = "member"): Promise<Who> {
  const [u] = await db.insert(users).values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: t.workspaceId, userId: u.id, role });
  return { userId: u.id, sub: u.authSub!, email: u.email! };
}
const inbox = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));
const patchCard = async (id: string, body: unknown) => (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", body), ctx(id));
const comment = async (cardId: string, body: string) => (await import("@/app/api/comments/route")).POST(req("POST", { cardId, body }));
const mention = (who: Who, name: string) => `@[${name}](${who.userId})`;

let alice: Tenant;
let bob: Tenant;
let carol: Who;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  carol = await teammate("carol", alice);
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

describe("assignee and reporter", () => {
  it("a new card's reporter is its creator", async () => {
    const { POST } = await import("@/app/api/cards/route");
    const card = await (await POST(req("POST", { listId: alice.listId, title: "x" }))).json();
    expect(card.reporterId).toBe(alice.userId);
  });

  it("assigning notifies the assignee, and makes them a watcher", async () => {
    expect((await patchCard(alice.cardId, { assigneeId: carol.userId })).status).toBe(200);
    const [n] = await inbox(carol.userId);
    expect(n).toMatchObject({ type: "assigned", cardId: alice.cardId, actorId: alice.userId, readAt: null });
    const w = await db.select().from(cardWatchers).where(and(eq(cardWatchers.cardId, alice.cardId), eq(cardWatchers.userId, carol.userId)));
    expect(w).toHaveLength(1);
  });

  it("assigning yourself notifies no one", async () => {
    await patchCard(alice.cardId, { assigneeId: alice.userId });
    expect(await inbox(alice.userId)).toHaveLength(0);
  });

  it("refuses an assignee or reporter who cannot see the board", async () => {
    expect((await patchCard(alice.cardId, { assigneeId: bob.userId })).status).toBe(404);
    expect((await patchCard(alice.cardId, { reporterId: bob.userId })).status).toBe(404);
    expect(await inbox(bob.userId)).toHaveLength(0);
  });
});

describe("mentions", () => {
  it("mentioning a teammate in a comment notifies them with an excerpt", async () => {
    await comment(alice.cardId, `can you check this ${mention(carol, "carol")}?`);
    const [n] = await inbox(carol.userId);
    expect(n.type).toBe("mentioned");
    expect((n.data as { excerpt: string }).excerpt).toContain("can you check this");
  });

  it("mentioning someone who cannot see the card notifies nobody and leaks nothing", async () => {
    await comment(alice.cardId, `secret plan ${mention({ userId: bob.userId, sub: "", email: "" }, "bob")}`);
    expect(await inbox(bob.userId)).toHaveLength(0);
  });

  it("a mention in a description notifies too, once per edit that adds it", async () => {
    await patchCard(alice.cardId, { description: `spec owner ${mention(carol, "carol")}` });
    await patchCard(alice.cardId, { description: `spec owner ${mention(carol, "carol")} (updated)` });
    const ns = await inbox(carol.userId);
    expect(ns.filter((n) => n.type === "mentioned")).toHaveLength(1);
  });
});

describe("watchers", () => {
  it("a watcher is told about comments and moves by others, not their own", async () => {
    const { POST } = await import("@/app/api/cards/[id]/watch/route");
    actAs(carol);
    expect((await POST(req("POST"), ctx(alice.cardId))).status).toBe(200);
    await comment(alice.cardId, "carol's own comment");
    expect(await inbox(carol.userId)).toHaveLength(0);

    actAs(alice);
    await comment(alice.cardId, "alice replies");
    await patchCard(alice.cardId, { isComplete: true });
    const types = (await inbox(carol.userId)).map((n) => n.type).sort();
    expect(types).toEqual(["commented", "updated"]);
  });

  it("commenting makes you a watcher (as in Jira)", async () => {
    actAs(carol);
    await comment(alice.cardId, "I have thoughts");
    const w = await db.select().from(cardWatchers).where(eq(cardWatchers.userId, carol.userId));
    expect(w).toHaveLength(1);
  });

  it("an observer may watch; another tenant cannot", async () => {
    const olly = await teammate("olly", alice, "observer");
    const { POST } = await import("@/app/api/cards/[id]/watch/route");
    actAs(olly);
    expect((await POST(req("POST"), ctx(alice.cardId))).status).toBe(200);
    actAs(bob);
    expect((await POST(req("POST"), ctx(alice.cardId))).status).toBe(404);
  });

  it("a watcher who later loses access is not notified", async () => {
    const dave = await teammate("dave", alice);
    await db.insert(cardWatchers).values({ cardId: alice.cardId, userId: dave.userId });
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, dave.userId));
    await comment(alice.cardId, "after dave left");
    expect(await inbox(dave.userId)).toHaveLength(0);
  });
});

describe("reading notifications", () => {
  it("lists the caller's own notifications with card title and key, and an unread count", async () => {
    await db.update(cards).set({ issueKey: "ALI-1" }).where(eq(cards.id, alice.cardId));
    await patchCard(alice.cardId, { assigneeId: carol.userId });
    actAs(carol);
    const { GET } = await import("@/app/api/notifications/route");
    const body = await (await GET(new Request("http://localhost/api/notifications"))).json();
    expect(body.unread).toBe(1);
    expect(body.items[0]).toMatchObject({ type: "assigned", cardTitle: "alice card", issueKey: "ALI-1", actor: "User alice" });
  });

  it("marks one or all as read, and only the caller's own", async () => {
    await patchCard(alice.cardId, { assigneeId: carol.userId });
    await comment(alice.cardId, `ping ${mention(carol, "carol")}`);
    const [first] = await inbox(carol.userId);

    const { POST } = await import("@/app/api/notifications/read/route");
    actAs(alice);
    await POST(req("POST", { ids: [first.id] }));   // not alice's notification
    expect((await inbox(carol.userId)).every((n) => n.readAt === null)).toBe(true);

    actAs(carol);
    await POST(req("POST", { ids: [first.id] }));
    expect((await inbox(carol.userId)).filter((n) => n.readAt !== null)).toHaveLength(1);
    await POST(req("POST", { all: true }));
    expect((await inbox(carol.userId)).every((n) => n.readAt !== null)).toBe(true);
  });

  it("does not show a notification for a card the reader can no longer see", async () => {
    await patchCard(alice.cardId, { assigneeId: carol.userId });
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, carol.userId));
    await db.delete(boardMembers).where(eq(boardMembers.userId, carol.userId));
    actAs(carol);
    const { GET } = await import("@/app/api/notifications/route");
    const body = await (await GET(new Request("http://localhost/api/notifications"))).json();
    expect(body.items).toEqual([]);
    expect(body.unread).toBe(0);
  });
});
