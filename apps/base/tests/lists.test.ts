/**
 * Lists: the gallery, board and calendar settings (pure), and against a real Postgres
 * (TEST_DATABASE_URL) saving them per table and sharing a database with people.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Field } from "@/lib/fields";
import { cleanListViews, monthGrid, resolveViews } from "@/lib/listViewSettings";

const f = (id: string, type: Field["type"], choices?: string[]): Field => ({ id, name: id.toUpperCase(), pgName: `f_${id}`, type, options: choices ? { choices } : {}, required: false, description: "", position: 0 });
const fields = [f("id", "autonumber"), f("notes", "longtext"), f("title", "text"), f("status", "choice", ["New", "Done"]), f("due", "date"), f("owner", "email"), f("cost", "currency")];

describe("list view settings", () => {
  it("picks a title, a choice field and a date field by default", () => {
    const v = resolveViews(fields, cleanListViews({}));
    expect(v.gallery.title?.id).toBe("title");
    expect(v.gallery.fields.map((x) => x.id)).toEqual(["status", "due", "owner"]);
    expect(v.board.group?.id).toBe("status");
    expect(v.board.fields.map((x) => x.id)).toEqual(["due", "owner", "cost"]);
    expect(v.calendar.date?.id).toBe("due");
    expect(v.calendar.title?.id).toBe("title");
  });

  it("uses what was saved where it still fits", () => {
    const v = resolveViews(fields, cleanListViews({ gallery: { title: "owner", fields: ["cost", "gone", "owner"] }, board: { group: "title" }, calendar: { date: "status", title: "owner" } }));
    expect(v.gallery.title?.id).toBe("owner");
    expect(v.gallery.fields.map((x) => x.id)).toEqual(["cost"]);
    // A text field can't make board columns, nor a choice a calendar; the defaults stand in.
    expect(v.board.group?.id).toBe("status");
    expect(v.calendar.date?.id).toBe("due");
    expect(v.calendar.title?.id).toBe("owner");
  });

  it("has nothing to group or place by when the table lacks the fields", () => {
    const v = resolveViews([f("id", "autonumber"), f("notes", "longtext")], cleanListViews(null));
    expect(v.board.group).toBeNull();
    expect(v.calendar.date).toBeNull();
    expect(v.gallery.title?.id).toBe("id");
  });

  it("keeps only the known parts of settings", () => {
    expect(cleanListViews({ gallery: { title: 5, fields: ["a", "a", "b", 3, "c", "d", "e", "f", "g"] }, extra: true })).toEqual({
      gallery: { title: undefined, fields: ["a", "b", "c", "d", "e", "f"] },
      board: { group: undefined, title: undefined, fields: undefined },
      calendar: { date: undefined, title: undefined },
    });
  });

  it("lays a month out in whole weeks from Sunday", () => {
    const oct = monthGrid(2026, 9);
    expect(oct[0]).toBe("2026-09-27");
    expect(oct.at(-1)).toBe("2026-10-31");
    expect(oct).toHaveLength(35);
    const feb = monthGrid(2026, 1);
    expect([feb[0], feb.at(-1), feb.length]).toEqual(["2026-02-01", "2026-02-28", 28]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("lists and sharing", () => {
  let cat: typeof import("@/lib/catalog");
  let lv: typeof import("@/lib/listViews");
  let sh: typeof import("@/lib/sharing");
  let pg: typeof import("@/lib/db");
  const owner = "l-owner@example.com";
  const ed = "l-editor@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    lv = await import("@/lib/listViews");
    sh = await import("@/lib/sharing");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  it("saves view settings per table, for editors only", async () => {
    const d = await cat.createDatabase(owner, { name: "Tasks" });
    made.push(d.id);
    const t = await cat.createTable(d.id, owner, { name: "Tasks", fields: [{ name: "Title", type: "text" }, { name: "Status", type: "choice", options: { choices: ["New", "Done"] } }] });
    expect(await lv.getListViews(t.id, owner)).toEqual(cleanListViews({}));
    const saved = await lv.saveListViews(t.id, owner, { board: { group: t.fields[2].id, junk: 1 } });
    expect(saved.board.group).toBe(t.fields[2].id);
    expect((await lv.getListViews(t.id, owner)).board.group).toBe(t.fields[2].id);
    await sh.shareDatabase(d.id, owner, { email: ed, role: "viewer" });
    expect((await lv.getListViews(t.id, ed)).board.group).toBe(t.fields[2].id);
    await expect(lv.saveListViews(t.id, ed, {})).rejects.toMatchObject({ status: 403 });
    await expect(lv.getListViews(t.id, "stranger@example.com")).rejects.toMatchObject({ status: 404 });
    await cat.deleteTable(t.id, owner);
    expect((await pg.db().q(`SELECT 1 FROM base_list_views WHERE table_id = $1`, [t.id])).rows).toHaveLength(0);
  });

  it("shares a database, changes roles and always keeps an owner", async () => {
    const d = await cat.createDatabase(owner, { name: "Shared" });
    made.push(d.id);
    let members = await sh.shareDatabase(d.id, owner, { email: " L-Editor@Example.com ", role: "editor" });
    expect(members.map((m) => [m.email, m.role])).toEqual([
      [owner, "owner"],
      [ed, "editor"],
    ]);
    expect((await cat.getDatabase(d.id, ed))?.role).toBe("editor");
    await expect(sh.shareDatabase(d.id, ed, { email: "x@example.com", role: "viewer" })).rejects.toMatchObject({ status: 403 });
    await expect(sh.shareDatabase(d.id, owner, { email: "nope", role: "viewer" })).rejects.toThrow(/email address/);
    await expect(sh.shareDatabase(d.id, owner, { email: ed, role: "admin" })).rejects.toThrow(/Pick owner/);
    // The only owner can't step down or leave.
    await expect(sh.shareDatabase(d.id, owner, { email: owner, role: "editor" })).rejects.toMatchObject({ status: 409 });
    await expect(sh.unshareDatabase(d.id, owner, owner)).rejects.toMatchObject({ status: 409 });
    // With a second owner, they can.
    await sh.shareDatabase(d.id, owner, { email: ed, role: "owner" });
    members = await sh.shareDatabase(d.id, owner, { email: owner, role: "viewer" });
    expect(members.map((m) => [m.email, m.role])).toEqual([
      [ed, "owner"],
      [owner, "viewer"],
    ]);
    // Anyone may leave; only owners remove others.
    await expect(sh.unshareDatabase(d.id, owner, ed)).rejects.toMatchObject({ status: 403 });
    expect(await sh.unshareDatabase(d.id, owner, owner)).toBeNull();
    expect(await cat.getDatabase(d.id, owner)).toBeNull();
    await expect(sh.listMembers(d.id, owner)).rejects.toMatchObject({ status: 404 });
    expect((await sh.listMembers(d.id, ed)).map((m) => m.email)).toEqual([ed]);
    await sh.shareDatabase(d.id, ed, { email: owner, role: "owner" });
  });
});
