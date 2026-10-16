import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";
import { inferCategory } from "@/lib/workflow";

/**
 * FAILING-FIRST workflow: Jira status categories (To Do / In Progress / Done) and resolution.
 *
 * Before this, a card dragged into "Done" was not done: isComplete only changed from the checkbox, so
 * the burndown, the due badges and the Done filter all disagreed with the board. In Jira, entering a
 * Done-category status resolves the issue, and leaving it unresolves it.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let alice: Tenant;
let doing: string;
let done: string;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  identity.sub = alice.sub; identity.email = alice.email;
  const [d1] = await db.insert(lists).values({ boardId: alice.boardId, title: "In Progress", position: 2000, statusCategory: "in_progress" }).returning();
  const [d2] = await db.insert(lists).values({ boardId: alice.boardId, title: "Done", position: 3000, statusCategory: "done" }).returning();
  doing = d1.id; done = d2.id;
});

afterAll(async () => {
  await closeDb();
});

const card = async () => (await db.select().from(cards).where(eq(cards.id, alice.cardId)))[0];
const patch = async (body: unknown) => (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", body), ctx(alice.cardId));

describe("inferring a category from a list title", () => {
  it.each([
    ["To Do", "todo"], ["Backlog", "todo"], ["Proposed", "todo"],
    ["Doing", "in_progress"], ["In Progress", "in_progress"], ["Code Review", "in_progress"], ["QA", "in_progress"],
    ["Done", "done"], ["Shipped", "done"], ["Closed", "done"], ["Complete", "done"],
  ])("%s -> %s", (title, category) => {
    expect(inferCategory(title)).toBe(category);
  });
});

describe("moving between categories", () => {
  it("moving into a Done list resolves the card as done and stamps completedAt", async () => {
    await patch({ listId: done, position: 1 });
    const c = await card();
    expect(c).toMatchObject({ isComplete: true, resolution: "done" });
    expect(c.completedAt).not.toBeNull();
  });

  it("moving out of Done unresolves it", async () => {
    await patch({ listId: done, position: 1 });
    await patch({ listId: doing, position: 1 });
    expect(await card()).toMatchObject({ isComplete: false, resolution: null, completedAt: null });
  });

  it("a move between two non-done lists leaves completion alone", async () => {
    await patch({ isComplete: true });
    await patch({ listId: doing, position: 1 });
    expect((await card()).isComplete).toBe(true);
  });

  it("an explicit resolution on the move is kept", async () => {
    await patch({ listId: done, position: 1, resolution: "wont_do" });
    expect((await card()).resolution).toBe("wont_do");
  });

  it("the cross-board move route applies the same rule", async () => {
    const [b2] = await db.insert(boards).values({ workspaceId: alice.workspaceId, title: "Ops", keyPrefix: "OPS", createdBy: alice.userId }).returning();
    const [l2] = await db.insert(lists).values({ boardId: b2.id, title: "Closed", position: 1, statusCategory: "done" }).returning();
    await (await import("@/app/api/cards/[id]/move/route")).POST(req("POST", { listId: l2.id }), ctx(alice.cardId));
    expect(await card()).toMatchObject({ isComplete: true, resolution: "done" });
  });

  it("the mind moving a card to Done resolves it too", async () => {
    await db.update(cards).set({ mindRef: "obj-9", origin: "mind" }).where(eq(cards.id, alice.cardId));
    const [mindBoard] = await db.select().from(boards).where(eq(boards.id, alice.boardId));
    await db.update(boards).set({ title: "Mind Ops" }).where(eq(boards.id, mindBoard.id));
    const { POST } = await import("@/app/api/mind/route");
    await POST(new Request("http://localhost/api/mind", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Mind-Token": process.env.MIND_TOKEN! },
      body: JSON.stringify({ action: "move", ref: "obj-9", list: "Done" }),
    }));
    expect(await card()).toMatchObject({ isComplete: true, resolution: "done" });
  });
});

describe("resolution", () => {
  it("completing by checkbox sets resolution done; reopening clears it", async () => {
    await patch({ isComplete: true });
    expect((await card()).resolution).toBe("done");
    await patch({ isComplete: false });
    expect((await card()).resolution).toBeNull();
  });

  it("refuses an unknown resolution, and a resolution on an open card", async () => {
    expect((await patch({ isComplete: true, resolution: "vibes" })).status).toBe(400);
    expect((await patch({ resolution: "duplicate" })).status).toBe(400);
  });
});

describe("list categories", () => {
  it("a new list gets a category inferred from its title", async () => {
    const { POST } = await import("@/app/api/lists/route");
    const l = await (await POST(req("POST", { boardId: alice.boardId, title: "Ready for QA" }))).json();
    expect(l.statusCategory).toBe("in_progress");
  });

  it("an admin or member can set it; a bad value is refused; an observer cannot", async () => {
    const { PATCH } = await import("@/app/api/lists/[id]/route");
    expect((await PATCH(req("PATCH", { statusCategory: "done" }), ctx(alice.listId))).status).toBe(200);
    expect((await PATCH(req("PATCH", { statusCategory: "finished" }), ctx(alice.listId))).status).toBe(400);
    const [o] = await db.insert(users).values({ authSub: "sub-o", email: "o@example.com", name: "o" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: o.id, role: "observer" });
    identity.sub = "sub-o"; identity.email = "o@example.com";
    expect((await PATCH(req("PATCH", { statusCategory: "todo" }), ctx(alice.listId))).status).toBe(403);
  });
});
