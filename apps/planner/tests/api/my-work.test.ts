import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, cards, lists } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST for the dashboard — Jira's "Your work" and Trello's home, across every board the
 * caller can see. Which makes it the single widest read in the app, so the test that matters most is
 * the one proving it cannot see a board the caller was never given.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const get = () => new Request("http://localhost/api/my-work");

let alice: Tenant, bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  identity.sub = alice.sub; identity.email = alice.email;
});
afterAll(async () => { await closeDb(); });

const day = (n: number) => new Date(Date.now() + n * 86400000);

describe("my work", () => {
  it("collects the caller's assigned cards and sorts the soonest due first", async () => {
    await db.update(cards).set({ assigneeId: alice.userId, dueDate: day(5) }).where(eq(cards.id, alice.cardId));
    const [soon] = await db.insert(cards).values({
      boardId: alice.boardId, listId: alice.listId, title: "sooner", position: 2048,
      assigneeId: alice.userId, dueDate: day(1),
    }).returning();
    await db.insert(cards).values({
      boardId: alice.boardId, listId: alice.listId, title: "no date", position: 3072, assigneeId: alice.userId,
    });

    const { GET } = await import("@/app/api/my-work/route");
    const body = await (await GET(get())).json();
    expect(body.assigned.map((c: { id: string }) => c.id).slice(0, 2)).toEqual([soon.id, alice.cardId]);
    expect(body.assigned).toHaveLength(3);                       // the undated one is last, not dropped
    expect(body.assigned.at(-1).title).toBe("no date");
  });

  it("separates overdue from due soon, and never counts a completed card as either", async () => {
    await db.insert(cards).values([
      { boardId: alice.boardId, listId: alice.listId, title: "late", position: 2048, assigneeId: alice.userId, dueDate: day(-2) },
      { boardId: alice.boardId, listId: alice.listId, title: "later", position: 3072, assigneeId: alice.userId, dueDate: day(3) },
      { boardId: alice.boardId, listId: alice.listId, title: "late but done", position: 4096,
        assigneeId: alice.userId, dueDate: day(-3), isComplete: true, completedAt: new Date() },
    ]);
    const { GET } = await import("@/app/api/my-work/route");
    const body = await (await GET(get())).json();
    expect(body.overdue).toBe(1);
    expect(body.dueSoon).toBe(1);                                // within a week, not yet due
    expect(body.assigned.some((c: { title: string }) => c.title === "late but done")).toBe(false);
  });

  it("counts each board's open and done cards, and ignores archived ones", async () => {
    const [done] = await db.insert(lists).values({
      boardId: alice.boardId, title: "Done", position: 2048, statusCategory: "done",
    }).returning();
    await db.insert(cards).values([
      { boardId: alice.boardId, listId: done.id, title: "shipped", position: 1024, isComplete: true, completedAt: new Date() },
      { boardId: alice.boardId, listId: alice.listId, title: "gone", position: 5120, isArchived: true },
    ]);
    const { GET } = await import("@/app/api/my-work/route");
    const body = await (await GET(get())).json();
    const board = body.boards.find((b: { id: string }) => b.id === alice.boardId);
    expect(board).toMatchObject({ open: 1, done: 1 });           // the seeded card plus the shipped one
  });

  it("shows nothing from a board the caller cannot see, and everything from one they can", async () => {
    await db.update(cards).set({ assigneeId: alice.userId }).where(eq(cards.id, bob.cardId));
    const { GET } = await import("@/app/api/my-work/route");

    let body = await (await GET(get())).json();
    expect(body.assigned.some((c: { id: string }) => c.id === bob.cardId)).toBe(false);
    expect(body.boards.some((b: { id: string }) => b.id === bob.boardId)).toBe(false);

    // Once Bob adds her to the board, the same card she is already assigned to appears.
    await db.insert(boardMembers).values({ boardId: bob.boardId, userId: alice.userId, role: "member" });
    body = await (await GET(get())).json();
    expect(body.assigned.some((c: { id: string }) => c.id === bob.cardId)).toBe(true);
  });

  it("a caller with no boards sees an empty dashboard, not everyone else's work", async () => {
    // Outside production an unidentified request becomes the local dev user (lib/session) — who is a
    // member of nothing. The property worth pinning is that such a caller sees nothing at all.
    identity.sub = ""; identity.email = "";
    const { GET } = await import("@/app/api/my-work/route");
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assigned: [], overdue: 0, dueSoon: 0, boards: [] });
  });
});
