/**
 * Readable views and queries against a real Postgres (TEST_DATABASE_URL): the views follow design
 * changes, queries run read only inside their database, and saved queries read each other.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("queries", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let qs: typeof import("@/lib/queries");
  let pg: typeof import("@/lib/db");
  const owner = "q-owner@example.com";
  const viewer = "q-viewer@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    qs = await import("@/lib/queries");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  async function shop() {
    const d = await cat.createDatabase(owner, { name: "Shop" });
    made.push(d.id);
    const customers = await cat.createTable(d.id, owner, { name: "Customers", fields: [{ name: "Name", type: "text" }, { name: "City", type: "text" }] });
    const orders = await cat.createTable(d.id, owner, {
      name: "Orders",
      fields: [
        { name: "Item", type: "text" },
        { name: "Amount", type: "currency" },
        { name: "Customer", type: "lookup", options: { targetTable: customers.id } },
      ],
    });
    const C = await cat.getTable(customers.id, owner);
    const O = await cat.getTable(orders.id, owner);
    const [name, city] = [customers.fields[1].id, customers.fields[2].id];
    const [item, amount, cust] = [orders.fields[1].id, orders.fields[2].id, orders.fields[3].id];
    const [ada, bob] = await rows.insertRows(C, owner, [{ [name]: "Ada", [city]: "Leeds" }, { [name]: "Bob", [city]: "York" }]);
    await rows.insertRows(O, owner, [
      { [item]: "Lamp", [amount]: "40", [cust]: ada.id },
      { [item]: "Desk", [amount]: "250", [cust]: ada.id },
      { [item]: "Chair", [amount]: "120", [cust]: bob.id },
    ]);
    return { d, customers, orders, name, city, item, amount, cust };
  }

  const run = (databaseId: string, sql: string, email = owner) => qs.runQuery(databaseId, email, { kind: "sql", sql });

  it("runs SQL over readable views, with names in any case", async () => {
    const s = await shop();
    const r = await run(s.d.id, `select c.name, sum(o.amount) as total from customers c join orders o on o.customer = c.id group by 1 order by 2 desc`);
    expect(r.columns).toEqual([
      { name: "Name", kind: "text" },
      { name: "total", kind: "number" },
    ]);
    expect(r.rows).toEqual([
      ["Ada", "290.0000"],
      ["Bob", "120.0000"],
    ]);
    expect(r.truncated).toBe(false);
  });

  it("keeps the views in step with renames, type changes and deletions", async () => {
    const s = await shop();
    await cat.updateTable(s.customers.id, owner, { name: "Clients" });
    await cat.updateField(s.customers.id, s.city, owner, { name: "Town" });
    expect((await run(s.d.id, `select [Town] from [Clients] order by 1`)).rows).toEqual([["Leeds"], ["York"]]);
    await expect(run(s.d.id, `select * from customers`)).rejects.toThrow(/no table or query called customers/);
    // A type change and a dropped column go through while a view reads the table.
    await cat.updateField(s.orders.id, s.item, owner, { type: "longtext" });
    await cat.deleteField(s.customers.id, s.city, owner);
    const added = await cat.addField(s.customers.id, owner, { name: "Email", type: "email" });
    expect((await run(s.d.id, `select * from clients order by id`)).columns.map((c) => c.name)).toEqual(["ID", "Name", "Email"]);
    await cat.deleteField(s.customers.id, added.id, owner);
    await cat.deleteField(s.orders.id, s.cust, owner);
    await cat.deleteTable(s.customers.id, owner);
    const { rows: left } = await pg.db().q(`SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY 1`, [`db_${s.d.id}`]);
    expect(left.map((r) => r.table_name)).toEqual(["Orders"]);
  });

  it("refuses to look outside the database and runs read only", async () => {
    const s = await shop();
    await expect(run(s.d.id, `select * from base_members`)).rejects.toThrow(/no table or query/);
    await expect(run(s.d.id, `delete from orders`)).rejects.toThrow(/only read/);
    const { rows: other } = await pg.db().q(`SELECT 1`);
    expect(other).toHaveLength(1);
    // Even raw SQL handed to the runner can't write: the transaction is READ ONLY.
    const c = await pg.db().pool.connect();
    try {
      const { runPrepared } = await import("@/lib/sql");
      await expect(runPrepared(c, `db_${s.d.id}`, `SELECT * FROM "Orders" FOR UPDATE`)).rejects.toThrow();
      expect((await c.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      c.release();
    }
  });

  it("reads a table named like a system table from the database itself", async () => {
    const s = await shop();
    const t = await cat.createTable(s.d.id, owner, { name: "pg_user", fields: [{ name: "usename", type: "text" }] });
    await rows.insertRows(await cat.getTable(t.id, owner), owner, [{ [t.fields[1].id]: "mine" }]);
    expect((await run(s.d.id, `select usename from pg_user`)).rows).toEqual([["mine"]]);
  });

  it("caps rows and stops long queries", async () => {
    const s = await shop();
    const r = await run(s.d.id, `select g from generate_series(1, 5000) g`);
    expect(r.rows).toHaveLength(qs.MAX_RESULT_ROWS);
    expect(r.truncated).toBe(true);
    await expect(qs.runQuery(s.d.id, owner, { kind: "sql", sql: `select count(*) from generate_series(1, 100000000) a` }, { timeoutMs: 200 })).rejects.toMatchObject({ status: 408 });
  });

  it("saves design and SQL queries that read each other", async () => {
    const s = await shop();
    const big = await qs.createQuery(s.d.id, owner, {
      name: "Big orders",
      kind: "design",
      definition: { tables: [s.orders.id, s.customers.id], columns: [{ table: s.customers.id, field: s.name }, { table: s.orders.id, field: s.item }, { table: s.orders.id, field: s.amount, criteria: [">=100"], sort: "desc" }] },
    });
    expect(big.sql).toContain(`JOIN "Customers" ON "Orders"."Customer" = "Customers"."ID"`);
    const byName = await qs.createQuery(s.d.id, owner, { name: "Big by customer", kind: "sql", sql: `select name, count(*) n from [big orders] group by name order by name;` });
    const r = await qs.runQuery(s.d.id, owner, { queryId: byName.id });
    expect(r.rows).toEqual([
      ["Ada", "1"],
      ["Bob", "1"],
    ]);
    // A design query follows renamed tables and fields.
    await cat.updateField(s.customers.id, s.name, owner, { name: "Full name" });
    await cat.updateTable(s.orders.id, owner, { name: "Sales" });
    expect((await qs.runQuery(s.d.id, owner, { queryId: big.id })).columns.map((c) => c.name)).toEqual(["Full name", "Item", "Amount"]);
    await cat.updateField(s.customers.id, s.name, owner, { name: "Name" });
    // A query can't read itself, directly or round about.
    await expect(qs.updateQuery(big.id, owner, { kind: "sql", sql: `select * from "Big by customer"` })).rejects.toThrow(/reads itself/);
    // Names are unique among tables and queries.
    await expect(qs.createQuery(s.d.id, owner, { name: "sales", kind: "sql", sql: "select 1" })).rejects.toThrow(/table called/);
    await expect(qs.createQuery(s.d.id, owner, { name: "BIG ORDERS", kind: "sql", sql: "select 1" })).rejects.toThrow();
    // Saving checks the SQL.
    await expect(qs.createQuery(s.d.id, owner, { name: "Bad", kind: "sql", sql: "select * from pg_user" })).rejects.toMatchObject({ status: 400 });
    // A blank design query can be saved and filled in later.
    const blank = await qs.createQuery(s.d.id, owner, { name: "Query1", kind: "design" });
    expect(blank.sql).toBe("");
    expect((await qs.listQueries(s.d.id, owner)).map((q) => q.name)).toEqual(["Big orders", "Big by customer", "Query1"]);
    await qs.deleteQuery(blank.id, owner);
  });

  it("lets viewers run queries but not change them", async () => {
    const s = await shop();
    await pg.db().q(`INSERT INTO base_members (database_id, email, role) VALUES ($1, $2, 'viewer')`, [s.d.id, viewer]);
    const q = await qs.createQuery(s.d.id, owner, { name: "Cities", kind: "sql", sql: `select distinct city from customers order by 1` });
    expect((await qs.runQuery(s.d.id, viewer, { queryId: q.id })).rows).toEqual([["Leeds"], ["York"]]);
    await expect(qs.updateQuery(q.id, viewer, { sql: "select 1" })).rejects.toMatchObject({ status: 403 });
    await expect(qs.createQuery(s.d.id, viewer, { name: "Mine", kind: "sql", sql: "select 1" })).rejects.toMatchObject({ status: 403 });
    await expect(qs.runQuery(s.d.id, "stranger@example.com", { queryId: q.id })).rejects.toMatchObject({ status: 404 });
  });

  it("passes Postgres's own words on for mistakes in a query", async () => {
    const s = await shop();
    await expect(run(s.d.id, `select nope from customers`)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/column "nope" does not exist/) });
    await expect(run(s.d.id, `select 1/0`)).rejects.toMatchObject({ status: 400 });
  });

  it("makes views for databases created before views existed", async () => {
    const s = await shop();
    await pg.db().q(`DROP VIEW ${`"db_${s.d.id}"`}."Orders"`);
    expect((await run(s.d.id, `select count(*) from orders`)).rows).toEqual([["3"]]);
  });
});
