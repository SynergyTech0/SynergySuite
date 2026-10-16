import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_compliance`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!base)("engage compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const e = await import("../lib/engage");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://engage/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const search = async (body: Record<string, unknown>) => {
    const res = await call(searchRoute, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResponse;
  };
  const names = (r: SearchResponse) => r.hits.map((h) => `${h.kind}:${h.title}`).sort();

  let launch: { id: string };
  let reply: { id: string };
  let lunch: { id: string };
  let club: { id: string };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE people, communities, posts, follows, reactions, quick_links CASCADE");
    e.resetSeen();
    club = await e.createCommunity(alice, { name: "Product", privacy: "private" });
    await e.addMember(alice, club.id, bob.email);
    launch = await e.createPost(alice, { communityId: club.id, kind: "article", title: "Launch plan", body: "Venue booked, thanks @carol@example.com" });
    reply = await e.addComment(bob, launch.id, { body: "I'll email the caterer" });
    lunch = await e.createPost(alice, { kind: "poll", body: "Team lunch?", options: ["Pizza", "Tacos"] });
    await e.createPost(carol, { body: "Carol's storyline" });
    await q("UPDATE posts SET created_at = '2020-01-01T12:00:00Z' WHERE id = $1", [lunch.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { to: 5 })).status).toBe(400);
  });

  it("searches posts and replies by keywords, custodians, dates and kinds", async () => {
    expect(names(await search({}))).toEqual(["comment:Reply: I'll email the caterer", "post:Carol's storyline", "post:Launch plan", "post:Team lunch?"]);
    expect(names(await search({ query: "caterer" }))).toEqual(["comment:Reply: I'll email the caterer"]);
    expect(names(await search({ query: "product -caterer" }))).toEqual(["post:Launch plan"]);
    // Bob replied, so he is on the post; Carol is named in it.
    expect(names(await search({ custodians: [bob.email] }))).toEqual(["comment:Reply: I'll email the caterer", "post:Launch plan"]);
    expect(names(await search({ custodians: [carol.email], kinds: ["post"] }))).toEqual(["post:Carol's storyline", "post:Launch plan"]);
    expect(names(await search({ custodians: [alice.email], to: "2020-12-31" }))).toEqual(["post:Team lunch?"]);
    expect(names(await search({ kinds: ["task"] }))).toEqual([]);
    const first = await search({ limit: 3 });
    expect(first.total).toBe(4);
    expect((await search({ limit: 3, cursor: first.nextCursor })).hits).toHaveLength(1);
  });

  it("exports a post with its replies and a reply with its post", async () => {
    const { items } = await (await call(exportRoute, { ids: [reply.id, launch.id, lunch.id] })).json();
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(["comment", "post", "post"]);
    expect(items[0]).toMatchObject({ app: "engage", owner: bob.email, metadata: { postId: launch.id, postTitle: "Launch plan", community: "Product" } });
    expect(items[1].metadata).toMatchObject({ kind: "article", community: "Product", replies: [{ author: bob.email, body: "I'll email the caterer" }] });
    expect(items[1].text).toContain("bob@example.com: I'll email the caterer");
    expect(items[2].metadata.poll).toEqual([{ label: "Pizza", votes: 0 }, { label: "Tacos", votes: 0 }]);
  });

  it("keeps what is deleted under a hold, hidden but found", async () => {
    held.add(bob.email);
    await e.deleteComment(bob, reply.id);
    expect((await e.getPost(alice.email, launch.id)).comments).toEqual([]);
    expect((await search({ query: "caterer" })).hits).toEqual([expect.objectContaining({ id: reply.id, deleted: true })]);
    // Bob wrote in the post, so deleting it keeps it too.
    await e.deletePost(alice, launch.id);
    await expect(e.getPost(alice.email, launch.id)).rejects.toThrow(/not found/);
    expect((await search({ query: "launch" })).hits).toEqual([expect.objectContaining({ id: launch.id, deleted: true })]);
    // And the whole community.
    await e.deleteCommunity(alice, club.id);
    await expect(e.getCommunity(alice.email, club.id)).rejects.toThrow(/not found/);
    expect(await q("SELECT 1 FROM communities WHERE id = $1", [club.id])).toHaveLength(1);
    held.clear();

    // Nobody held: gone for good.
    await e.deletePost(alice, lunch.id);
    expect(names(await search({ query: "lunch" }))).toEqual([]);
  });
});
