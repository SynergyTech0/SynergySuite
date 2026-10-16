import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activities, boardMembers, cardLabels, cards, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST bulk edit (Jira's bulk change).
 *
 * A selection comes from search, so it can span boards — every card is therefore checked on its own:
 * its board's role decides whether it changes, and a list or sprint from another board is refused for
 * that card rather than for the whole request. The response says exactly how many changed and why the
 * rest did not, because a bulk edit that silently skips things is worse than one that fails.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const actAs = (who: { sub: string; email: string }) => { identity.sub = who.sub; identity.email = who.email; };
const req = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const bulk = async (body: unknown) => {
  const { POST } = await import("@/app/api/cards/bulk/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
};

let alice: Tenant;
let bob: Tenant;
let second: string;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  const [c] = await db.insert(cards).values({ listId: alice.listId, boardId: alice.boardId, title: "second", position: 2 }).returning();
  second = c.id;
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

describe("bulk change", () => {
  it("sets fields on several cards at once and reports the count", async () => {
    const { status, body } = await bulk({ ids: [alice.cardId, second], set: { priority: "highest", issueType: "bug" } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ updated: 2, skipped: 0 });
    const rows = await db.select().from(cards).where(inArray(cards.id, [alice.cardId, second]));
    expect(rows.every((r) => r.priority === "highest" && r.issueType === "bug")).toBe(true);
  });

  it("adds and removes labels", async () => {
    await bulk({ ids: [alice.cardId, second], addLabels: [alice.labelId] });
    expect(await db.select().from(cardLabels).where(eq(cardLabels.labelId, alice.labelId))).toHaveLength(2);
    await bulk({ ids: [second], removeLabels: [alice.labelId] });
    expect(await db.select().from(cardLabels).where(eq(cardLabels.labelId, alice.labelId))).toHaveLength(1);
  });

  it("moving to a list applies the workflow rules", async () => {
    const [done] = await db.insert(lists).values({ boardId: alice.boardId, title: "Done", position: 9000, statusCategory: "done" }).returning();
    await bulk({ ids: [alice.cardId, second], set: { listId: done.id } });
    const rows = await db.select().from(cards).where(inArray(cards.id, [alice.cardId, second]));
    expect(rows.every((r) => r.isComplete && r.resolution === "done" && r.listId === done.id)).toBe(true);
  });

  it("records history for each card", async () => {
    await bulk({ ids: [alice.cardId, second], set: { priority: "low" } });
    const rows = await db.select().from(activities).where(eq(activities.type, "card_updated"));
    expect(rows.map((r) => r.cardId).sort()).toEqual([alice.cardId, second].sort());
  });
});

describe("what it refuses", () => {
  it("skips cards on boards the caller cannot see, and says so", async () => {
    const { body } = await bulk({ ids: [alice.cardId, bob.cardId], set: { priority: "low" } });
    expect(body).toMatchObject({ updated: 1, skipped: 1 });
    const [bobCard] = await db.select().from(cards).where(eq(cards.id, bob.cardId));
    expect(bobCard.priority).toBe("medium");
  });

  it("skips cards the caller may only observe", async () => {
    const [olly] = await db.insert(users).values({ authSub: "sub-olly", email: "olly@example.com", name: "olly" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: olly.id, role: "member" });
    await db.insert(boardMembers).values({ boardId: alice.boardId, userId: olly.id, role: "observer" });
    actAs({ sub: "sub-olly", email: "olly@example.com" });
    const { body } = await bulk({ ids: [alice.cardId, second], set: { priority: "low" } });
    expect(body).toMatchObject({ updated: 0, skipped: 2 });
  });

  it("refuses a list or sprint from another board for the cards it does not fit", async () => {
    const { body } = await bulk({ ids: [alice.cardId], set: { listId: bob.listId } });
    expect(body).toMatchObject({ updated: 0, skipped: 1 });
    const [card] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(card.listId).toBe(alice.listId);
  });

  it("validates the change itself before touching anything", async () => {
    expect((await bulk({ ids: [alice.cardId], set: { priority: "screaming" } })).status).toBe(400);
    expect((await bulk({ ids: [], set: { priority: "low" } })).status).toBe(400);
    expect((await bulk({ ids: [alice.cardId] })).status).toBe(400);
    expect((await bulk({ ids: Array.from({ length: 300 }, () => alice.cardId), set: { priority: "low" } })).status).toBe(400);
  });

  it("an assignee must be able to see each card's board", async () => {
    const { body } = await bulk({ ids: [alice.cardId], set: { assigneeId: bob.userId } });
    expect(body).toMatchObject({ updated: 0, skipped: 1 });
  });
});
