/** Apps, sharing, publishing and versions against a real Postgres (TEST_DATABASE_URL). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("apps", () => {
  let apps: typeof import("@/lib/apps");
  let pg: typeof import("@/lib/db");
  const owner = "maker@example.com";
  const editor = "helper@example.com";
  const user = "runner@example.com";
  const stranger = "someone@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    apps = await import("@/lib/apps");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await apps.deleteApp(id, owner).catch(() => {});
    await pg.db().close();
  });

  async function fresh(name = "Inspections") {
    const a = await apps.createApp(owner, { name, layout: "phone" });
    made.push(a.id);
    return a;
  }

  it("makes a blank draft that only its owner sees", async () => {
    const a = await fresh();
    expect(a.role).toBe("owner");
    expect(a.published).toBe(false);
    expect(a.draft?.width).toBe(640);
    expect(a.draft?.screens).toHaveLength(1);
    await expect(apps.getApp(a.id, stranger)).rejects.toMatchObject({ status: 404 });
    expect((await apps.listApps(owner)).some((x) => x.id === a.id)).toBe(true);
    expect((await apps.listApps(stranger)).some((x) => x.id === a.id)).toBe(false);
  });

  it("gives users only the published version", async () => {
    const a = await fresh();
    await apps.setMember(a.id, owner, { email: user, role: "user" });
    const before = await apps.getApp(a.id, user);
    expect(before.draft).toBeNull();
    expect(before.definition).toBeNull();

    const draft = { ...a.draft!, onStart: `Set(greeting, "v1")` };
    await apps.updateApp(a.id, owner, { definition: draft });
    const p = await apps.publishApp(a.id, owner);
    expect(p.publishedVersion).toBe(1);

    await apps.updateApp(a.id, owner, { definition: { ...draft, onStart: `Set(greeting, "v2")` } });
    const seen = await apps.getApp(a.id, user);
    expect(seen.draft).toBeNull();
    expect(seen.definition?.onStart).toBe(`Set(greeting, "v1")`);
    await expect(apps.updateApp(a.id, user, { name: "Mine now" })).rejects.toMatchObject({ status: 403 });
  });

  it("lets editors change and publish, and restores old versions to the draft", async () => {
    const a = await fresh();
    await apps.setMember(a.id, owner, { email: editor, role: "editor" });
    await apps.updateApp(a.id, editor, { definition: { ...a.draft!, onStart: `Set(n, 1)` } });
    await apps.publishApp(a.id, editor);
    await apps.updateApp(a.id, editor, { definition: { ...a.draft!, onStart: `Set(n, 2)` } });
    await apps.publishApp(a.id, editor);
    const versions = await apps.listVersions(a.id, owner);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].publishedBy).toBe(editor);

    const restored = await apps.restoreVersion(a.id, editor, 1);
    expect(restored.draft?.onStart).toBe(`Set(n, 1)`);
    expect(restored.definition?.onStart).toBe(`Set(n, 2)`);
    await expect(apps.deleteApp(a.id, editor)).rejects.toMatchObject({ status: 403 });
  });

  it("shares with everyone as users only, and always keeps an owner", async () => {
    const a = await fresh();
    await expect(apps.setMember(a.id, owner, { email: "*", role: "editor" })).rejects.toMatchObject({ status: 400 });
    await apps.setMember(a.id, owner, { email: "*", role: "user" });
    expect((await apps.getApp(a.id, stranger)).role).toBe("user");
    await expect(apps.removeMember(a.id, owner, owner)).rejects.toMatchObject({ status: 409 });
    await apps.setMember(a.id, owner, { email: editor, role: "owner" });
    await apps.removeMember(a.id, owner, owner);
    await expect(apps.getApp(a.id, owner)).resolves.toMatchObject({ role: "user" });
    await apps.setMember(a.id, editor, { email: owner, role: "owner" });
  });

  it("rejects definitions that don't check out", async () => {
    const a = await fresh();
    await expect(apps.updateApp(a.id, owner, { definition: { ...a.draft!, screens: [] } })).rejects.toMatchObject({ status: 400 });
  });

  it("only serves data sources the app uses, to people who may run it", async () => {
    const a = await fresh();
    const ds = { name: "Orders", kind: "base" as const, databaseId: "d1", tableId: "t1", tableName: "Orders", fields: [] };
    await apps.updateApp(a.id, owner, { definition: { ...a.draft!, dataSources: [ds] } });
    await apps.setMember(a.id, owner, { email: user, role: "user" });
    expect((await apps.dataSourceFor(a.id, owner, "t1")).name).toBe("Orders");
    // Not published yet, so its users can't reach the table through it.
    await expect(apps.dataSourceFor(a.id, user, "t1")).rejects.toMatchObject({ status: 404 });
    await apps.publishApp(a.id, owner);
    expect((await apps.dataSourceFor(a.id, user, "t1")).name).toBe("Orders");
    await expect(apps.dataSourceFor(a.id, user, "t2")).rejects.toMatchObject({ status: 404 });
    await expect(apps.dataSourceFor(a.id, stranger, "t1")).rejects.toMatchObject({ status: 404 });
  });
});
