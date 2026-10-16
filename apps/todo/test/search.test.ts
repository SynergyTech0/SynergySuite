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

const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";
const today = "2026-10-16";

describe.skipIf(!base)("to do suite search", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const todo = await import("../lib/todo");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const route = await import("../app/api/search/route");

  const call = (email: string | null, body: unknown, secret = "gateway-secret") => {
    incoming = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": secret } : {});
    return route.POST(
      new Request("http://todo/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const names = (r: SearchResults) => r.results.map((h) => h.title).sort();

  let launch: { id: string; listId: string };
  let milk: { id: string; listId: string };

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE lists CASCADE");
    const project = await todo.createList(alice, "Project");
    await todo.share(alice, project.id, bob);
    launch = await todo.createTask(alice, { listId: project.id, title: "Plan the launch", today });
    await todo.updateTask(alice, launch.id, { notes: "Book the venue for the product launch", assignedTo: bob, today });
    await todo.addStep(alice, launch.id, "Email the caterer");
    milk = await todo.createTask(alice, { title: "Buy milk for the launch", today });
    await todo.createTask(carol, { title: "Carol's launch errand", today });
    const gone = await todo.createTask(alice, { title: "Old launch idea", today });
    await q("UPDATE tasks SET held_deleted_at = now() WHERE id = $1", [gone.id]);
    await q("UPDATE tasks SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [milk.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("needs the gateway's sign-in", async () => {
    expect((await call(null, { query: "launch" })).status).toBe(401);
    expect((await call(alice, { query: "launch" }, "wrong")).status).toBe(401);
  });

  it("refuses an empty query", async () => {
    expect((await call(alice, { query: " " })).status).toBe(400);
    expect((await call(alice, { limit: 5 })).status).toBe(400);
  });

  it("finds the person's own tasks, newest first, by title, notes, steps and list", async () => {
    const r = await search(alice, { query: "launch" });
    expect(r.app).toBe("todo");
    // Not Carol's task, not the one deleted under a hold.
    expect(r.results.map((h) => h.title)).toEqual(["Plan the launch", "Buy milk for the launch"]);
    expect(r.results[0]).toMatchObject({ id: launch.id, kind: "task", person: bob, url: `/?list=${launch.listId}&task=${launch.id}` });
    expect(r.results[0].snippet).toContain("venue");
    expect(r.results[1].url).toBe(`/?list=${milk.listId}&task=${milk.id}`);
    expect(names(await search(alice, { query: "caterer" }))).toEqual(["Plan the launch"]);
    expect(names(await search(alice, { query: "project" }))).toEqual(["Plan the launch"]);
    const withText = await search(alice, { query: "venue", text: true });
    expect(withText.results[0].text).toContain("Email the caterer");
  });

  it("returns tasks in lists shared with the person, and nothing private", async () => {
    expect(names(await search(bob, { query: "launch" }))).toEqual(["Plan the launch"]);
    expect(names(await search(carol, { query: "launch" }))).toEqual(["Carol's launch errand"]);
    expect(names(await search(bob, { query: "milk" }))).toEqual([]);
  });

  it("honours limit and kinds", async () => {
    expect((await search(alice, { query: "launch", limit: 1 })).results).toHaveLength(1);
    expect((await search(alice, { query: "launch", kinds: ["file"] })).results).toEqual([]);
    expect((await search(alice, { query: "launch", kinds: ["task"] })).results).toHaveLength(2);
  });
});
