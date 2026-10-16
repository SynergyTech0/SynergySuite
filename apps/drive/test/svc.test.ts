import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_svc"), so it can run alongside drive.test.ts.
const base = process.env.TEST_DATABASE_URL;
const dir = mkdtempSync(path.join(tmpdir(), "drive-svc-"));
process.env.DRIVE_DIR = dir;
process.env.PROXY_SHARED_SECRET = "suite-secret";
process.env.SUITE_DOMAIN = "example.com";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_svc`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

// The routes read the secret through next/headers; each call here sets what they see.
let sent = new Headers();
vi.mock("next/headers", () => ({ headers: async () => sent }));

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };
const team = "groups:0b6c3c52-6f3e-4b1e-9d55-1f2a3b4c5d6e";
const bytes = (s: string) => new Response(s).body;

describe.skipIf(!base)("drive service api", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const drive = await import("../lib/drive");
  const { q, db } = await import("../lib/db");
  const lib = await import("../app/api/svc/libraries/[source]/route");
  const recentRoute = await import("../app/api/svc/libraries/[source]/recent/route");

  const call = async (
    handler: (req: Request, ctx: { params: Promise<Record<"source", string>> }) => Promise<Response>,
    method: string,
    src: string,
    opts: { json?: unknown; secret?: string | null; query?: string } = {},
  ) => {
    sent = new Headers(opts.secret === null ? {} : { "x-proxy-auth-secret": opts.secret ?? "suite-secret" });
    const req = new Request(`http://drive.internal/api/svc/libraries/${encodeURIComponent(src)}${opts.query ?? ""}`, {
      method,
      headers: { "content-type": "application/json" },
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    });
    const res = await handler(req, { params: Promise.resolve({ source: encodeURIComponent(src) }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const put = (json: unknown, src = team, secret?: string | null) => call(lib.PUT, "PUT", src, { json, secret });

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE items, libraries, activity CASCADE");
  });
  afterAll(async () => {
    await db().close();
    rmSync(dir, { recursive: true, force: true });
  });

  let libId = "";

  it("creates the team's library with exactly its members", async () => {
    const res = await put({
      name: "Marketing",
      description: "Team files",
      members: [
        { email: " Alice@Example.com ", role: "owner" },
        { email: "bob@example.com", role: "editor" },
        { email: "bob@example.com", role: "viewer" },
      ],
    });
    expect(res.status).toBe(200);
    libId = res.body.id as string;
    expect(res.body.url).toBe(`https://drive.example.com/?library=${libId}`);
    const mine = await drive.libraries(alice);
    expect(mine).toEqual([{ id: libId, name: "Marketing", description: "Team files", role: "owner", members: 2, team: true }]);
    expect(await drive.members(alice, libId)).toEqual([
      { email: alice.email, role: "owner" },
      { email: bob.email, role: "editor" },
    ]);
  });

  it("renames and replaces the members on a later call, keeping the same library", async () => {
    const res = await put({ name: "Brand", members: [{ email: "bob@example.com", role: "owner" }, { email: carol.email, role: "viewer" }] });
    expect(res.body.id).toBe(libId);
    expect(await drive.libraries(alice)).toEqual([]);
    const [l] = await drive.libraries(bob);
    expect(l).toMatchObject({ name: "Brand", description: "Team files", role: "owner", team: true });
    expect(await drive.members(bob, libId)).toEqual([
      { email: bob.email, role: "owner" },
      { email: carol.email, role: "viewer" },
    ]);
    expect((await q("SELECT 1 FROM libraries WHERE source = $1", [team])).length).toBe(1);
  });

  it("refuses member edits, renames and deletes made in Drive", async () => {
    await expect(drive.setMember(bob, libId, alice.email, "editor")).rejects.toThrow("Members of a team's library are managed in Groups");
    await expect(drive.removeMember(bob, libId, carol.email)).rejects.toThrow(/managed in Groups/);
    await expect(drive.removeMember(carol, libId, carol.email)).rejects.toThrow(/managed in Groups/);
    await expect(drive.updateLibrary(bob, libId, { name: "Other" })).rejects.toThrow(/renamed in Groups/);
    await expect(drive.deleteLibrary(bob, libId)).rejects.toThrow(/deleted in Groups/);
    await drive.updateLibrary(bob, libId, { description: "Brand assets" });
    // An ordinary library still works as before.
    const own = await drive.createLibrary(alice, "Alice's");
    await drive.setMember(alice, own.id, "dave@example.com", "editor");
    expect((await drive.members(alice, own.id)).length).toBe(2);
  });

  it("lists the library's recent items, leaving out the recycle bin", async () => {
    const plan = await drive.upload(bob, { library: libId }, "Plans/plan.txt", bytes("the plan"));
    const logo = await drive.upload(bob, { library: libId }, "logo.txt", bytes("logo"));
    const old = await drive.upload(bob, { library: libId }, "old.txt", bytes("old"));
    await drive.moveToTrash(bob, [old.id]);
    const res = await call(recentRoute.GET, "GET", team, { query: "/recent?limit=10" });
    expect(res.status).toBe(200);
    const items = res.body.items as { id: string; name: string; kind: string; url: string; modifiedBy: string; size: number }[];
    expect(items.map((i) => i.name).sort()).toEqual(["Plans", "logo.txt", "plan.txt"]);
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName["logo.txt"]).toMatchObject({ kind: "file", modifiedBy: bob.email, size: 4 });
    expect(byName["logo.txt"].url).toBe(`https://drive.example.com/?library=${libId}&preview=${logo.id}`);
    expect(byName["plan.txt"].url).toBe(`https://drive.example.com/?parent=${plan.parentId}&preview=${plan.id}`);
    expect(byName.Plans.url).toBe(`https://drive.example.com/?parent=${plan.parentId}`);
    const one = await call(recentRoute.GET, "GET", team, { query: "/recent?limit=1" });
    expect((one.body.items as unknown[]).length).toBe(1);
  });

  it("answers 404 for a team with no library yet", async () => {
    const res = await call(recentRoute.GET, "GET", "groups:00000000-0000-0000-0000-000000000000", { query: "/recent" });
    expect(res.status).toBe(404);
  });

  it("refuses sources that are not a group, and bad bodies", async () => {
    for (const src of ["groups:nope", "l:123", "groups:0b6c3c52-6f3e-4b1e-9d55-1f2a3b4c5d6e/x", "GROUPS:0b6c3c52-6f3e-4b1e-9d55-1f2a3b4c5d6e"]) {
      expect((await put({ name: "X", members: [] }, src)).status).toBe(400);
    }
    expect((await put({ name: "X", members: [{ email: "a@example.com", role: "admin" }] })).status).toBe(400);
    expect((await put({ name: "X", members: [{ email: "not an email", role: "owner" }] })).status).toBe(400);
    expect((await put({ name: "", members: [] })).status).toBe(400);
    expect((await drive.libraries(bob))[0].name).toBe("Brand");
  });

  it("needs the suite's secret, answering 404 without it", async () => {
    for (const secret of [null, "wrong"]) {
      const res = await put({ name: "Hijacked", members: [{ email: "eve@example.com", role: "owner" }] }, team, secret);
      expect(res).toEqual({ status: 404, body: { error: "Not found" } });
      expect((await call(recentRoute.GET, "GET", team, { query: "/recent", secret })).status).toBe(404);
      expect((await call(lib.DELETE, "DELETE", team, { secret })).status).toBe(404);
    }
    expect((await drive.libraries(bob))[0].name).toBe("Brand");
  });

  it("removes every member when the team goes, keeping the files", async () => {
    expect((await call(lib.DELETE, "DELETE", team)).body).toEqual({ ok: true });
    expect(await drive.libraries(bob)).toEqual([]);
    expect((await q("SELECT 1 FROM items WHERE library_id = $1", [libId])).length).toBeGreaterThan(0);
    expect((await call(lib.DELETE, "DELETE", "groups:00000000-0000-0000-0000-000000000000")).status).toBe(200);
    // The team coming back gets the same library and files.
    const again = await put({ name: "Brand", members: [{ email: bob.email, role: "owner" }] });
    expect(again.body.id).toBe(libId);
    expect((await drive.listFolder(bob, { library: libId })).items.map((i) => i.name)).toEqual(["Plans", "logo.txt"]);
  });
});
