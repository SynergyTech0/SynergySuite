import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";

const page = (label: string) =>
  `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>`;

describe.skipIf(!url)("diagrams", async () => {
  const d = await import("../lib/diagrams");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE diagrams CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("creates blank and imported diagrams with searchable text", async () => {
    const blank = await d.create(alice, {});
    expect(blank).toMatchObject({ name: "Untitled diagram", owner: alice, role: "owner", pages: 1, version: 1, members: [] });
    const flow = await d.create(alice, { name: "Hiring flow.vsdx", xml: page("Phone screen") });
    expect(flow.name).toBe("Hiring flow");
    expect((await d.list(alice, { query: "phone" })).map((x) => x.id)).toEqual([flow.id]);
    expect((await d.list(alice, { query: "hiring" })).map((x) => x.id)).toEqual([flow.id]);
    // 100% isn't a wildcard.
    expect(await d.list(alice, { query: "100%" })).toEqual([]);
    await expect(d.create(alice, { xml: "<svg/>" })).rejects.toThrow(/isn't a draw.io diagram/);
  });

  it("shares to edit or view, and keeps it from everyone else", async () => {
    const x = await d.create(alice, { name: "Network", xml: page("Router") });
    await d.share(alice, x.id, bob, "view");
    expect((await d.list(bob, { view: "shared" })).map((y) => [y.name, y.role])).toEqual([["Network", "view"]]);
    expect(await d.list(bob, { view: "mine" })).toEqual([]);
    await expect(d.get(carol, x.id)).rejects.toThrow(/not found/);
    await expect(d.save(bob, x.id, { xml: page("Switch"), baseVersion: 1 })).rejects.toThrow(/only view/);
    await expect(d.share(bob, x.id, carol)).rejects.toThrow(/Only the owner/);
    // A viewer can still make a copy of their own.
    const mine = await d.copy(bob, x.id);
    expect(mine).toMatchObject({ name: "Copy of Network", owner: bob, role: "owner" });
    await d.share(alice, x.id, bob, "edit");
    const saved = await d.save(bob, x.id, { xml: page("Switch"), baseVersion: 1 });
    expect(saved).toMatchObject({ version: 2, changed: true });
    expect((await d.get(alice, x.id)).modifiedBy).toBe(bob);
    await expect(d.share(alice, x.id, "not-an-email")).rejects.toThrow(/email/);
    await d.unshare(alice, x.id, bob);
    await expect(d.get(bob, x.id)).rejects.toThrow(/not found/);
  });

  it("refuses a save over someone else's newer one unless asked, and keeps versions", async () => {
    const x = await d.create(alice, { name: "Plan", xml: page("v1") });
    await d.share(alice, x.id, bob, "edit");
    // An unchanged autosave changes nothing.
    expect(await d.save(alice, x.id, { xml: page("v1"), baseVersion: 1 })).toMatchObject({ version: 1, changed: false });
    await d.save(alice, x.id, { xml: page("v2"), baseVersion: 1 });
    await expect(d.save(bob, x.id, { xml: page("bob's"), baseVersion: 1 })).rejects.toMatchObject({ status: 409, message: `${alice} saved a newer copy of this diagram` });
    const forced = await d.save(bob, x.id, { xml: page("bob's"), baseVersion: 1, force: true });
    expect(forced.version).toBe(3);
    // v1 was kept (first change), and v2 because someone else then saved over it.
    const vs = await d.versions(alice, x.id);
    expect(vs.map((v) => [v.version, v.savedBy])).toEqual([[2, alice], [1, alice]]);
    // Within ten minutes, the same person's next save doesn't add another.
    await d.save(bob, x.id, { xml: page("bob's again"), baseVersion: 3 });
    expect(await d.versions(alice, x.id)).toHaveLength(2);
    const v1 = vs.find((v) => v.version === 1)!;
    expect((await d.versionXml(bob, x.id, v1.id)).xml).toContain("v1");
    const restored = await d.restore(alice, x.id, v1.id);
    expect((await d.get(alice, x.id)).xml).toContain('value="v1"');
    expect(restored.version).toBe(5);
    expect((await d.versions(alice, x.id))[0]).toMatchObject({ version: 4, savedBy: bob });
  });

  it("keeps only the newest versions", async () => {
    process.env.DIAGRAMS_VERSIONS = "2";
    try {
      const x = await d.create(carol, { name: "Churn", xml: page("0") });
      for (let i = 1; i <= 4; i++) {
        await q("UPDATE diagram_versions SET saved_at = saved_at - interval '1 hour' WHERE diagram_id = $1", [x.id]);
        await d.save(carol, x.id, { xml: page(String(i)), baseVersion: i });
      }
      expect((await d.versions(carol, x.id)).map((v) => v.version)).toEqual([4, 3]);
    } finally {
      delete process.env.DIAGRAMS_VERSIONS;
    }
  });

  it("puts what each person opened last at the top of Recent", async () => {
    const [a, b] = [await d.create(carol, { name: "A" }), await d.create(carol, { name: "B" })];
    await q("UPDATE diagrams SET modified_at = now() - interval '1 day' WHERE id = ANY($1::uuid[])", [[a.id, b.id]]);
    await q("UPDATE opened SET opened_at = now() - interval '1 day' WHERE diagram_id = ANY($1::uuid[])", [[a.id, b.id]]);
    await d.get(carol, a.id, { open: true });
    expect((await d.list(carol, { view: "recent" })).slice(0, 1).map((x) => x.name)).toEqual(["A"]);
  });

  it("stores a PNG thumbnail and nothing else", async () => {
    const x = await d.create(alice, { name: "Pic" });
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await d.setThumbnail(alice, x.id, `data:image/png;base64,${png.toString("base64")}`);
    expect((await d.thumbnail(alice, x.id))?.png.equals(png)).toBe(true);
    await expect(d.setThumbnail(alice, x.id, "data:image/png;base64,aGVsbG8=")).rejects.toThrow(/PNG/);
    expect((await d.list(alice, { query: "pic" }))[0].hasThumbnail).toBe(true);
  });

  it("deletes for everyone when the owner deletes, and only from your list otherwise", async () => {
    const x = await d.create(alice, { name: "Shared out" });
    await d.share(alice, x.id, bob, "edit");
    await d.remove(bob, x.id);
    expect((await d.list(bob)).map((y) => y.id)).not.toContain(x.id);
    expect((await d.get(alice, x.id)).members).toEqual([]);
    await d.remove(alice, x.id);
    expect(await q("SELECT 1 FROM diagrams WHERE id = $1", [x.id])).toEqual([]);
  });
});
