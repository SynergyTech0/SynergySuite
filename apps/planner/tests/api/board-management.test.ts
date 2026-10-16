import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST board management: issue-key prefixes, settings, close/reopen, delete, stars, WIP.
 *
 * Every board was created with the prefix SYN, so SYN-1 existed on every board — Jira project keys
 * are unique, and a key that names two different issues is worse than no key. Closing and deleting
 * were open to any member, there was no way to star a board, and lists had no WIP limit.
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

async function colleague(slug: string, t: Tenant, role: "member" | "admin" | "observer" = "member") {
  const [u] = await db.insert(users).values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: t.workspaceId, userId: u.id, role });
  return { userId: u.id, sub: u.authSub!, email: u.email! };
}

const createBoard = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/boards/route");
  return POST(req("POST", body));
};

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

describe("issue-key prefixes", () => {
  it("a new board derives its prefix from its title", async () => {
    const b = await (await createBoard({ title: "Product Launch" })).json();
    expect(b.keyPrefix).toBe("PL");
  });

  it("the derived prefix is unique within the workspace", async () => {
    const a = await (await createBoard({ title: "Product Launch" })).json();
    const b = await (await createBoard({ title: "Platform Lab" })).json();
    expect(a.keyPrefix).toBe("PL");
    expect(b.keyPrefix).not.toBe("PL");
    expect(b.keyPrefix).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
  });

  it("a single-word title still gets a usable prefix", async () => {
    const b = await (await createBoard({ title: "marketing" })).json();
    expect(b.keyPrefix).toBe("MAR");
  });

  it("an explicit prefix is honoured, and a taken or malformed one refused", async () => {
    expect((await (await createBoard({ title: "Ops", keyPrefix: "OPS" })).json()).keyPrefix).toBe("OPS");
    expect((await createBoard({ title: "Ops 2", keyPrefix: "OPS" })).status).toBe(409);
    expect((await createBoard({ title: "Bad", keyPrefix: "no spaces!" })).status).toBe(400);
  });

  it("another workspace may use the same prefix", async () => {
    await createBoard({ title: "Ops", keyPrefix: "OPS" });
    actAs(bob);
    expect((await createBoard({ title: "Ops", keyPrefix: "OPS" })).status).toBe(201);
  });

  it("renaming a prefix refuses one already used on another board in the workspace", async () => {
    await createBoard({ title: "Ops", keyPrefix: "OPS" });
    const { PATCH } = await import("@/app/api/boards/[id]/route");
    expect((await PATCH(req("PATCH", { keyPrefix: "OPS" }), ctx(alice.boardId))).status).toBe(409);
    expect((await PATCH(req("PATCH", { keyPrefix: "ALI" }), ctx(alice.boardId))).status).toBe(200);
  });
});

describe("board settings", () => {
  it("sets a description and a background colour, refusing a background that is not a colour", async () => {
    const { PATCH } = await import("@/app/api/boards/[id]/route");
    expect((await PATCH(req("PATCH", { description: "Q4 launch", background: "#0f766e" }), ctx(alice.boardId))).status).toBe(200);
    const [b] = await db.select().from(boards).where(eq(boards.id, alice.boardId));
    expect(b).toMatchObject({ description: "Q4 launch", background: "#0f766e" });
    expect((await PATCH(req("PATCH", { background: "url(javascript:alert(1))" }), ctx(alice.boardId))).status).toBe(400);
  });

  it("closing, reopening and changing the key prefix need admin, not just member", async () => {
    actAs(await colleague("carol", alice, "member"));
    const { PATCH } = await import("@/app/api/boards/[id]/route");
    expect((await PATCH(req("PATCH", { isClosed: true }), ctx(alice.boardId))).status).toBe(403);
    expect((await PATCH(req("PATCH", { keyPrefix: "CAR" }), ctx(alice.boardId))).status).toBe(403);
    // ...while an ordinary member can still rename it, as in Trello.
    expect((await PATCH(req("PATCH", { title: "renamed" }), ctx(alice.boardId))).status).toBe(200);
  });
});

describe("closing and deleting", () => {
  it("closed boards leave the main list and appear under ?closed=1", async () => {
    const { PATCH } = await import("@/app/api/boards/[id]/route");
    await PATCH(req("PATCH", { isClosed: true }), ctx(alice.boardId));
    const { GET } = await import("@/app/api/boards/route");
    const open = await (await GET(new Request("http://localhost/api/boards"))).json();
    const closed = await (await GET(new Request("http://localhost/api/boards?closed=1"))).json();
    expect(open.map((b: { id: string }) => b.id)).not.toContain(alice.boardId);
    expect(closed.map((b: { id: string }) => b.id)).toContain(alice.boardId);
  });

  it("a board must be closed before it can be deleted, and only an admin can delete", async () => {
    const route = await import("@/app/api/boards/[id]/route");
    expect((await route.DELETE(req("DELETE"), ctx(alice.boardId))).status).toBe(409);
    await route.PATCH(req("PATCH", { isClosed: true }), ctx(alice.boardId));

    actAs(await colleague("carol", alice, "member"));
    expect((await route.DELETE(req("DELETE"), ctx(alice.boardId))).status).toBe(403);

    actAs(alice);
    expect((await route.DELETE(req("DELETE"), ctx(alice.boardId))).status).toBe(200);
    expect(await db.select().from(boards).where(eq(boards.id, alice.boardId))).toHaveLength(0);
    expect(await db.select().from(cards).where(eq(cards.boardId, alice.boardId))).toHaveLength(0);
  });

  it("another tenant cannot delete", async () => {
    const route = await import("@/app/api/boards/[id]/route");
    await route.PATCH(req("PATCH", { isClosed: true }), ctx(alice.boardId));
    actAs(bob);
    expect((await route.DELETE(req("DELETE"), ctx(alice.boardId))).status).toBe(404);
  });
});

describe("starring", () => {
  it("stars are per person and show on the boards list", async () => {
    const star = await import("@/app/api/boards/[id]/star/route");
    expect((await star.POST(req("POST"), ctx(alice.boardId))).status).toBe(200);

    const { GET } = await import("@/app/api/boards/route");
    const mine = await (await GET(new Request("http://localhost/api/boards"))).json();
    expect(mine.find((b: { id: string }) => b.id === alice.boardId).starred).toBe(true);

    // a colleague sees the same board unstarred
    actAs(await colleague("carol", alice));
    const theirs = await (await GET(new Request("http://localhost/api/boards"))).json();
    expect(theirs.find((b: { id: string }) => b.id === alice.boardId).starred).toBe(false);

    actAs(alice);
    await star.DELETE(req("DELETE"), ctx(alice.boardId));
    const after = await (await GET(new Request("http://localhost/api/boards"))).json();
    expect(after.find((b: { id: string }) => b.id === alice.boardId).starred).toBe(false);
  });

  it("an observer may star (it changes nothing shared); another tenant gets 404", async () => {
    const star = await import("@/app/api/boards/[id]/star/route");
    actAs(await colleague("olly", alice, "observer"));
    expect((await star.POST(req("POST"), ctx(alice.boardId))).status).toBe(200);
    actAs(bob);
    expect((await star.POST(req("POST"), ctx(alice.boardId))).status).toBe(404);
  });
});

describe("list WIP limits", () => {
  it("sets and clears a WIP limit, which the snapshot carries", async () => {
    const { PATCH } = await import("@/app/api/lists/[id]/route");
    expect((await PATCH(req("PATCH", { wipLimit: 3 }), ctx(alice.listId))).status).toBe(200);
    const snap = await (await (await import("@/app/api/boards/[id]/route")).GET(req("GET"), ctx(alice.boardId))).json();
    expect(snap.lists.find((l: { id: string }) => l.id === alice.listId).wipLimit).toBe(3);

    expect((await PATCH(req("PATCH", { wipLimit: null }), ctx(alice.listId))).status).toBe(200);
    const [l] = await db.select().from(lists).where(eq(lists.id, alice.listId));
    expect(l.wipLimit).toBeNull();
  });

  it("refuses a negative or fractional limit", async () => {
    const { PATCH } = await import("@/app/api/lists/[id]/route");
    expect((await PATCH(req("PATCH", { wipLimit: -1 }), ctx(alice.listId))).status).toBe(400);
    expect((await PATCH(req("PATCH", { wipLimit: 2.5 }), ctx(alice.listId))).status).toBe(400);
  });
});
