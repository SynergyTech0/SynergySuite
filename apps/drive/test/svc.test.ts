import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";

// Libraries kept by another app (Sites) through /api/svc/libraries. Runs against a real Postgres
// when TEST_DATABASE_URL is set, in a database of its own ("<name>_svc").
const base = process.env.TEST_DATABASE_URL;
process.env.DRIVE_DIR = mkdtempSync(path.join(tmpdir(), "drive-svc-"));
process.env.DRIVE_SVC_TOKEN = "svc-token";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_svc`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };

describe.skipIf(!base)("libraries kept by another app", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const drive = await import("../lib/drive");
  const { db } = await import("../lib/db");
  const create = await import("../app/api/svc/libraries/route");
  const one = await import("../app/api/svc/libraries/[id]/route");
  const items = await import("../app/api/svc/libraries/[id]/items/route");
  afterAll(() => db().close());

  const req = (method: string, body?: unknown, token: string | null = "svc-token", url = "http://drive/api/svc/libraries") =>
    new Request(url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const members = { members: [{ email: alice.email, role: "owner" }, { email: bob.email, role: "viewer" }] };

  it("refuses calls without the token", async () => {
    expect((await create.POST(req("POST", { name: "X", managedBy: "sites:1", ...members }, null))).status).toBe(401);
    expect((await create.POST(req("POST", { name: "X", managedBy: "sites:1", ...members }, "wrong"))).status).toBe(401);
  });

  it("makes a library with the given people, which its owners can't re-staff in Drive", async () => {
    const res = await create.POST(req("POST", { name: "Harbour team", managedBy: "sites:7", ...members }));
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const mine = (await drive.libraries(alice)).find((l) => l.id === id)!;
    expect(mine).toMatchObject({ name: "Harbour team", role: "owner", managedBy: "sites:7", members: 2 });
    expect((await drive.libraries(bob)).find((l) => l.id === id)?.role).toBe("viewer");
    await expect(drive.setMember(alice, id, "carol@example.com", "editor")).rejects.toThrow(/in Sites/);
    await expect(drive.updateLibrary(alice, id, { name: "Other" })).rejects.toThrow(/in Sites/);
    await expect(drive.removeMember(bob, id, bob.email)).rejects.toThrow(/in Sites/);
    await expect(drive.deleteLibrary(alice, id)).rejects.toThrow(/in Sites/);

    // Its people and name follow the other app.
    const put = await one.PUT(
      req("PUT", { name: "Harbour crew", members: [{ email: alice.email, role: "owner" }, { email: "carol@example.com", role: "editor" }] }),
      params(id),
    );
    expect(put.status).toBe(200);
    expect(await drive.libraries(bob)).toEqual([]);
    expect((await drive.libraries({ email: "carol@example.com", name: "Carol" }))[0]).toMatchObject({ name: "Harbour crew", role: "editor" });
    expect((await one.PUT(req("PUT", { members: [{ email: bob.email, role: "viewer" }] }), params(id))).status).toBe(400);

    // Files in it are listed for the app showing it.
    const folder = await drive.createFolder(alice, { library: id }, "Plans");
    await drive.upload(alice, { parent: folder.id }, "route.txt", new Response("north quay").body, 10);
    const top = (await (await items.GET(req("GET", undefined, "svc-token", `http://drive/api/svc/libraries/${id}/items`), params(id))).json()) as {
      items: { name: string; kind: string }[]; crumbs: { name: string }[];
    };
    expect(top.items.map((i) => i.name)).toEqual(["Plans"]);
    expect(top.crumbs.map((c) => c.name)).toEqual(["Harbour crew"]);
    const inside = (await (await items.GET(req("GET", undefined, "svc-token", `http://drive/api/svc/libraries/${id}/items?folder=${folder.id}`), params(id))).json()) as {
      items: { name: string }[]; crumbs: { name: string }[];
    };
    expect(inside.items.map((i) => i.name)).toEqual(["route.txt"]);
    expect(inside.crumbs.map((c) => c.name)).toEqual(["Harbour crew", "Plans"]);

    // It can't be deleted while it holds files.
    expect((await one.DELETE(req("DELETE"), params(id))).status).toBe(409);
    await drive.moveToTrash(alice, [folder.id]);
    await drive.emptyTrash(alice);
    expect((await one.DELETE(req("DELETE"), params(id))).status).toBe(200);
    expect(await drive.libraries(alice)).toEqual([]);
  });

  it("leaves Drive's own libraries alone", async () => {
    const lib = await drive.createLibrary(alice, "Finance");
    expect((await one.PUT(req("PUT", members), params(lib.id))).status).toBe(409);
    expect((await items.GET(req("GET"), params(lib.id))).status).toBe(409);
    expect((await one.DELETE(req("DELETE"), params("not-a-uuid"))).status).toBe(404);
  });
});
