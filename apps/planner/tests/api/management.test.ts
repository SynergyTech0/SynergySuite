import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST tests for T2 — the management verbs that make this usable daily.
 *
 * Today: there is no list rename/archive/delete route at all (no app/api/lists/[id]), boards have
 * no PATCH so a board can never be renamed, `isArchived` exists on cards and lists and is filtered
 * out of every query but nothing can set it or list what was archived, and there is no search.
 * Every one of these is also tenancy-scoped: the same 404 rule as T1 applies.
 */

const identity = { sub: "", email: "" };

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));

function actAs(tenant: Tenant) {
  identity.sub = tenant.sub;
  identity.email = tenant.email;
}

const body = (method: string, payload: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: Tenant;
let bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  actAs(bob);
});

afterAll(async () => {
  await closeDb();
});

describe("list rename, archive and delete", () => {
  it("renames a list on the caller's own board", async () => {
    const { PATCH } = await import("@/app/api/lists/[id]/route");
    const res = await PATCH(body("PATCH", { title: "In Progress" }), ctx(bob.listId));

    expect(res.status).toBe(200);
    const [list] = await db.select().from(lists).where(eq(lists.id, bob.listId));
    expect(list.title).toBe("In Progress");
  });

  it("archives a list instead of destroying its cards", async () => {
    const { PATCH } = await import("@/app/api/lists/[id]/route");
    const res = await PATCH(body("PATCH", { isArchived: true }), ctx(bob.listId));

    expect(res.status).toBe(200);
    const [list] = await db.select().from(lists).where(eq(lists.id, bob.listId));
    expect(list.isArchived).toBe(true);
    // the card that lived on it still exists
    expect(await db.select().from(cards).where(eq(cards.id, bob.cardId))).toHaveLength(1);
  });

  it("deletes a list", async () => {
    const { DELETE } = await import("@/app/api/lists/[id]/route");
    const res = await DELETE(new Request("http://localhost/api", { method: "DELETE" }), ctx(bob.listId));

    expect(res.status).toBe(200);
    expect(await db.select().from(lists).where(eq(lists.id, bob.listId))).toHaveLength(0);
  });

  it("refuses to touch another tenant's list", async () => {
    const { PATCH, DELETE } = await import("@/app/api/lists/[id]/route");

    expect((await PATCH(body("PATCH", { title: "hijacked" }), ctx(alice.listId))).status).toBe(404);
    expect(
      (await DELETE(new Request("http://localhost/api", { method: "DELETE" }), ctx(alice.listId))).status,
    ).toBe(404);

    const [list] = await db.select().from(lists).where(eq(lists.id, alice.listId));
    expect(list.title).toBe("To Do");
  });
});

describe("board rename", () => {
  it("renames the caller's own board", async () => {
    const { PATCH } = await import("@/app/api/boards/[id]/route");
    const res = await PATCH(body("PATCH", { title: "Renamed board" }), ctx(bob.boardId));

    expect(res.status).toBe(200);
    const [board] = await db.select().from(boards).where(eq(boards.id, bob.boardId));
    expect(board.title).toBe("Renamed board");
  });

  it("refuses to rename another tenant's board", async () => {
    const { PATCH } = await import("@/app/api/boards/[id]/route");
    const res = await PATCH(body("PATCH", { title: "hijacked" }), ctx(alice.boardId));

    expect(res.status).toBe(404);
    const [board] = await db.select().from(boards).where(eq(boards.id, alice.boardId));
    expect(board.title).toBe("alice board");
  });
});

describe("card archive and unarchive", () => {
  it("archives a card, hides it from the board snapshot, and can restore it", async () => {
    const cardRoute = await import("@/app/api/cards/[id]/route");
    const boardRoute = await import("@/app/api/boards/[id]/route");

    expect((await cardRoute.PATCH(body("PATCH", { isArchived: true }), ctx(bob.cardId))).status).toBe(200);

    const hidden = await (await boardRoute.GET(new Request("http://localhost/api"), ctx(bob.boardId))).json();
    expect(hidden.cards.map((c: { id: string }) => c.id)).not.toContain(bob.cardId);

    expect((await cardRoute.PATCH(body("PATCH", { isArchived: false }), ctx(bob.cardId))).status).toBe(200);
    const restored = await (await boardRoute.GET(new Request("http://localhost/api"), ctx(bob.boardId))).json();
    expect(restored.cards.map((c: { id: string }) => c.id)).toContain(bob.cardId);
  });

  it("lists the archived cards of a board so they can be found again", async () => {
    const cardRoute = await import("@/app/api/cards/[id]/route");
    await cardRoute.PATCH(body("PATCH", { isArchived: true }), ctx(bob.cardId));

    const { GET } = await import("@/app/api/boards/[id]/archived/route");
    const res = await GET(new Request("http://localhost/api"), ctx(bob.boardId));

    expect(res.status).toBe(200);
    const archived = await res.json();
    expect(archived.cards.map((c: { id: string }) => c.id)).toEqual([bob.cardId]);
  });

  it("refuses the archived view of another tenant's board", async () => {
    const { GET } = await import("@/app/api/boards/[id]/archived/route");
    expect((await GET(new Request("http://localhost/api"), ctx(alice.boardId))).status).toBe(404);
  });
});

describe("board search", () => {
  it("finds the caller's cards by title and description, and never another tenant's", async () => {
    await db.insert(cards).values([
      { listId: bob.listId, boardId: bob.boardId, title: "Deploy the gateway", position: 2048 },
      { listId: bob.listId, boardId: bob.boardId, title: "Unrelated", description: "mentions gateway too", position: 3072 },
      { listId: bob.listId, boardId: bob.boardId, title: "Nothing to see", position: 4096 },
    ]);
    await db.insert(cards).values({
      listId: alice.listId, boardId: alice.boardId, title: "alice gateway secret", position: 2048,
    });

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(new Request("http://localhost/api/search?q=gateway"));

    expect(res.status).toBe(200);
    const hits = await res.json();
    const titles = hits.cards.map((c: { title: string }) => c.title).sort();

    expect(titles).toEqual(["Deploy the gateway", "Unrelated"]);
    expect(JSON.stringify(hits)).not.toContain("alice gateway secret");
  });

  it("can scope a search to one board", async () => {
    const [second] = await db
      .insert(boards)
      .values({ workspaceId: bob.workspaceId, title: "second board", createdBy: bob.userId })
      .returning();
    const [otherList] = await db
      .insert(lists)
      .values({ boardId: second.id, title: "To Do", position: 1024 })
      .returning();
    await db.insert(cards).values([
      { listId: bob.listId, boardId: bob.boardId, title: "widget here", position: 2048 },
      { listId: otherList.id, boardId: second.id, title: "widget there", position: 2048 },
    ]);

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(new Request(`http://localhost/api/search?q=widget&boardId=${second.id}`));

    const hits = await res.json();
    expect(hits.cards.map((c: { title: string }) => c.title)).toEqual(["widget there"]);
  });

  it("requires a query and returns nothing for a blank one", async () => {
    const { GET } = await import("@/app/api/search/route");
    expect((await GET(new Request("http://localhost/api/search?q="))).status).toBe(400);
  });
});

describe("archived lists stay out of the board snapshot", () => {
  it("hides an archived list but keeps it retrievable", async () => {
    const listRoute = await import("@/app/api/lists/[id]/route");
    const boardRoute = await import("@/app/api/boards/[id]/route");

    await listRoute.PATCH(body("PATCH", { isArchived: true }), ctx(bob.listId));

    const snapshot = await (await boardRoute.GET(new Request("http://localhost/api"), ctx(bob.boardId))).json();
    expect(snapshot.lists.map((l: { id: string }) => l.id)).not.toContain(bob.listId);

    const archivedView = await import("@/app/api/boards/[id]/archived/route");
    const archived = await (await archivedView.GET(new Request("http://localhost/api"), ctx(bob.boardId))).json();
    expect(archived.lists.map((l: { id: string }) => l.id)).toEqual([bob.listId]);
  });
});

describe("backlog ordering (T3)", () => {
  it("persists a position when a card is moved into a sprint, so the order survives a refetch", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const [second] = await db
      .insert(cards)
      .values({ listId: bob.listId, boardId: bob.boardId, title: "second", position: 2048 })
      .returning();

    // drop both into the sprint, second one first
    await PATCH(body("PATCH", { sprintId: bob.sprintId, position: 512 }), ctx(second.id));
    await PATCH(body("PATCH", { sprintId: bob.sprintId, position: 256 }), ctx(bob.cardId));

    const inSprint = await db
      .select()
      .from(cards)
      .where(and(eq(cards.boardId, bob.boardId), eq(cards.sprintId, bob.sprintId)));

    expect(inSprint).toHaveLength(2);
    // distinct, explicit positions — not whatever they inherited from the board list
    const positions = inSprint.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toEqual([256, 512]);
  });
});

describe("which workspace a new board is created in", () => {
  const create = async () => {
    const { POST } = await import("@/app/api/boards/route");
    const res = await POST(body("POST", { title: "fresh board" }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; workspaceId: string };
  };

  it("uses the workspace the caller OWNS, not one they were invited into", async () => {
    // Re-create Bob's own membership AFTER his membership of Alice's workspace, so an unordered
    // lookup meets Alice's row first. Before the fix the answer depended on physical row order.
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, bob.userId));
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: bob.userId, role: "member" });
    await db.insert(workspaceMembers).values({ workspaceId: bob.workspaceId, userId: bob.userId, role: "owner" });

    const board = await create();
    expect(board.workspaceId).toBe(bob.workspaceId);
  });

  it("never creates in a workspace where the caller is only an observer", async () => {
    const [carol] = await db.insert(users)
      .values({ authSub: "sub-carol", email: "carol@example.com", name: "Carol" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: carol.id, role: "observer" });
    identity.sub = "sub-carol";
    identity.email = "carol@example.com";

    const board = await create();
    expect(board.workspaceId).not.toBe(alice.workspaceId);
    const { visibleBoardIds } = await import("@/lib/authz");
    expect(await visibleBoardIds(alice.userId)).not.toContain(board.id);
  });

  it("a plain member with no workspace of their own still creates in the shared one", async () => {
    // How the internal team works today (backfill grants workspace member); must not regress.
    const [doug] = await db.insert(users)
      .values({ authSub: "sub-doug", email: "doug@example.com", name: "Doug" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: doug.id, role: "member" });
    identity.sub = "sub-doug";
    identity.email = "doug@example.com";

    const board = await create();
    expect(board.workspaceId).toBe(alice.workspaceId);
  });
});
