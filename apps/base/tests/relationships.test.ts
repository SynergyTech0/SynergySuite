/**
 * Lookup fields against a real Postgres (TEST_DATABASE_URL): foreign keys, labels, delete rules,
 * and the guards around tables that others look up.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("relationships", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let pg: typeof import("@/lib/db");
  const owner = "rel-owner@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  /** Customers (Name) and Orders (Item, Customer -> Customers). */
  async function shop(onDelete: "restrict" | "cascade" | "setnull" = "restrict") {
    const d = await cat.createDatabase(owner, { name: "Shop" });
    made.push(d.id);
    const customers = await cat.createTable(d.id, owner, { name: "Customers", fields: [{ name: "Name", type: "text" }] });
    const orders = await cat.createTable(d.id, owner, {
      name: "Orders",
      fields: [
        { name: "Item", type: "text" },
        { name: "Customer", type: "lookup", options: { targetTable: customers.id, onDelete } },
      ],
    });
    const name = customers.fields[1].id;
    const [item, cust] = [orders.fields[1].id, orders.fields[2].id];
    const C = await cat.getTable(customers.id, owner);
    const O = await cat.getTable(orders.id, owner);
    const [ada, bob] = await rows.insertRows(C, owner, [{ [name]: "Ada" }, { [name]: "Bob" }]);
    return { d, customers, orders, name, item, cust, C, O, ada, bob };
  }

  it("shows the related record's display field and defaults it to the first field", async () => {
    const s = await shop();
    expect(s.orders.fields[2].options).toMatchObject({ targetTable: s.customers.id, displayField: s.name, onDelete: "restrict" });
    const [o] = await rows.insertRows(s.O, owner, [{ [s.item]: "Lamp", [s.cust]: s.ada.id }]);
    expect(o.values[s.cust]).toBe(s.ada.id);
    expect(o.labels?.[s.cust]).toBe("Ada");
    const changed = await rows.updateRow(s.O, owner, o.id, { [s.cust]: { id: s.bob.id } });
    expect(changed.labels?.[s.cust]).toBe("Bob");
  });

  it("refuses records that point at nothing", async () => {
    const s = await shop();
    await expect(rows.insertRows(s.O, owner, [{ [s.cust]: "999999" }])).rejects.toMatchObject({ code: "23503" });
    await expect(rows.insertRows(s.O, owner, [{ [s.cust]: "Ada" }])).rejects.toThrow(/related record/);
  });

  it("filters, sorts and searches on the related record's label", async () => {
    const s = await shop();
    await rows.insertRows(s.O, owner, [
      { [s.item]: "Lamp", [s.cust]: s.bob.id },
      { [s.item]: "Desk", [s.cust]: s.ada.id },
      { [s.item]: "Pen" },
    ]);
    const sorted = await rows.listRows(s.O, { sort: [{ field: s.cust, dir: "asc" }] });
    expect(sorted.rows.map((r) => r.values[s.item])).toEqual(["Desk", "Lamp", "Pen"]);
    expect((await rows.listRows(s.O, { filter: { match: "all", conditions: [{ field: s.cust, op: "eq", value: s.ada.id }] } })).total).toBe(1);
    expect((await rows.listRows(s.O, { filter: { match: "all", conditions: [{ field: s.cust, op: "contains", value: "bo" }] } })).total).toBe(1);
    expect((await rows.listRows(s.O, { filter: { match: "all", conditions: [{ field: s.cust, op: "empty" }] } })).total).toBe(1);
    expect((await rows.listRows(s.O, { search: "ada" })).total).toBe(1);
    const picks = await rows.lookupChoices(s.O, s.orders.fields[2], "b");
    expect(picks).toEqual([{ id: s.bob.id, label: "Bob" }]);
  });

  it("enforces the delete rule: restrict, cascade or set to blank", async () => {
    const r = await shop("restrict");
    await rows.insertRows(r.O, owner, [{ [r.cust]: r.ada.id }]);
    await expect(rows.deleteRows(r.C, [r.ada.id])).rejects.toMatchObject({ code: "23503" });

    const c = await shop("cascade");
    await rows.insertRows(c.O, owner, [{ [c.cust]: c.ada.id }, { [c.cust]: c.bob.id }]);
    await rows.deleteRows(c.C, [c.ada.id]);
    expect((await rows.listRows(c.O)).total).toBe(1);

    const n = await shop("setnull");
    const [o] = await rows.insertRows(n.O, owner, [{ [n.cust]: n.ada.id }]);
    await rows.deleteRows(n.C, [n.ada.id]);
    expect((await rows.listRows(n.O)).rows.find((x) => x.id === o.id)?.values[n.cust]).toBeNull();
  });

  it("changes the delete rule and display field in place", async () => {
    const s = await shop("restrict");
    await rows.insertRows(s.O, owner, [{ [s.cust]: s.ada.id }]);
    await cat.updateField(s.orders.id, s.cust, owner, { options: { targetTable: s.customers.id, onDelete: "cascade", displayField: s.customers.fields[0].id } });
    const O = await cat.getTable(s.orders.id, owner);
    expect((await rows.listRows(O)).rows[0].labels?.[s.cust]).toBe(s.ada.id);
    await rows.deleteRows(s.C, [s.ada.id]);
    expect((await rows.listRows(O)).total).toBe(0);
    await expect(cat.updateField(s.orders.id, s.cust, owner, { options: { targetTable: s.orders.id } })).rejects.toThrow(/keeps the table/);
  });

  it("turns a Number field of IDs into a lookup, and refuses one with dangling IDs", async () => {
    const s = await shop();
    const f = await cat.addField(s.orders.id, owner, { name: "Buyer", type: "number" });
    let O = await cat.getTable(s.orders.id, owner);
    await rows.insertRows(O, owner, [{ [f.id]: s.bob.id }]);
    const lk = await cat.updateField(s.orders.id, f.id, owner, { type: "lookup", options: { targetTable: s.customers.id } });
    expect(lk.type).toBe("lookup");
    O = await cat.getTable(s.orders.id, owner);
    expect((await rows.listRows(O)).rows[0].labels?.[f.id]).toBe("Bob");

    const g = await cat.addField(s.orders.id, owner, { name: "Other", type: "number" });
    O = await cat.getTable(s.orders.id, owner);
    await rows.insertRows(O, owner, [{ [g.id]: "424242" }]);
    await expect(cat.updateField(s.orders.id, g.id, owner, { type: "lookup", options: { targetTable: s.customers.id } })).rejects.toMatchObject({ code: "23503" });
    const t = await cat.addField(s.orders.id, owner, { name: "Note", type: "text" });
    await expect(cat.updateField(s.orders.id, t.id, owner, { type: "lookup", options: { targetTable: s.customers.id } })).rejects.toThrow(/Number field/);
  });

  it("won't delete a table others look up, and only links tables in the same database", async () => {
    const s = await shop();
    await expect(cat.deleteTable(s.customers.id, owner)).rejects.toThrow(/Orders\.Customer/);
    expect((await cat.relationsTo(s.customers.id)).map((r) => r.fieldName)).toEqual(["Customer"]);
    const other = await shop();
    await expect(cat.addField(s.orders.id, owner, { name: "X", type: "lookup", options: { targetTable: other.customers.id } })).rejects.toThrow(/isn't in this database/);
    await cat.deleteField(s.orders.id, s.cust, owner);
    await cat.deleteTable(s.customers.id, owner);
  });

  it("allows a table to look up itself", async () => {
    const d = await cat.createDatabase(owner, { name: "Staff" });
    made.push(d.id);
    const e = await cat.createTable(d.id, owner, { name: "Employees", fields: [{ name: "Name", type: "text" }] });
    const mgr = await cat.addField(e.id, owner, { name: "Manager", type: "lookup", options: { targetTable: e.id } });
    const E = await cat.getTable(e.id, owner);
    const [boss] = await rows.insertRows(E, owner, [{ [e.fields[1].id]: "Grace" }]);
    const [emp] = await rows.insertRows(E, owner, [{ [e.fields[1].id]: "Alan", [mgr.id]: boss.id }]);
    expect(emp.labels?.[mgr.id]).toBe("Grace");
    await cat.deleteTable(e.id, owner);
  });
});
