/**
 * Access import against a real Postgres (TEST_DATABASE_URL), using the small shop database in
 * tests/fixtures in both the .accdb and the older .mdb format.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));

suite("access import", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let access: typeof import("@/lib/access");
  let qs: typeof import("@/lib/queries");
  let pg: typeof import("@/lib/db");
  const owner = "access-owner@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    access = await import("@/lib/access");
    qs = await import("@/lib/queries");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  async function fresh() {
    const d = await cat.createDatabase(owner, { name: "Imported" });
    made.push(d.id);
    return d;
  }

  for (const file of ["shop.accdb", "shop.mdb"]) {
    it(`imports tables, types, records and relationships from ${file}`, async () => {
      const d = await fresh();
      const r = await access.importAccess(d.id, owner, fixture(file));
      expect(r.tables.map((t) => t.name).sort()).toEqual(["Customers", "Orders", "Products"]);
      expect(r.records).toBe(4 + 2 + 3);
      const byName = Object.fromEntries(r.tables.map((t) => [t.name, t]));
      const types = (t: string) => Object.fromEntries(byName[t].fields.map((f) => [f.name, f.type]));
      expect(types("Customers")).toEqual({
        CustomerID: "autonumber", Name: "text", City: "text", Code: "text", Joined: "date", VIP: "yesno", Notes: "longtext", "Referred By": "lookup",
      });
      expect(types("Orders")).toEqual({
        OrderID: "autonumber", Customer: "lookup", SKU: "text", Amount: "currency", Qty: "number", Weight: "number", Ordered: "datetime", Ref: "text",
      });
      // No AutoNumber: Base adds one.
      expect(types("Products")).toEqual({ ID: "autonumber", SKU: "text", Title: "text", Price: "currency" });

      // AutoNumber values are kept, gaps included, and new records carry on after them.
      const C = await cat.getTable(byName.Customers.id, owner);
      const f = (t: typeof C, name: string) => t.fields.find((x) => x.name === name)!.id;
      const list = await rows.listRows(C, { sort: [{ field: f(C, "CustomerID"), dir: "asc" }] } as never);
      expect(list.rows.map((x) => x.id)).toEqual(["1", "2", "3", "10"]);
      const ada = list.rows[0].values;
      expect(ada[f(C, "Code")]).toBe("00123");
      expect(ada[f(C, "Joined")]).toBe("2024-03-01");
      expect(ada[f(C, "VIP")]).toBe(true);
      expect(list.rows[1].values[f(C, "Name")]).toBe('Bob "The" Builder');
      expect(list.rows[2].values[f(C, "Notes")]).toBe("Line one\nLine two");
      expect(list.rows[1].labels?.[f(C, "Referred By")]).toBe("Ada Lovelace");
      const [added] = await rows.insertRows(C, owner, [{ [f(C, "Name")]: "Eve" }]);
      expect(added.id).toBe("11");

      // Delete rules follow Access: deleting a customer deletes their orders and empties "Referred By".
      const O = await cat.getTable(byName.Orders.id, owner);
      expect(O.fields.find((x) => x.name === "Customer")!.options).toMatchObject({ targetTable: C.id, onDelete: "cascade" });
      expect(C.fields.find((x) => x.name === "Referred By")!.options).toMatchObject({ targetTable: C.id, onDelete: "setnull" });
      await rows.deleteRows(C, ["1"]);
      expect((await rows.listRows(O, {} as never)).rows.map((x) => x.id)).toEqual(["3"]);
      expect((await rows.listRows(C, {} as never)).rows.find((x) => x.id === "2")!.values[f(C, "Referred By")]).toBeNull();

      // Values come through exactly, and queries can read them.
      const q = await qs.runQuery(d.id, owner, { kind: "sql", sql: `select "Amount", "Qty", "Weight", "Ordered", "Ref" from orders` });
      expect(q.rows).toEqual([["79.9800", "2", "2.5", "2026-03-01T17:45:00.000Z", null]]);

      expect(r.notes.join("\n")).toMatch(/Orders\.Photo \(OLE object\) wasn't imported/);
      expect(r.notes.join("\n")).toMatch(/Orders\.SKU → Products\.SKU wasn't kept/);
    });
  }

  it("names tables apart from those already in the database, and imports again cleanly", async () => {
    const d = await fresh();
    await cat.createTable(d.id, owner, { name: "Orders" });
    const r = await access.importAccess(d.id, owner, fixture("shop.accdb"));
    expect(r.tables.map((t) => t.name).sort()).toEqual(["Customers", "Orders 2", "Products"]);
    const again = await access.importAccess(d.id, owner, fixture("shop.mdb"));
    expect(again.tables.map((t) => t.name).sort()).toEqual(["Customers 2", "Orders 3", "Products 2"]);
    const orders3 = again.tables.find((t) => t.name === "Orders 3")!;
    expect(orders3.fields.find((x) => x.name === "Customer")!.options.targetTable).toBe(again.tables.find((t) => t.name === "Customers 2")!.id);
  });

  it("keeps the AutoNumber of a table with attachments, and says what was left out", async () => {
    const d = await fresh();
    const r = await access.importAccess(d.id, owner, fixture("attachments.accdb"));
    expect(r.tables[0].fields.map((f) => [f.name, f.type])).toEqual([["ID", "autonumber"], ["Comment", "text"]]);
    expect(r.notes).toEqual([expect.stringMatching(/Table1\.Attachments \(attachments or multi-value\) wasn't imported/)]);
  });

  it("refuses files that aren't Access databases and leaves nothing behind", async () => {
    const d = await fresh();
    await expect(access.importAccess(d.id, owner, Buffer.from("not a database at all".repeat(200)))).rejects.toMatchObject({ status: 400 });
    expect(await cat.listTables(d.id, owner)).toEqual([]);
  });

  it("only lets editors import", async () => {
    const d = await fresh();
    await pg.db().q(`INSERT INTO base_members (database_id, email, role) VALUES ($1, 'access-viewer@example.com', 'viewer')`, [d.id]);
    await expect(access.importAccess(d.id, "access-viewer@example.com", fixture("shop.accdb"))).rejects.toMatchObject({ status: 403 });
    expect(await cat.listTables(d.id, owner)).toEqual([]);
  });
});
