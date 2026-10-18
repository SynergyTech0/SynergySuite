import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const ann = { email: "ann@example.com", name: "Ann", subject: "a" };
const bob = { email: "bob@example.com", name: "Bob", subject: "b" };
const b64 = (s: string) => Buffer.from(s).toString("base64");
const params = (tag: string) => ({ salt: b64(`salt-${tag}`), kdfIters: 600000, verifierIv: b64(`iv-${tag}`), verifierCt: b64(`ct-${tag}`) });

describe.skipIf(!url)("vault store", async () => {
  const v = await import("../lib/vault");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE vault_config, entries, audit RESTART IDENTITY");
  });
  afterAll(async () => {
    await db().close();
  });

  it("starts unconfigured and is set up once", async () => {
    expect(await v.getVault()).toEqual({ configured: false });
    await expect(v.initVault(ann, { ...params("a"), kdfIters: 1000 })).rejects.toThrow(/rounds/);
    await expect(v.initVault(ann, { ...params("a"), salt: "not base64!" })).rejects.toThrow(/base64/);
    await v.initVault(ann, params("a"));
    await expect(v.initVault(bob, params("b"))).rejects.toMatchObject({ status: 409 });
    expect(await v.getVault()).toEqual({ configured: true, ...params("a") });
  });

  let first = "";
  it("keeps entries as opaque blobs", async () => {
    const e = await v.createEntry(ann, { iv: b64("iv1"), ct: b64("ct1") });
    first = e.id;
    expect(e).toMatchObject({ iv: b64("iv1"), ct: b64("ct1"), created_by: ann.email, updated_by: ann.email });
    await v.createEntry(bob, { iv: b64("iv2"), ct: b64("ct2") });
    const u = await v.updateEntry(bob, first, { iv: b64("iv1b"), ct: b64("ct1b") });
    expect(u).toMatchObject({ ct: b64("ct1b"), created_by: ann.email, updated_by: bob.email });
    await expect(v.createEntry(ann, { iv: "", ct: b64("x") })).rejects.toThrow();
    await expect(v.updateEntry(ann, "999999", { iv: b64("x"), ct: b64("x") })).rejects.toMatchObject({ status: 404 });
    await expect(v.updateEntry(ann, "abc", { iv: b64("x"), ct: b64("x") })).rejects.toMatchObject({ status: 404 });
    expect((await v.listEntries()).map((x) => x.ct)).toEqual([b64("ct1b"), b64("ct2")]);
  });

  it("rekeys every entry at once, or not at all", async () => {
    const all = await v.listEntries();
    // Missing an entry: refused, nothing changes.
    await expect(v.rekey(ann, { ...params("c"), entries: [{ id: all[0].id, iv: b64("n"), ct: b64("n") }] })).rejects.toMatchObject({ status: 409 });
    // A bad blob in the middle: refused, nothing changes.
    await expect(
      v.rekey(ann, { ...params("c"), entries: [{ id: all[0].id, iv: b64("n"), ct: b64("n") }, { id: all[1].id, iv: "!", ct: b64("n") }] }),
    ).rejects.toThrow();
    expect((await v.listEntries()).map((x) => x.ct)).toEqual([b64("ct1b"), b64("ct2")]);
    expect(await v.getVault()).toMatchObject({ salt: params("a").salt });

    await v.rekey(ann, { ...params("c"), entries: all.map((e) => ({ id: e.id, iv: b64(`new-${e.id}`), ct: b64(`new-${e.id}`) })) });
    expect((await v.listEntries()).map((x) => x.ct)).toEqual(all.map((e) => b64(`new-${e.id}`)));
    expect(await v.getVault()).toEqual({ configured: true, ...params("c") });
  });

  it("deletes, and logs who did what", async () => {
    await v.deleteEntry(bob, first);
    await expect(v.deleteEntry(bob, first)).rejects.toMatchObject({ status: 404 });
    await v.report(ann, { action: "reveal", entryId: "2" });
    await v.report(ann, { action: "unlock" });
    await expect(v.report(ann, { action: "entry.delete" })).rejects.toThrow(/Unknown action/);
    const log = await v.auditLog();
    expect(log.map((a) => `${a.user_email} ${a.action} ${a.entry_id ?? ""}`.trim())).toEqual([
      "ann@example.com unlock",
      "ann@example.com reveal 2",
      `bob@example.com entry.delete ${first}`,
      "ann@example.com vault.rekey",
      `bob@example.com entry.update ${first}`,
      "bob@example.com entry.create 2",
      `ann@example.com entry.create ${first}`,
      "ann@example.com vault.init",
    ]);
  });
});
