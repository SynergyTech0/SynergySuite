import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cardLabels, cardMembers, cards, lists, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST JQL search against a real database.
 *
 * The parser has its own unit tests; this covers the translation to SQL and, most importantly, that a
 * query can only ever narrow the caller's visible boards — a search is the easiest place to leak
 * another tenant's issues, because the query names the fields itself.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const actAs = (who: { sub: string; email: string }) => { identity.sub = who.sub; identity.email = who.email; };

async function search(q: string) {
  const { GET } = await import("@/app/api/search/jql/route");
  const res = await GET(new Request(`http://localhost/api/search/jql?q=${encodeURIComponent(q)}`));
  return { status: res.status, body: await res.json() };
}
const titles = (body: { cards?: { title: string }[] }) => (body.cards ?? []).map((c) => c.title).sort();

let alice: Tenant;
let bob: Tenant;
let carol: { id: string };

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  const [u] = await db.insert(users).values({ authSub: "sub-carol", email: "carol@example.com", name: "Carol" }).returning();
  carol = { id: u.id };
  await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: carol.id, role: "member" });

  const [done] = await db.insert(lists).values({ boardId: alice.boardId, title: "Done", position: 9000, statusCategory: "done" }).returning();
  await db.update(cards).set({
    title: "login timeout", issueKey: "ALI-1", issueType: "bug", priority: "highest",
    assigneeId: alice.userId, dueDate: new Date("2026-09-01"), points: 5,
  }).where(eq(cards.id, alice.cardId));
  await db.insert(cardLabels).values({ cardId: alice.cardId, labelId: alice.labelId });
  await db.insert(cards).values([
    { listId: done.id, boardId: alice.boardId, title: "shipped thing", position: 2, issueKey: "ALI-2", issueType: "task", isComplete: true, resolution: "done", assigneeId: carol.id },
    { listId: alice.listId, boardId: alice.boardId, title: "unassigned chore", position: 3, issueKey: "ALI-3", issueType: "task", priority: "low" },
  ]);
  await db.update(cards).set({ title: "bob secret work", issueKey: "BOB-1", issueType: "bug", priority: "highest" }).where(eq(cards.id, bob.cardId));
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

describe("scope", () => {
  it("an empty query returns only the caller's own boards", async () => {
    const { body } = await search("");
    expect(titles(body)).toEqual(["login timeout", "shipped thing", "unassigned chore"]);
  });

  it("a query naming another tenant's board or issue finds nothing", async () => {
    expect(titles((await search("board = 'bob board'")).body)).toEqual([]);
    expect(titles((await search("key = BOB-1")).body)).toEqual([]);
    expect(titles((await search("type = bug")).body)).toEqual(["login timeout"]);   // not bob's bug
  });

  it("a colleague sees the same board, another tenant sees their own", async () => {
    actAs({ sub: "sub-carol", email: "carol@example.com" });
    expect(titles((await search("type = task")).body)).toEqual(["shipped thing", "unassigned chore"]);
    actAs(bob);
    expect(titles((await search("")).body)).toEqual(["bob secret work"]);
  });
});

describe("fields", () => {
  it("text, summary and key", async () => {
    expect(titles((await search("text ~ timeout")).body)).toEqual(["login timeout"]);
    expect(titles((await search("summary ~ 'shipped'")).body)).toEqual(["shipped thing"]);
    expect(titles((await search("key = ali-3")).body)).toEqual(["unassigned chore"]);
  });

  it("assignee me, a name, and EMPTY", async () => {
    expect(titles((await search("assignee = me")).body)).toEqual(["login timeout"]);
    expect(titles((await search("assignee = Carol")).body)).toEqual(["shipped thing"]);
    expect(titles((await search("assignee IS EMPTY")).body)).toEqual(["unassigned chore"]);
  });

  it("status, status category and resolution", async () => {
    expect(titles((await search("status = 'To Do'")).body)).toEqual(["login timeout", "unassigned chore"]);
    expect(titles((await search("statusCategory = done")).body)).toEqual(["shipped thing"]);
    expect(titles((await search("resolution = done")).body)).toEqual(["shipped thing"]);
  });

  it("labels and points and dates", async () => {
    expect(titles((await search("label = 'alice label'")).body)).toEqual(["login timeout"]);
    expect(titles((await search("points >= 3")).body)).toEqual(["login timeout"]);
    expect(titles((await search("due < now")).body)).toEqual(["login timeout"]);
    expect(titles((await search("due IS EMPTY")).body)).toEqual(["shipped thing", "unassigned chore"]);
  });

  it("member matches Trello-style card members", async () => {
    await db.insert(cardMembers).values({ cardId: alice.cardId, userId: carol.id });
    expect(titles((await search("member = Carol")).body)).toEqual(["login timeout"]);
  });

  it("combines with AND, OR, NOT and IN", async () => {
    expect(titles((await search("type = bug AND priority = highest")).body)).toEqual(["login timeout"]);
    expect(titles((await search("type = bug OR type = task")).body)).toEqual(["login timeout", "shipped thing", "unassigned chore"]);
    expect(titles((await search("NOT statusCategory = done")).body)).toEqual(["login timeout", "unassigned chore"]);
    expect(titles((await search("priority IN (highest, low)")).body)).toEqual(["login timeout", "unassigned chore"]);
  });

  it("orders by a field, with priority by severity rather than alphabet", async () => {
    const { body } = await search("ORDER BY priority ASC");
    expect((body.cards as { title: string }[]).map((c) => c.title)).toEqual(["login timeout", "shipped thing", "unassigned chore"]);
    const desc = await search("ORDER BY key DESC");
    expect((desc.body.cards as { issueKey: string }[]).map((c) => c.issueKey)).toEqual(["ALI-3", "ALI-2", "ALI-1"]);
  });
});

describe("errors", () => {
  it("a bad query is a 400 with a message, not a 500", async () => {
    const { status, body } = await search("squid = 3");
    expect(status).toBe(400);
    expect(body.error).toContain("Unknown field");
  });

  it("a value that looks like SQL is treated as a value", async () => {
    const { status, body } = await search("summary ~ \"'; drop table cards; --\"");
    expect(status).toBe(200);
    expect(body.cards).toEqual([]);
    expect(await db.select().from(cards)).not.toHaveLength(0);
  });
});

describe("saved filters", () => {
  const req = (method: string, body?: unknown) =>
    new Request("http://localhost/api", {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("saves, lists, renames and deletes — and validates the query on the way in", async () => {
    const route = await import("@/app/api/filters/route");
    expect((await route.POST(req("POST", { name: "My bugs", query: "type = bug AND assignee = me" }))).status).toBe(201);
    expect((await route.POST(req("POST", { name: "Broken", query: "squid = 3" }))).status).toBe(400);
    expect((await route.POST(req("POST", { name: "My bugs", query: "type = bug" }))).status).toBe(409);

    const mine = await (await route.GET()).json();
    expect(mine.map((f: { name: string }) => f.name)).toEqual(["My bugs"]);

    const byId = await import("@/app/api/filters/[id]/route");
    expect((await byId.PATCH(req("PATCH", { name: "My open bugs" }), ctx(mine[0].id))).status).toBe(200);
    expect((await byId.PATCH(req("PATCH", { query: "not valid =" }), ctx(mine[0].id))).status).toBe(400);
    expect((await byId.DELETE(req("DELETE"), ctx(mine[0].id))).status).toBe(200);
    expect(await (await route.GET()).json()).toEqual([]);
  });

  it("filters are personal: another person cannot see, change or delete them", async () => {
    const route = await import("@/app/api/filters/route");
    const mine = await (await route.POST(req("POST", { name: "Mine", query: "assignee = me" }))).json();

    actAs({ sub: "sub-carol", email: "carol@example.com" });
    expect(await (await route.GET()).json()).toEqual([]);
    const byId = await import("@/app/api/filters/[id]/route");
    expect((await byId.PATCH(req("PATCH", { name: "Hijacked" }), ctx(mine.id))).status).toBe(404);
    expect((await byId.DELETE(req("DELETE"), ctx(mine.id))).status).toBe(404);
  });
});
