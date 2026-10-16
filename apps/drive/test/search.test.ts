import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";

// Suite search through the app's normal sign-in: the gateway headers, checked by identify().
// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_search"), so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;
const dir = mkdtempSync(path.join(tmpdir(), "drive-search-"));
process.env.DRIVE_DIR = dir;
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
const bytes = (s: string) => new Response(s).body;

describe.skipIf(!base)("drive suite search", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const drive = await import("../lib/drive");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const route = await import("../app/api/search/route");

  const call = (email: string | null, body: unknown, secret = "gateway-secret") => {
    incoming = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": secret } : {});
    return route.POST(
      new Request("http://drive/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const names = (r: SearchResults) => r.results.map((h) => h.title).sort();

  let budget: Awaited<ReturnType<typeof drive.upload>>;
  let plansId = "";

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE items, libraries, activity CASCADE");
    budget = await drive.upload(alice, {}, "Plans/budget.txt", bytes("The quarterly budget for widgets"));
    await drive.upload(alice, {}, "private-budget.txt", bytes("Salaries"));
    const memo = await drive.upload(alice, {}, "memo.txt", bytes("Budget memo for Bob alone"));
    await drive.upload(carol, {}, "carol.txt", bytes("Carol's budget draft"));
    const gone = await drive.upload(bob, {}, "old-budget.txt", bytes("Thrown away"));
    await drive.moveToTrash(bob, [gone.id]);
    plansId = (await drive.listFolder(alice, {})).items.find((i) => i.name === "Plans")!.id;
    await drive.share(alice, plansId, bob.email, "viewer");
    await drive.share(alice, memo.id, bob.email, "viewer");
    await q("UPDATE items SET modified_at = '2020-01-01T12:00:00Z' WHERE name = 'private-budget.txt'");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("needs the gateway's sign-in", async () => {
    expect((await call(null, { query: "budget" })).status).toBe(401);
    expect((await call(alice.email, { query: "budget" }, "wrong")).status).toBe(401);
  });

  it("refuses an empty query", async () => {
    expect((await call(alice.email, { query: "  " })).status).toBe(400);
    expect((await call(alice.email, {})).status).toBe(400);
  });

  it("finds the person's own files by name and content, newest first", async () => {
    const r = await search(alice.email, { query: "budget" });
    expect(r.app).toBe("drive");
    expect(names(r)).toEqual(["budget.txt", "memo.txt", "private-budget.txt"]);
    expect(r.results.at(-1)!.title).toBe("private-budget.txt");
    const hit = r.results.find((h) => h.id === budget.id)!;
    expect(hit).toMatchObject({ kind: "file", person: alice.email, url: `/?parent=${plansId}&preview=${budget.id}` });
    expect(hit.snippet).toContain("quarterly budget");
    expect(hit.text).toBeUndefined();
    expect(names(await search(alice.email, { query: "widgets" }))).toEqual(["budget.txt"]);
    expect(names(await search(alice.email, { query: "plans" }))).toEqual(["Plans"]);
    expect((await search(alice.email, { query: "plans" })).results[0]).toMatchObject({ kind: "folder", url: `/?parent=${plansId}` });
  });

  it("honours limit, kinds and text", async () => {
    expect((await search(alice.email, { query: "budget", limit: 1 })).results).toHaveLength(1);
    expect(names(await search(alice.email, { query: "plans OR budget", kinds: ["folder"] }))).toEqual(["Plans"]);
    expect(names(await search(alice.email, { query: "budget", kinds: ["message"] }))).toEqual([]);
    const withText = await search(alice.email, { query: "widgets", text: true });
    expect(withText.results[0].text).toBe("The quarterly budget for widgets");
  });

  it("returns what is shared, directly or through a folder, and nothing private", async () => {
    const forBob = await search(bob.email, { query: "budget" });
    // Not Alice's private file, not Carol's, not Bob's own recycle bin.
    expect(names(forBob)).toEqual(["budget.txt", "memo.txt"]);
    const memo = forBob.results.find((h) => h.title === "memo.txt")!;
    expect(memo.url).toBe(`/?view=shared&preview=${memo.id}`);
    expect(forBob.results.find((h) => h.title === "budget.txt")!.url).toBe(`/?parent=${plansId}&preview=${budget.id}`);
    expect(names(await search(carol.email, { query: "budget" }))).toEqual(["carol.txt"]);
  });

  it("leaves out what was deleted under a hold", async () => {
    await q("UPDATE items SET held_deleted_at = now(), trashed_at = now(), trash_root = id WHERE id = $1", [budget.id]);
    expect(names(await search(alice.email, { query: "widgets" }))).toEqual([]);
  });
});
