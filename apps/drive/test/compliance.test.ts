import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import { type ProtectionClient, type SearchResponse, createPolicyClient } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside drive.test.ts.
const base = process.env.TEST_DATABASE_URL;
const dir = mkdtempSync(path.join(tmpdir(), "drive-compliance-"));
process.env.DRIVE_DIR = dir;
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
const bytes = (s: string) => new Response(s).body;

const held = new Set<string>();
let days: number | null = null;
const fakePolicy: ProtectionClient = {
  ...createPolicyClient({ app: "drive", url: "" }),
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => days,
  invalidate() {},
};

describe.skipIf(!base)("drive compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const drive = await import("../lib/drive");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://drive/api/compliance", {
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
  const names = (r: SearchResponse) => r.hits.map((h) => h.title).sort();

  let budget: Awaited<ReturnType<typeof drive.upload>>;
  let notes: Awaited<ReturnType<typeof drive.upload>>;

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE items, libraries, activity CASCADE");
    budget = await drive.upload(alice, {}, "Plans/budget.txt", bytes("The quarterly budget for widgets"));
    notes = await drive.upload(alice, {}, "notes.txt", bytes("Lunch menu"));
    await drive.upload(carol, {}, "carol.txt", bytes("A budget draft"));
    const plans = (await drive.listFolder(alice, {})).items.find((i) => i.name === "Plans")!;
    await drive.share(alice, plans.id, bob.email, "viewer");
    await q("UPDATE items SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [notes.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(searchRoute, {}, "wrong")).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, null)).status).toBe(401);
    expect((await call(searchRoute, { kinds: "file" })).status).toBe(400);
    expect((await call(searchRoute, { from: "soon" })).status).toBe(400);
    expect((await call(exportRoute, { ids: "x" })).status).toBe(400);
  });

  it("searches by keywords, custodians, dates and kinds", async () => {
    const all = await search({});
    expect(all.app).toBe("drive");
    expect(names(all)).toEqual(["budget.txt", "carol.txt", "notes.txt"]);
    expect(names(await search({ query: "budget" }))).toEqual(["budget.txt", "carol.txt"]);
    expect(names(await search({ query: "budget -widgets" }))).toEqual(["carol.txt"]);
    expect(names(await search({ query: '"quarterly budget" OR lunch' }))).toEqual(["budget.txt", "notes.txt"]);
    expect(names(await search({ custodians: ["alice@example.com"] }))).toEqual(["budget.txt", "notes.txt"]);
    // Bob was given the folder it sits in.
    const forBob = await search({ custodians: ["bob@example.com"] });
    expect(names(forBob)).toEqual(["budget.txt"]);
    expect(forBob.hits[0]).toMatchObject({ owner: alice.email, participants: [bob.email], kind: "file" });
    expect(forBob.hits[0].snippet).toContain("quarterly budget");
    expect(names(await search({ from: "2021-01-01" }))).toEqual(["budget.txt", "carol.txt"]);
    expect(names(await search({ to: "2020-01-01" }))).toEqual(["notes.txt"]);
    expect(names(await search({ kinds: ["message"] }))).toEqual([]);
    expect(names(await search({ kinds: ["file"], query: "menu" }))).toEqual(["notes.txt"]);
  });

  it("pages with a cursor", async () => {
    const first = await search({ limit: 2 });
    expect(first.hits).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await search({ limit: 2, cursor: first.nextCursor });
    expect(second.hits).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.hits, ...second.hits].map((h) => h.id)).size).toBe(3);
  });

  it("exports files with their content, place, versions and sharing", async () => {
    await drive.upload(alice, {}, "Plans/budget.txt", bytes("The quarterly budget for widgets, revised"));
    const res = await call(exportRoute, { ids: [budget.id, "not-an-id", "00000000-0000-0000-0000-000000000000"] });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({ app: "drive", id: budget.id, kind: "file", title: "budget.txt", owner: alice.email });
    expect(item.metadata).toMatchObject({ path: "/My files/Plans", versions: 2, version: 2 });
    expect(item.metadata.sharing).toEqual([expect.objectContaining({ email: bob.email, role: "viewer", inheritedFrom: "Plans" })]);
    expect(item.text).toContain("revised");
    expect(Buffer.from(item.attachments[0].base64, "base64").toString()).toBe("The quarterly budget for widgets, revised");
    expect(item.attachments[0]).toMatchObject({ name: "budget.txt", type: "text/plain", size: 41 });
  });

  it("keeps what a held person deletes for good, hidden but found", async () => {
    held.add(alice.email);
    const plans = (await drive.listFolder(alice, {})).items.find((i) => i.name === "Plans")!;
    await drive.moveToTrash(alice, [plans.id]);
    await drive.deleteForever(alice, [plans.id]);
    expect(await drive.trash(alice)).toEqual([]);
    expect((await drive.listFolder(alice, {})).items.map((i) => i.name)).toEqual(["notes.txt"]);
    expect(await drive.search(alice, "budget")).toEqual([]);
    await expect(drive.restore(alice, [plans.id])).rejects.toThrow(/Not found/);
    await expect(drive.content(alice, budget.id)).rejects.toThrow(/Not found/);
    const found = await search({ query: "widgets" });
    expect(found.hits).toEqual([expect.objectContaining({ id: budget.id, deleted: true })]);
    const { items } = await (await call(exportRoute, { ids: [budget.id] })).json();
    expect(Buffer.from(items[0].attachments[0].base64, "base64").toString()).toContain("revised");

    // Emptying the bin is held the same way.
    await drive.moveToTrash(alice, [notes.id]);
    await drive.emptyTrash(alice);
    expect(await drive.trash(alice)).toEqual([]);
    expect((await search({ query: "menu" })).hits[0]).toMatchObject({ id: notes.id, deleted: true });

    // Nobody else is held: Carol's goes for good.
    const c = (await drive.listFolder(carol, {})).items[0];
    await drive.moveToTrash(carol, [c.id]);
    await drive.emptyTrash(carol);
    expect(names(await search({ custodians: [carol.email] }))).toEqual([]);
  });

  it("only hides old versions while the owner is held", async () => {
    process.env.DRIVE_VERSIONS = "1";
    try {
      const f = await drive.upload(alice, {}, "draft.txt", bytes("one"));
      await drive.upload(alice, {}, "draft.txt", bytes("two"));
      expect((await drive.versions(alice, f.id)).map((v) => v.n)).toEqual([2]);
      await expect(drive.content(alice, f.id, 1)).rejects.toThrow(/gone/);
      const { items } = await (await call(exportRoute, { ids: [f.id] })).json();
      expect(items[0].metadata.versions).toBe(2);
      expect(items[0].metadata.versionHistory[1]).toMatchObject({ n: 1, deleted: true });
    } finally {
      delete process.env.DRIVE_VERSIONS;
    }
  });

  it("applies retention except to held owners, and lets go once the hold lifts", async () => {
    const dave = { email: "dave@example.com", name: "Dave" };
    const old = await drive.upload(alice, {}, "old.txt", bytes("old alice"));
    const daves = await drive.upload(dave, {}, "old.txt", bytes("old dave"));
    await q("UPDATE items SET modified_at = now() - interval '400 days' WHERE id = ANY($1)", [[old.id, daves.id]]);
    days = 365;
    await drive.retentionSweep();
    expect((await drive.listFolder(dave, {})).items).toEqual([]);
    expect((await drive.listFolder(alice, {})).items.map((i) => i.name)).toContain("old.txt");
    expect((await search({ query: "old" })).hits.map((h) => [h.owner, !!h.deleted])).toEqual([[alice.email, false]]);

    held.clear();
    await drive.retentionSweep();
    expect((await drive.listFolder(alice, {})).items.map((i) => i.name)).not.toContain("old.txt");
    expect(await q("SELECT 1 FROM items WHERE held_deleted_at IS NOT NULL")).toEqual([]);
    expect(await q("SELECT 1 FROM versions WHERE held_deleted_at IS NOT NULL")).toEqual([]);
    expect(names(await search({ custodians: [alice.email] }))).toEqual(["draft.txt"]);
    days = null;
  });
});
