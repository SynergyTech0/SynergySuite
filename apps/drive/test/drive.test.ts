import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
const dir = mkdtempSync(path.join(tmpdir(), "drive-test-"));
process.env.DRIVE_DIR = dir;
if (url) process.env.DATABASE_URL = url;

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };
const bytes = (s: string | Buffer) => new Response(typeof s === "string" ? s : new Uint8Array(s)).body;

describe.skipIf(!url)("drive", async () => {
  const drive = await import("../lib/drive");
  const { q, db } = await import("../lib/db");
  const blobs = await import("../lib/blobs");
  const read = async (sha: string) => {
    const parts: Buffer[] = [];
    for await (const c of blobs.read(sha)) parts.push(c as Buffer);
    return Buffer.concat(parts).toString();
  };

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE items, libraries, activity CASCADE");
  });
  afterAll(async () => {
    await db().close();
    rmSync(dir, { recursive: true, force: true });
  });

  let a: Awaited<ReturnType<typeof drive.upload>>;

  it("keeps every version of a file saved over itself", async () => {
    a = await drive.upload(alice, {}, "a.txt", bytes("first draft"));
    expect(a.version).toBe(1);
    const again = await drive.upload(alice, {}, "A.txt", bytes("second draft"));
    expect(again.id).toBe(a.id);
    expect(again.version).toBe(2);
    const same = await drive.upload(alice, {}, "a.txt", bytes("second draft"));
    expect(same.version).toBe(2);
    await drive.restoreVersion(alice, a.id, 1);
    const vs = await drive.versions(alice, a.id);
    expect(vs.map((v) => v.n)).toEqual([3, 2, 1]);
    const now = await drive.content(alice, a.id);
    expect(await read(now.sha)).toBe("first draft");
  });

  it("creates the folders of a folder upload", async () => {
    await drive.upload(alice, {}, "Docs/Sub/b.txt", bytes("quarterly budget numbers"));
    await drive.upload(alice, {}, "Docs/c.md", bytes("# Plan"));
    const root = await drive.listFolder(alice, {});
    expect(root.items.map((i) => i.name)).toEqual(["Docs", "a.txt"]);
    const docs = root.items[0];
    const inside = await drive.listFolder(alice, { parent: docs.id });
    expect(inside.items.map((i) => i.name)).toEqual(["Sub", "c.md"]);
    expect(inside.crumbs.map((c) => c.label)).toEqual(["My files", "Docs"]);
  });

  it("keeps files private until they are shared", async () => {
    const docs = (await drive.listFolder(alice, {})).items[0];
    await expect(drive.listFolder(bob, { parent: docs.id })).rejects.toThrow(/Not found/);
    await drive.share(alice, docs.id, "BOB@example.com", "viewer");
    const sub = (await drive.listFolder(bob, { parent: docs.id })).items.find((i) => i.name === "Sub")!;
    const inSub = await drive.listFolder(bob, { parent: sub.id });
    expect(inSub.role).toBe("viewer");
    expect(inSub.crumbs.map((c) => c.label)).toEqual(["Shared with me", "Docs", "Sub"]);
    await expect(drive.upload(bob, { parent: sub.id }, "x.txt", bytes("x"))).rejects.toThrow(/only view/);
    await drive.share(alice, docs.id, bob.email, "editor");
    const x = await drive.upload(bob, { parent: sub.id }, "x.txt", bytes("from bob"));
    expect(x.owner).toBe(alice.email);
    expect((await drive.sharedWithMe(bob)).map((i) => i.name)).toEqual(["Docs"]);
    await expect(drive.move(bob, [x.id], {})).rejects.toThrow(/Only the owner/);
    expect((await drive.listFolder(carol, {})).items).toEqual([]);
  });

  it("finds files by name and by words inside them", async () => {
    expect((await drive.search(alice, "budget")).map((i) => i.name)).toEqual(["b.txt"]);
    expect((await drive.search(bob, "budget")).map((i) => i.name)).toEqual(["b.txt"]);
    expect(await drive.search(carol, "budget")).toEqual([]);
    expect((await drive.search(alice, "%")).length).toBe(0);
  });

  it("deletes to the recycle bin and restores", async () => {
    const docs = (await drive.listFolder(alice, {})).items[0];
    await drive.moveToTrash(alice, [docs.id]);
    expect((await drive.listFolder(alice, {})).items.map((i) => i.name)).toEqual(["a.txt"]);
    expect((await drive.trash(alice)).map((i) => i.name)).toEqual(["Docs"]);
    await expect(drive.listFolder(bob, { parent: docs.id })).rejects.toThrow(/Not found/);
    expect(await drive.search(alice, "budget")).toEqual([]);
    // A new folder with the same name may be made while the old one is in the bin.
    await drive.createFolder(alice, {}, "Docs");
    await drive.restore(alice, [docs.id]);
    expect((await drive.listFolder(alice, {})).items.map((i) => i.name)).toEqual(["Docs", "Docs (1)", "a.txt"]);
  });

  it("moves and copies, but never into itself", async () => {
    // The restored folder became "Docs (1)"; "Docs" is the empty one made while it was in the bin.
    const [empty, docs] = (await drive.listFolder(alice, {})).items;
    const sub = (await drive.listFolder(alice, { parent: docs.id })).items[0];
    await expect(drive.move(alice, [docs.id], { parent: sub.id })).rejects.toThrow(/inside itself/);
    await drive.copy(alice, [docs.id], { parent: empty.id });
    const copied = (await drive.listFolder(alice, { parent: empty.id })).items;
    expect(copied.map((i) => i.name)).toEqual(["Docs (1)"]);
    const copiedSub = (await drive.listFolder(alice, { parent: copied[0].id })).items.find((i) => i.name === "Sub")!;
    expect((await drive.listFolder(alice, { parent: copiedSub.id })).items.map((i) => i.name)).toEqual(["b.txt", "x.txt"]);
    await drive.move(alice, [a.id], { parent: empty.id });
    expect((await drive.listFolder(alice, { parent: empty.id })).items.map((i) => i.name)).toEqual(["Docs (1)", "a.txt"]);
  });

  it("opens view links without an account, only inside what was shared", async () => {
    const docs = (await drive.listFolder(alice, {})).items.find((i) => i.name === "Docs (1)")!;
    await expect(drive.createLink(bob, a.id)).rejects.toThrow(/Not found/);
    await drive.createLink(alice, docs.id, 7);
    const { links } = await drive.sharing(alice, docs.id);
    expect(links).toHaveLength(1);
    const view = await drive.linkView(links[0].token);
    expect(view.children.map((c) => c.name)).toEqual(["Sub", "c.md"]);
    const md = view.children.find((c) => c.name === "c.md")!;
    expect(await read((await drive.linkContent(links[0].token, md.id)).sha)).toBe("# Plan");
    await expect(drive.linkContent(links[0].token, a.id)).rejects.toThrow(/Not found/);
    await expect(drive.linkView("nope")).rejects.toThrow(/expired/);
    await drive.deleteLink(alice, docs.id, links[0].token);
    await expect(drive.linkView(links[0].token)).rejects.toThrow(/expired/);
  });

  it("shares a library's files with its members", async () => {
    const lib = await drive.createLibrary(carol, "Finance");
    await expect(drive.listFolder(alice, { library: lib.id })).rejects.toThrow(/Not found/);
    await drive.setMember(carol, lib.id, alice.email, "editor");
    await expect(drive.setMember(alice, lib.id, bob.email, "editor")).rejects.toThrow(/owners/);
    await expect(drive.removeMember(carol, lib.id, carol.email)).rejects.toThrow(/at least one owner/);
    const before = await drive.usage(alice.email);
    await drive.move(alice, [a.id], { library: lib.id });
    expect(await drive.usage(alice.email)).toBeLessThan(before);
    const list = await drive.listFolder(carol, { library: lib.id });
    expect(list.items.map((i) => i.name)).toEqual(["a.txt"]);
    expect(list.crumbs[0]).toEqual({ label: "Finance", library: lib.id });
    await expect(drive.deleteLibrary(carol, lib.id)).rejects.toThrow(/first/);
    expect((await drive.libraries(alice)).map((l) => l.name)).toEqual(["Finance"]);
  });

  it("stops uploads past the storage quota", async () => {
    process.env.DRIVE_QUOTA_MB = "1";
    try {
      await expect(drive.upload(carol, {}, "big.bin", bytes(Buffer.alloc(1_100_000)))).rejects.toThrow(/storage/);
      expect((await drive.listFolder(carol, {})).items).toEqual([]);
    } finally {
      delete process.env.DRIVE_QUOTA_MB;
    }
  });

  it("deletes forever, with everything inside", async () => {
    const docs = (await drive.listFolder(alice, {})).items.find((i) => i.name === "Docs (1)")!;
    await drive.moveToTrash(alice, [docs.id]);
    await expect(drive.deleteForever(bob, [docs.id])).rejects.toThrow();
    await drive.deleteForever(alice, [docs.id]);
    expect(await drive.trash(alice)).toEqual([]);
    expect(await q("SELECT 1 FROM items WHERE name = 'c.md' AND trash_root IS NULL")).toHaveLength(1); // the copy survives
  });
});
