import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";

// Suite search through the app's normal sign-in: the gateway headers, checked by identify().
// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_search"), so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;
process.env.PROXY_SHARED_SECRET = "gateway-secret";

let incoming = new Headers();
vi.mock("next/headers", () => ({ headers: async () => incoming }));

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_search`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };

describe.skipIf(!base)("engage suite search", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const e = await import("../lib/engage");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const route = await import("../app/api/search/route");

  const call = (email: string | null, body: unknown, secret = "gateway-secret") => {
    incoming = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": secret } : {});
    return route.POST(
      new Request("http://engage/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const names = (r: SearchResults) => r.results.map((h) => `${h.kind}:${h.title}`).sort();

  let plan: { id: string };

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE people, communities, posts, follows, reactions, quick_links CASCADE");
    e.resetSeen();
    const secret = await e.createCommunity(alice, { name: "Launch crew", privacy: "private" });
    await e.addMember(alice, secret.id, bob.email);
    plan = await e.createPost(alice, { communityId: secret.id, title: "Launch plan", body: "Booking the venue" });
    await e.addComment(bob, plan.id, { body: "Caterer confirmed" });
    await e.createPost(carol, { body: "My #launch party photos" });
    const gone = await e.createPost(alice, { body: "Old launch idea" });
    await q("UPDATE posts SET held_deleted_at = now() WHERE id = $1", [gone.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("needs the gateway's sign-in and a query", async () => {
    expect((await call(null, { query: "launch" })).status).toBe(401);
    expect((await call(alice.email, { query: "launch" }, "wrong")).status).toBe(401);
    expect((await call(alice.email, { query: " " })).status).toBe(400);
  });

  it("finds posts and communities the person can see", async () => {
    const r = await search(alice.email, { query: "launch" });
    expect(r.app).toBe("engage");
    expect(names(r)).toEqual(["community:Launch crew", "post:Launch plan", "post:My #launch party photos"]);
    const post = r.results.find((h) => h.id === plan.id)!;
    expect(post).toMatchObject({ kind: "post", url: `/posts/${plan.id}`, person: alice.email });
    expect(names(await search(alice.email, { query: "caterer" }))).toEqual(["post:Launch plan"]);
    // Carol isn't in the private community.
    expect(names(await search(carol.email, { query: "launch" }))).toEqual(["post:My #launch party photos"]);
    expect(names(await search(alice.email, { query: "launch", kinds: ["community"] }))).toEqual(["community:Launch crew"]);
    expect((await search(alice.email, { query: "venue", text: true })).results[0].text).toContain("Caterer confirmed");
    expect((await search(alice.email, { query: "launch", limit: 1 })).results).toHaveLength(1);
  });
});
