/**
 * Catalog, records and CSV import against a real Postgres (TEST_DATABASE_URL). Every database
 * made here is deleted again, which drops its schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("databases on Postgres", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let imp: typeof import("@/lib/import");
  let pg: typeof import("@/lib/db");
  const owner = "owner@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    imp = await import("@/lib/import");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  async function newDb(name = "Test") {
    const d = await cat.createDatabase(owner, { name });
    made.push(d.id);
    return d;
  }

  it("makes a database in its own schema, visible only to its members", async () => {
    const d = await newDb("Contacts");
    expect(d.role).toBe("owner");
    expect((await cat.listDatabases(owner)).map((x) => x.id)).toContain(d.id);
    expect(await cat.getDatabase(d.id, "stranger@example.com")).toBeNull();
    const { rows: s } = await pg.db().q("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [`db_${d.id}`]);
    expect(s).toHaveLength(1);
    await expect(cat.listTables(d.id, "stranger@example.com")).rejects.toMatchObject({ status: 404 });
  });

  it("creates tables with an ID and Title, and keeps names unique", async () => {
    const d = await newDb();
    const t = await cat.createTable(d.id, owner, { name: "Customers" });
    expect(t.fields.map((f) => [f.name, f.type])).toEqual([["ID", "autonumber"], ["Title", "text"]]);
    await expect(cat.createTable(d.id, owner, { name: "customers" })).rejects.toMatchObject({ code: "23505" });
    await expect(cat.createTable(d.id, owner, { name: "X", fields: [{ name: "A", type: "text" }, { name: "a", type: "number" }] })).rejects.toThrow(/two fields/);
  });

  it("adds, changes, filters, sorts and deletes records", async () => {
    const d = await newDb();
    const t0 = await cat.createTable(d.id, owner, {
      name: "Orders",
      fields: [
        { name: "Customer", type: "text", required: true },
        { name: "Amount", type: "currency" },
        { name: "Shipped", type: "yesno", options: { defaultValue: "no" } },
        { name: "Tags", type: "multichoice", options: { choices: ["Rush", "Gift"] } },
        { name: "Ordered", type: "date" },
      ],
    });
    const [id, cust, amt, shipped, tags, ordered] = t0.fields.map((f) => f.id);
    const t = await cat.getTable(t0.id, owner);
    const added = await rows.insertRows(t, owner, [
      { [cust]: "Ada", [amt]: "$120.50", [tags]: ["Rush"], [ordered]: "10/1/2026" },
      { [cust]: "Bob", [amt]: "15", [shipped]: true, [ordered]: "2026-09-12" },
      { [cust]: "cy", [amt]: "99.999" },
    ]);
    expect(added[0].values[id]).toBe(added[0].id);
    expect(added[0].values[amt]).toBe("120.5000");
    expect(added[0].values[shipped]).toBe(false);
    expect(added[0].values[ordered]).toBe("2026-10-01");
    expect(added[0].values[tags]).toEqual(["Rush"]);
    await expect(rows.insertRows(t, owner, [{ [amt]: "1" }])).rejects.toThrow(/Customer is required/);

    const sorted = await rows.listRows(t, { sort: [{ field: cust, dir: "asc" }] });
    expect(sorted.rows.map((r) => r.values[cust])).toEqual(["Ada", "Bob", "cy"]);
    expect(sorted.rows.map((r) => r.id)).toEqual(added.map((r) => r.id));
    const big = await rows.listRows(t, { filter: { match: "all", conditions: [{ field: amt, op: "gt", value: "50" }] } });
    expect(big.total).toBe(2);
    const rush = await rows.listRows(t, { filter: { match: "all", conditions: [{ field: tags, op: "contains", value: "Rush" }] } });
    expect(rush.rows.map((r) => r.values[cust])).toEqual(["Ada"]);
    expect((await rows.listRows(t, { search: "bo" })).total).toBe(1);
    expect((await rows.listRows(t, { limit: 1, offset: 1 })).rows).toHaveLength(1);

    const changed = await rows.updateRow(t, "editor@example.com", added[2].id, { [cust]: "Cy" });
    expect(changed.values[cust]).toBe("Cy");
    await expect(rows.updateRow(t, owner, added[2].id, { [cust]: "" })).rejects.toThrow(/required/);
    await expect(rows.updateRow(t, owner, "999999", { [cust]: "Z" })).rejects.toMatchObject({ status: 404 });
    expect(await rows.deleteRows(t, [added[1].id])).toBe(1);
    expect((await rows.listRows(t)).total).toBe(2);
  });

  it("enforces no-duplicates indexes", async () => {
    const d = await newDb();
    const t0 = await cat.createTable(d.id, owner, { name: "People", fields: [{ name: "Email", type: "email", options: { unique: true } }] });
    const t = await cat.getTable(t0.id, owner);
    const email = t0.fields[1].id;
    await rows.insertRows(t, owner, [{ [email]: "a@b.co" }]);
    await expect(rows.insertRows(t, owner, [{ [email]: "a@b.co" }])).rejects.toMatchObject({ code: "23505" });
  });

  it("changes data types in place, refusing values that can't convert", async () => {
    const d = await newDb();
    const t0 = await cat.createTable(d.id, owner, { name: "T", fields: [{ name: "Qty", type: "text" }, { name: "Color", type: "text" }] });
    const [, qty, color] = t0.fields.map((f) => f.id);
    let t = await cat.getTable(t0.id, owner);
    await rows.insertRows(t, owner, [{ [qty]: "5", [color]: "Red" }, { [qty]: " 7 ", [color]: "Blue" }]);
    await cat.updateField(t.id, qty, owner, { type: "number" });
    const c = await cat.updateField(t.id, color, owner, { type: "choice" });
    expect(c.options.choices?.sort()).toEqual(["Blue", "Red"]);
    t = await cat.getTable(t0.id, owner);
    const list = await rows.listRows(t, { sort: [{ field: qty, dir: "desc" }] });
    expect(list.rows.map((r) => r.values[qty])).toEqual(["7", "5"]);

    await rows.insertRows(t, owner, [{ [color]: "Red" }]);
    await cat.updateField(t.id, qty, owner, { type: "text" });
    t = await cat.getTable(t0.id, owner);
    await rows.insertRows(t, owner, [{ [qty]: "lots" }]);
    await expect(cat.updateField(t.id, qty, owner, { type: "number" })).rejects.toMatchObject({ code: "22P02" });
    expect((await cat.getTable(t0.id, owner)).fields[1].type).toBe("text");
    await expect(cat.updateField(t.id, qty, owner, { required: true })).rejects.toThrow(/record/);
  });

  it("deletes fields and tables, but never the ID", async () => {
    const d = await newDb();
    const t = await cat.createTable(d.id, owner, { name: "T" });
    await expect(cat.deleteField(t.id, t.fields[0].id, owner)).rejects.toThrow(/ID/);
    await cat.deleteField(t.id, t.fields[1].id, owner);
    expect((await cat.getTable(t.id, owner)).fields).toHaveLength(1);
    await cat.deleteTable(t.id, owner);
    expect(await cat.listTables(d.id, owner)).toHaveLength(0);
  });

  it("imports a CSV as a new table with inferred types", async () => {
    const d = await newDb();
    const csv = "Name,Joined,Score,Active,Zip\nAda,2026-01-02,10.5,yes,02134\nBob,2026-02-03,7,no,10001\n";
    const { table, imported } = await imp.importCsv(d.id, owner, { name: "Members", csv });
    expect(imported).toBe(2);
    expect(table.fields.map((f) => f.type)).toEqual(["autonumber", "text", "date", "number", "yesno", "text"]);
    const t = await cat.getTable(table.id, owner);
    const list = await rows.listRows(t);
    expect(list.rows[0].values[table.fields[5].id]).toBe("02134");
    expect(list.rows[1].values[table.fields[4].id]).toBe(false);
  });

  it("keeps viewers to reading", async () => {
    const d = await newDb();
    const t0 = await cat.createTable(d.id, owner, { name: "T" });
    await pg.db().q("INSERT INTO base_members (database_id, email, role) VALUES ($1, 'viewer@example.com', 'viewer')", [d.id]);
    const t = await cat.getTable(t0.id, "viewer@example.com");
    expect((await rows.listRows(t)).total).toBe(0);
    await expect(rows.insertRows(t, "viewer@example.com", [{}])).rejects.toMatchObject({ status: 403 });
    await expect(cat.addField(t0.id, "viewer@example.com", { name: "X", type: "text" })).rejects.toMatchObject({ status: 403 });
    await expect(cat.deleteDatabase(d.id, "viewer@example.com")).rejects.toMatchObject({ status: 403 });
  });
});
