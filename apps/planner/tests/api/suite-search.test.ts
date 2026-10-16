import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, boards, cards, comments } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * POST /api/search: the suite's Search app asks on a person's behalf, with the gateway's identity
 * headers, and must get back only plans, tasks and comments on boards that person can see.
 */
const gateway: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => new Headers(gateway) }));

function actAs(t: Tenant | null, opts: { emailOnly?: boolean; secret?: string } = {}) {
  for (const k of Object.keys(gateway)) delete gateway[k];
  if (!t) return;
  gateway["x-auth-request-email"] = t.email;
  if (!opts.emailOnly) gateway["x-auth-request-user"] = t.sub;
  if (opts.secret) gateway["x-proxy-auth-secret"] = opts.secret;
}

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/search/route");
  const res = await POST(
    new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
  return { status: res.status, body: await res.json() };
};
const ids = (r: { body: { results: { id: string }[] } }) => r.body.results.map((x) => x.id).sort();

let alice: Tenant;
let bob: Tenant;
let carol: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  carol = await seedTenant("carol");
  await db.update(boards).set({ title: "Heron roadmap", description: "Where the heron project goes" }).where(eq(boards.id, alice.boardId));
  await db.update(cards).set({ title: "Paint the heron", description: "Blue-grey heron mural", issueKey: "SYN-1" }).where(eq(cards.id, alice.cardId));
  await db.update(comments).set({ body: "Heron paint arrives Friday" }).where(eq(comments.id, alice.commentId));
  await db.update(cards).set({ title: "Heron salaries", description: "Bob only" }).where(eq(cards.id, bob.cardId));
  await db.update(comments).set({ body: "Bob's private heron note" }).where(eq(comments.id, bob.commentId));
  // Carol's board is shared with Alice, as an observer.
  await db.update(cards).set({ title: "Heron feeding rota" }).where(eq(cards.id, carol.cardId));
  await db.insert(boardMembers).values({ boardId: carol.boardId, userId: alice.userId, role: "observer" });
});

afterEach(() => {
  delete process.env.PROXY_SHARED_SECRET;
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/search", () => {
  it("401 without an identity, or without the gateway's secret when one is set", async () => {
    actAs(null);
    expect((await post({ query: "heron" })).status).toBe(401);
    process.env.PROXY_SHARED_SECRET = "s3cret";
    actAs(alice);
    expect((await post({ query: "heron" })).status).toBe(401);
    actAs(alice, { secret: "s3cret" });
    expect((await post({ query: "heron" })).status).toBe(200);
  });

  it("400 on an empty query", async () => {
    actAs(alice);
    const r = await post({ query: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  it("finds the person's own plans, tasks and comments, with deep links", async () => {
    actAs(alice);
    const r = await post({ query: "heron", kinds: ["plan", "task", "comment"] });
    expect(r.status).toBe(200);
    expect(r.body.app).toBe("planner");
    const task = r.body.results.find((x: { id: string }) => x.id === `task:${alice.cardId}`);
    expect(task.url).toBe(`/b/${alice.boardId}?card=${alice.cardId}`);
    expect(task.title).toBe("SYN-1 Paint the heron · Heron roadmap");
    const plan = r.body.results.find((x: { id: string }) => x.id === `plan:${alice.boardId}`);
    expect(plan.url).toBe(`/b/${alice.boardId}`);
    const comment = r.body.results.find((x: { id: string }) => x.id === `comment:${alice.commentId}`);
    expect(comment.snippet).toBe("Heron paint arrives Friday");
    expect(comment.url).toBe(`/b/${alice.boardId}?card=${alice.cardId}`);
    // newest first
    const dates = r.body.results.map((x: { date: string }) => x.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("never returns another person's board, tasks or comments", async () => {
    actAs(alice);
    const found = ids(await post({ query: "heron" }));
    expect(found).not.toContain(`task:${bob.cardId}`);
    expect(found).not.toContain(`comment:${bob.commentId}`);
    expect(found).not.toContain(`plan:${bob.boardId}`);
    actAs(bob);
    expect(ids(await post({ query: "mural OR friday OR rota" }))).toEqual([]);
  });

  it("returns boards shared with the person", async () => {
    actAs(alice);
    expect(ids(await post({ query: "feeding rota", kinds: ["task"] }))).toEqual([`task:${carol.cardId}`]);
  });

  it("works with the email alone, and leaves out archived cards", async () => {
    actAs(alice, { emailOnly: true });
    expect(ids(await post({ query: "mural" }))).toEqual([`task:${alice.cardId}`]);
    await db.update(cards).set({ isArchived: true }).where(eq(cards.id, alice.cardId));
    expect(ids(await post({ query: "mural OR friday" }))).toEqual([]);
  });

  it("honours -words, limit and text", async () => {
    actAs(alice);
    expect(ids(await post({ query: "heron -paint -roadmap", kinds: ["task"] }))).toEqual([`task:${carol.cardId}`]);
    expect((await post({ query: "heron", limit: 2 })).body.results).toHaveLength(2);
    const t = await post({ query: "mural", text: true });
    expect(t.body.results[0].text).toBe("Paint the heron Blue-grey heron mural");
  });
});
