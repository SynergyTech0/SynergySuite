import { describe, expect, it } from "vitest";
import { checkApp, type DataSource } from "@/lib/model";
import { fromTable } from "@/lib/generate";
import { AppRuntime, type DataAdapter } from "@/lib/runtime";
import type { BaseRow } from "@/lib/records";
import { FxObject, type Rec } from "@/lib/fx";

const source: DataSource = {
  name: "Tasks",
  kind: "base",
  databaseId: "db1",
  tableId: "t1",
  tableName: "Tasks",
  fields: [
    { id: "f_id", name: "ID", type: "autonumber" },
    { id: "f_title", name: "Title", type: "text", required: true },
    { id: "f_due", name: "Due Date", type: "date" },
    { id: "f_done", name: "Done", type: "yesno" },
    { id: "f_cost", name: "Cost", type: "currency" },
    { id: "f_tags", name: "Tags", type: "multichoice", choices: ["red", "blue"] },
  ],
};

/** Base in memory, with Base's value shapes (numbers as text, dates as yyyy-mm-dd). */
function memoryBase(rows: BaseRow[]): DataAdapter & { rows: BaseRow[]; calls: string[] } {
  let next = rows.length + 1;
  const calls: string[] = [];
  const withId = (id: string, values: Record<string, unknown>): BaseRow => ({ id, values: { ...values, f_id: id } });
  return {
    rows,
    calls,
    async list() {
      calls.push("list");
      return rows.map((r) => ({ ...r }));
    },
    async create(_s, values) {
      calls.push(`create ${JSON.stringify(values)}`);
      const row = withId(String(next++), values);
      rows.push(row);
      return row;
    },
    async update(_s, id, values) {
      calls.push(`update ${id} ${JSON.stringify(values)}`);
      const i = rows.findIndex((r) => r.id === id);
      rows[i] = withId(id, { ...rows[i].values, ...values });
      return rows[i];
    },
    async remove(_s, ids) {
      calls.push(`remove ${ids.join(",")}`);
      for (const id of ids) rows.splice(rows.findIndex((r) => r.id === id), 1);
    },
  };
}

const seed = (): BaseRow[] => [
  { id: "1", values: { f_id: "1", f_title: "Write spec", f_due: "2026-10-20", f_done: false, f_cost: "12.5000", f_tags: ["red"] } },
  { id: "2", values: { f_id: "2", f_title: "Book venue", f_due: null, f_done: true, f_cost: null, f_tags: null } },
];

function find(rt: AppRuntime, name: string) {
  for (const s of rt.app.screens) {
    for (const c of s.controls) {
      if (c.name === name) return { control: c, where: { screenId: s.id } };
      for (const ch of c.children ?? []) if (ch.name === name) return { control: ch, where: { screenId: s.id }, parent: c };
    }
  }
  throw new Error(`no ${name}`);
}

async function started(app = fromTable(source)) {
  const base = memoryBase(seed());
  const rt = new AppRuntime(checkApp(JSON.parse(JSON.stringify(app))), base, { user: { email: "pat@example.com", name: "Pat" } });
  await rt.start();
  return { rt, base };
}

describe("a generated app", () => {
  it("passes the model checks and loads its data", async () => {
    const { rt } = await started();
    expect(rt.app.screens.map((s) => s.name)).toEqual(["BrowseScreen1", "DetailScreen1", "EditScreen1"]);
    const g = find(rt, "BrowseGallery1");
    const items = rt.galleryItems(g.control, g.where);
    expect(items.map((r) => r.Title)).toEqual(["Book venue", "Write spec"]);
    expect(items[1]["Due Date"]).toEqual(new Date(2026, 9, 20));
    expect(items[1].Cost).toBe(12.5);
    expect(items[1].Tags).toEqual([{ Value: "red" }]);
    expect(rt.errors.size).toBe(0);
  });

  it("searches as you type", async () => {
    const { rt } = await started();
    const box = find(rt, "SearchBox1");
    rt.setInput(box.control, box.where, "spec");
    const g = find(rt, "BrowseGallery1");
    expect(rt.galleryItems(g.control, g.where).map((r) => r.Title)).toEqual(["Write spec"]);
  });

  it("shows a record, edits it and saves", async () => {
    const { rt, base } = await started();
    const g = find(rt, "BrowseGallery1");
    const items = rt.galleryItems(g.control, g.where);
    rt.selectItem(g.control, items[1]);
    await rt.run(g.control, "OnSelect", { screenId: g.where.screenId, item: { galleryId: g.control.id, record: items[1], key: "x" } });
    expect(rt.screen().name).toBe("DetailScreen1");
    const title = find(rt, "Title1");
    expect(rt.prop(title.control, "Text", { screenId: g.where.screenId, item: { galleryId: g.control.id, record: items[1], key: "x" } })).toBe("Write spec");

    await rt.run(find(rt, "EditButton1").control, "OnSelect", find(rt, "EditButton1").where);
    expect(rt.screen().name).toBe("EditScreen1");
    const form = find(rt, "EditForm1");
    expect(rt.formValue(form.control, form.where, "Title")).toBe("Write spec");
    rt.setFormValue(form.control, "Title", "Write the spec");
    rt.setFormValue(form.control, "Done", true);
    await rt.run(find(rt, "SaveButton1").control, "OnSelect", find(rt, "SaveButton1").where);
    expect(base.calls).toContain(`update 1 {"f_title":"Write the spec","f_done":true}`);
    expect(rt.screen().name).toBe("DetailScreen1");
    expect(rt.toasts.map((t) => t.message)).toEqual(["Saved"]);
    expect(rt.galleryItems(g.control, g.where).map((r) => r.Title)).toEqual(["Book venue", "Write the spec"]);
  });

  it("adds a new record and refuses a missing required field", async () => {
    const { rt, base } = await started();
    const newBtn = find(rt, "NewButton1");
    await rt.run(newBtn.control, "OnSelect", newBtn.where);
    expect(rt.screen().name).toBe("EditScreen1");
    const form = find(rt, "EditForm1");
    expect(rt.formMode(form.control, form.where)).toBe("New");
    const save = find(rt, "SaveButton1");
    await rt.run(save.control, "OnSelect", save.where);
    expect(rt.formError(form.control)).toBe("Title is required");
    expect(rt.screen().name).toBe("EditScreen1");

    rt.setFormValue(form.control, "Title", "Hire band");
    rt.setFormValue(form.control, "Due Date", new Date(2026, 11, 1));
    rt.setFormValue(form.control, "Tags", [{ Value: "blue" }]);
    await rt.run(save.control, "OnSelect", save.where);
    expect(base.calls.at(-1)).toBe(`create {"f_title":"Hire band","f_due":"2026-12-01","f_done":null,"f_cost":null,"f_tags":["blue"]}`);
    expect(base.rows).toHaveLength(3);
    expect(rt.screen().name).toBe("BrowseScreen1");
  });

  it("deletes the selected record", async () => {
    const { rt, base } = await started();
    const g = find(rt, "BrowseGallery1");
    rt.selectItem(g.control, rt.galleryItems(g.control, g.where)[0]);
    rt.navigate(new FxObject("screen", "DetailScreen1", () => null), "None", null);
    const del = find(rt, "DeleteButton1");
    await rt.run(del.control, "OnSelect", del.where);
    expect(base.calls.at(-1)).toBe("remove 2");
    expect(rt.screen().name).toBe("BrowseScreen1");
    expect(rt.galleryItems(g.control, g.where)).toHaveLength(1);
  });
});

describe("state", () => {
  const app = () => {
    const a = fromTable(source);
    a.onStart = `Set(greeting, "Hi " & User().FullName); ClearCollect(Cart, {Item: "Pen", Qty: 2}, {Item: "Ink", Qty: 1})`;
    a.screens[0].controls.push(
      { id: "l1", name: "Greeting", type: "label", props: { Text: `greeting & " (" & Sum(Cart, Qty) & ")"` } },
      { id: "b1", name: "AddPen", type: "button", props: { OnSelect: `Patch(Cart, LookUp(Cart, Item = "Pen"), {Qty: LookUp(Cart, Item = "Pen").Qty + 1}); UpdateContext({clicks: Coalesce(clicks, 0) + 1})` } },
      { id: "l2", name: "Clicks", type: "label", props: { Text: `"Clicks: " & clicks` } },
      { id: "l3", name: "Broken", type: "label", props: { Text: `NoSuchThing + 1` } },
    );
    return a;
  };

  it("runs OnStart, collections and context variables", async () => {
    const { rt } = await started(app());
    expect(rt.toasts).toEqual([]);
    const greeting = find(rt, "Greeting");
    expect(rt.prop(greeting.control, "Text", greeting.where)).toBe("Hi Pat (3)");
    const btn = find(rt, "AddPen");
    await rt.run(btn.control, "OnSelect", btn.where);
    await rt.run(btn.control, "OnSelect", btn.where);
    expect(rt.prop(greeting.control, "Text", greeting.where)).toBe("Hi Pat (5)");
    const clicks = find(rt, "Clicks");
    expect(rt.prop(clicks.control, "Text", clicks.where)).toBe("Clicks: 2");
  });

  it("notes formula errors per property", async () => {
    const { rt } = await started(app());
    const broken = find(rt, "Broken");
    expect(rt.prop(broken.control, "Text", broken.where)).toBe(null);
    expect(rt.errors.get(`${broken.control.id}.Text`)).toBe("Nothing is called NoSuchThing");
  });

  it("keeps typed text until the default changes", async () => {
    const a = fromTable(source);
    a.screens[0].controls.push(
      { id: "t1", name: "Box", type: "textinput", props: { Default: `BrowseGallery1.Selected.Title` } },
    );
    const { rt } = await started(a);
    const box = find(rt, "Box");
    expect(rt.output(box.control, "Text", box.where)).toBe("Book venue");
    rt.setInput(box.control, box.where, "typed");
    expect(rt.output(box.control, "Text", box.where)).toBe("typed");
    const g = find(rt, "BrowseGallery1");
    rt.selectItem(g.control, rt.galleryItems(g.control, g.where)[1]);
    expect(rt.output(box.control, "Text", box.where)).toBe("Write spec");
  });

  it("says which errors stop a behavior formula", async () => {
    const { rt } = await started(app());
    await rt.runFormula(`Set(Greeting, 1)`, { screenId: rt.screenId });
    expect(rt.toasts.at(-1)?.message).toBe("Greeting is already the name of something in this app");
    await rt.runFormula(`Launch("javascript:alert(1)")`, { screenId: rt.screenId });
    expect(rt.toasts.at(-1)?.message).toMatch(/only opens https/);
    expect((rt.resolve("Cart") as Rec[]).length).toBe(2);
  });
});
