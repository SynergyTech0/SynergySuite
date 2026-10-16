import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, boardMembers, boards, cards, issueLinks, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST Jira issue links: "blocks / is blocked by", "relates to", "duplicates", "clones".
 *
 * A link joins two cards that may sit on different boards, which makes it a new way to reach across
 * a boundary. The rules tested here:
 *  - creating a link needs write access on the source and visibility of the target;
 *  - a card's link list never reveals a linked card the reader cannot see;
 *  - the blocked state a card face shows counts only blockers that are still open.
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

let alice: Tenant;
let bob: Tenant;
let second: string; // another card on alice's board

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  const [c] = await db.insert(cards).values({
    listId: alice.listId, boardId: alice.boardId, title: "deploy pipeline", position: 5000, issueKey: "ALI-2",
  }).returning();
  second = c.id;
  await db.update(cards).set({ issueKey: "ALI-1" }).where(eq(cards.id, alice.cardId));
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

const link = async (from: string, body: Record<string, unknown>) =>
  (await import("@/app/api/cards/[id]/links/route")).POST(req("POST", body), ctx(from));
const detail = async (id: string) =>
  (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(id))).json();

describe("creating links", () => {
  it("'blocks' shows as outward on the source and 'is blocked by' on the target", async () => {
    const res = await link(alice.cardId, { targetId: second, type: "blocks" });
    expect(res.status).toBe(201);

    const src = await detail(alice.cardId);
    expect(src.links).toMatchObject([{ label: "blocks", card: { id: second, issueKey: "ALI-2" } }]);
    const tgt = await detail(second);
    expect(tgt.links).toMatchObject([{ label: "is blocked by", card: { id: alice.cardId, issueKey: "ALI-1" } }]);
  });

  it("'relates to' reads the same from both ends", async () => {
    await link(alice.cardId, { targetId: second, type: "relates" });
    expect((await detail(alice.cardId)).links[0].label).toBe("relates to");
    expect((await detail(second)).links[0].label).toBe("relates to");
  });

  it("a link can be made by issue key", async () => {
    expect((await link(alice.cardId, { targetKey: "ali-2", type: "duplicates" })).status).toBe(201);
    expect((await detail(second)).links[0].label).toBe("is duplicated by");
  });

  it("refuses a self-link, an unknown type, and an exact duplicate", async () => {
    expect((await link(alice.cardId, { targetId: alice.cardId, type: "blocks" })).status).toBe(400);
    expect((await link(alice.cardId, { targetId: second, type: "haunts" })).status).toBe(400);
    expect((await link(alice.cardId, { targetId: second, type: "blocks" })).status).toBe(201);
    expect((await link(alice.cardId, { targetId: second, type: "blocks" })).status).toBe(409);
  });

  it("records history on both cards", async () => {
    await link(alice.cardId, { targetId: second, type: "blocks" });
    const rows = await db.select().from(activities).where(eq(activities.type, "link_added"));
    expect(rows.map((r) => r.cardId).sort()).toEqual([alice.cardId, second].sort());
  });
});

describe("boundaries", () => {
  it("cannot link to a card on another tenant's board, by id or by key", async () => {
    await db.update(cards).set({ issueKey: "BOB-1" }).where(eq(cards.id, bob.cardId));
    expect((await link(alice.cardId, { targetId: bob.cardId, type: "relates" })).status).toBe(404);
    expect((await link(alice.cardId, { targetKey: "BOB-1", type: "relates" })).status).toBe(404);
    expect(await db.select().from(issueLinks)).toHaveLength(0);
  });

  it("an observer cannot create or delete links", async () => {
    const created = await (await link(alice.cardId, { targetId: second, type: "relates" })).json();
    const [olly] = await db.insert(users).values({ authSub: "sub-olly", email: "olly@example.com", name: "olly" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: olly.id, role: "observer" });
    actAs({ sub: "sub-olly", email: "olly@example.com" });
    expect((await link(alice.cardId, { targetId: second, type: "blocks" })).status).toBe(403);
    const { DELETE } = await import("@/app/api/issue-links/[id]/route");
    expect((await DELETE(req("DELETE"), ctx(created.id))).status).toBe(403);
  });

  it("a reader who can see only one end does not learn the other card exists", async () => {
    // A second board in alice's workspace that carol is NOT a member of... carol is only on board 1.
    const [b2] = await db.insert(boards).values({ workspaceId: alice.workspaceId, title: "private", createdBy: alice.userId }).returning();
    const [l2] = await db.insert(lists).values({ boardId: b2.id, title: "x", position: 1 }).returning();
    const [secret] = await db.insert(cards).values({ listId: l2.id, boardId: b2.id, title: "secret acquisition", position: 1 }).returning();
    await link(alice.cardId, { targetId: secret.id, type: "blocks" });

    const [carol] = await db.insert(users).values({ authSub: "sub-carol", email: "carol@example.com", name: "carol" }).returning();
    await db.insert(boardMembers).values({ boardId: alice.boardId, userId: carol.id, role: "member" });
    actAs({ sub: "sub-carol", email: "carol@example.com" });

    const seen = await detail(alice.cardId);
    expect(JSON.stringify(seen.links)).not.toContain("secret acquisition");
    expect(seen.links).toEqual([]);
  });
});

describe("deleting and the blocked badge", () => {
  it("deletes a link from either end", async () => {
    const created = await (await link(alice.cardId, { targetId: second, type: "blocks" })).json();
    const { DELETE } = await import("@/app/api/issue-links/[id]/route");
    expect((await DELETE(req("DELETE"), ctx(created.id))).status).toBe(200);
    expect((await detail(second)).links).toEqual([]);
  });

  it("the snapshot marks a card blocked only while an open card blocks it", async () => {
    await link(alice.cardId, { targetId: second, type: "blocks" });
    const snap = async () => (await (await (await import("@/app/api/boards/[id]/route")).GET(req("GET"), ctx(alice.boardId))).json())
      .cards.find((c: { id: string }) => c.id === second).badges.blockedBy;
    expect(await snap()).toBe(1);
    await db.update(cards).set({ isComplete: true }).where(eq(cards.id, alice.cardId));
    expect(await snap()).toBe(0);
  });
});

describe("search finds cards by issue key", () => {
  it("matches a key, case-insensitively", async () => {
    const { GET } = await import("@/app/api/search/route");
    const res = await (await GET(new Request("http://localhost/api/search?q=ali-2"))).json();
    expect(res.cards.map((c: { id: string }) => c.id)).toContain(second);
  });
});

describe("creating a child issue in one step", () => {
  it("accepts a parent on the same board", async () => {
    const { POST } = await import("@/app/api/cards/route");
    const res = await POST(req("POST", { listId: alice.listId, title: "sub step", issueType: "subtask", parentId: alice.cardId }));
    expect(res.status).toBe(201);
    expect((await res.json()).parentId).toBe(alice.cardId);
  });

  it("refuses a parent on another board, which would reach across the board boundary", async () => {
    const { POST } = await import("@/app/api/cards/route");
    const res = await POST(req("POST", { listId: alice.listId, title: "sub step", parentId: bob.cardId }));
    expect(res.status).toBe(404);
  });

  it("refuses an issue type that does not exist", async () => {
    const { POST } = await import("@/app/api/cards/route");
    expect((await POST(req("POST", { listId: alice.listId, title: "x", issueType: "saga" }))).status).toBe(400);
  });
});
