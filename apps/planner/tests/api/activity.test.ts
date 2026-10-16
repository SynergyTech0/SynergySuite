import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, boardMembers, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST history. The activities table existed from day one and nothing ever wrote to it, so
 * a card had no history at all: no "who moved this to Done", no "priority changed from high to low".
 * That is the Trello activity feed and the Jira issue History tab.
 *
 * Properties that matter beyond "a row appears":
 *  - a change records field, old value and new value, and who did it;
 *  - a pure reorder within a list is not history (Trello and Jira both leave it out);
 *  - deleting a card leaves a record that it was deleted — the card-scoped rows cascade away with
 *    it, so the deletion has to be written at board level;
 *  - a refused write records nothing.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const actAs = (who: { sub: string; email: string }) => { identity.sub = who.sub; identity.email = who.email; };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const cardHistory = (cardId: string) =>
  db.select().from(activities).where(eq(activities.cardId, cardId)).orderBy(desc(activities.createdAt));

let alice: Tenant;
let bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

describe("what gets recorded", () => {
  it("creating a card records who created it", async () => {
    const { POST } = await import("@/app/api/cards/route");
    const card = await (await POST(req("POST", { listId: alice.listId, title: "new work" }))).json();

    const [row] = await cardHistory(card.id);
    expect(row.type).toBe("card_created");
    expect(row.userId).toBe(alice.userId);
    expect(row.boardId).toBe(alice.boardId);
  });

  it("moving a card to another list records both list names", async () => {
    const [done] = await db.insert(lists).values({ boardId: alice.boardId, title: "Done", position: 9000 }).returning();
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { listId: done.id, position: 1 }), ctx(alice.cardId));

    const [row] = await cardHistory(alice.cardId);
    expect(row.type).toBe("card_moved");
    expect(row.data).toMatchObject({ from: "To Do", to: "Done" });
  });

  it("a field edit records the field, the old value and the new value", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { priority: "highest" }), ctx(alice.cardId));

    const [row] = await cardHistory(alice.cardId);
    expect(row.type).toBe("card_updated");
    expect(row.data).toMatchObject({ field: "priority", from: "medium", to: "highest" });
  });

  it("an edit that changes several fields records each one", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { title: "renamed", points: 5 }), ctx(alice.cardId));

    const fields = (await cardHistory(alice.cardId)).map((r) => (r.data as { field?: string }).field).sort();
    expect(fields).toEqual(["points", "title"]);
  });

  it("a PATCH that repeats the current value records nothing", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { title: "alice card", priority: "medium" }), ctx(alice.cardId));
    expect(await cardHistory(alice.cardId)).toHaveLength(0);
  });

  it("reordering within the same list is not history", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { listId: alice.listId, position: 42 }), ctx(alice.cardId));
    expect(await cardHistory(alice.cardId)).toHaveLength(0);
  });

  it("commenting, labelling and assigning are recorded", async () => {
    await (await import("@/app/api/comments/route")).POST(req("POST", { cardId: alice.cardId, body: "looks good" }));
    await (await import("@/app/api/cards/[id]/labels/route")).POST(req("POST", { labelId: alice.labelId }), ctx(alice.cardId));
    await (await import("@/app/api/cards/[id]/members/route")).POST(req("POST", { userId: alice.userId }), ctx(alice.cardId));

    const types = (await cardHistory(alice.cardId)).map((r) => r.type).sort();
    expect(types).toEqual(["comment_added", "label_added", "member_added"]);
  });

  it("deleting a card leaves a board-level record naming it", async () => {
    const { DELETE } = await import("@/app/api/cards/[id]/route");
    await DELETE(req("DELETE"), ctx(alice.cardId));

    const rows = await db.select().from(activities)
      .where(and(eq(activities.boardId, alice.boardId), eq(activities.type, "card_deleted")));
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ title: "alice card" });
  });

  it("a refused write records nothing", async () => {
    const [carol] = await db.insert(users).values({ authSub: "sub-carol", email: "carol@example.com", name: "carol" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: carol.id, role: "observer" });
    actAs({ sub: "sub-carol", email: "carol@example.com" });

    const { PATCH } = await import("@/app/api/cards/[id]/route");
    expect((await PATCH(req("PATCH", { title: "hijack" }), ctx(alice.cardId))).status).toBe(403);
    expect(await cardHistory(alice.cardId)).toHaveLength(0);
  });

  it("the mind filing a card is recorded against the mind", async () => {
    const { POST } = await import("@/app/api/mind/route");
    const r = new Request("http://localhost/api/mind", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Mind-Token": process.env.MIND_TOKEN! },
      body: JSON.stringify({ action: "file", ref: "obj-1", title: "mind proposal" }),
    });
    const card = await (await POST(r)).json();
    const [row] = await cardHistory(card.id);
    const [mind] = await db.select().from(users).where(eq(users.isMind, true));
    expect(row.type).toBe("card_created");
    expect(row.userId).toBe(mind.id);
  });
});

describe("reading history", () => {
  it("card detail includes its history, newest first, with the actor's name", async () => {
    const { PATCH, GET } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { priority: "high" }), ctx(alice.cardId));
    await PATCH(req("PATCH", { priority: "low" }), ctx(alice.cardId));

    const detail = await (await GET(req("GET"), ctx(alice.cardId))).json();
    expect(detail.activity.map((a: { data: { to: string } }) => a.data.to)).toEqual(["low", "high"]);
    expect(detail.activity[0].actor).toBe("User alice");
  });

  it("the board feed answers 404 for another tenant", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { priority: "high" }), ctx(alice.cardId));

    actAs(bob);
    const { GET } = await import("@/app/api/boards/[id]/activity/route");
    expect((await GET(req("GET"), ctx(alice.boardId))).status).toBe(404);
  });

  it("an observer can read the board feed", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { priority: "high" }), ctx(alice.cardId));

    const [dave] = await db.insert(users).values({ authSub: "sub-dave", email: "dave@example.com", name: "dave" }).returning();
    await db.insert(boardMembers).values({ boardId: alice.boardId, userId: dave.id, role: "observer" });
    actAs({ sub: "sub-dave", email: "dave@example.com" });

    const { GET } = await import("@/app/api/boards/[id]/activity/route");
    const res = await GET(req("GET"), ctx(alice.boardId));
    expect(res.status).toBe(200);
    const feed = await res.json();
    expect(feed[0]).toMatchObject({ type: "card_updated", cardTitle: "alice card" });
  });
});
