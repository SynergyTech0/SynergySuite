/**
 * Reports: laying records out in groups with totals (pure), and against a real Postgres
 * (TEST_DATABASE_URL) saving reports and running them over tables and queries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReport, cleanReportLayout, formatValue, type SourceColumn } from "@/lib/reportLayout";

const source: SourceColumn[] = [
  { name: "ID", kind: "number" },
  { name: "Customer", kind: "text" },
  { name: "Item", kind: "text" },
  { name: "Amount", kind: "number", format: "currency" },
  { name: "Ordered", kind: "date", format: "date" },
];
const rows = [
  ["1", "Ada", "Lamp", "40.0000", "2026-01-05"],
  ["2", "Ada", "Desk", "250.0000", "2026-02-10"],
  ["3", "Bob", "Chair", "120.0000", "2026-02-11"],
  ["4", null, "Rug", "300.0000", "2026-03-15"],
];

describe("report layout", () => {
  it("lists every column with no layout, formatted by type", () => {
    const r = buildReport("Orders", source, rows, cleanReportLayout({}));
    expect(r.title).toBe("Orders");
    expect(r.columns.map((c) => c.label)).toEqual(["ID", "Customer", "Item", "Amount", "Ordered"]);
    expect(r.body.rows![0]).toEqual(["1", "Ada", "Lamp", "$40.00", "1/5/2026"]);
    expect(r.body.totals.every((t) => t === null)).toBe(true);
  });

  it("groups by value with totals per group and for the report, blanks last", () => {
    const layout = cleanReportLayout({
      title: "Sales",
      columns: [{ name: "customer" }, { name: "Item", label: "What" }, { name: "Amount", total: "sum" }, { name: "Nope" }],
      groups: [{ column: "Customer" }],
      sort: [{ column: "Amount", dir: "desc" }],
    });
    const r = buildReport("Orders", source, rows, layout);
    expect(r.missing).toEqual(["Nope"]);
    // The grouped column is in the heading, not on each record.
    expect(r.columns.map((c) => c.label)).toEqual(["What", "Amount"]);
    expect(r.levels).toEqual([{ label: "Customer", totals: true }]);
    expect(r.body.groups!.map((g) => [g.label, g.count, g.totals[1]])).toEqual([
      ["Ada", 2, "$290.00"],
      ["Bob", 1, "$120.00"],
      ["(Blank)", 1, "$300.00"],
    ]);
    expect(r.body.groups![0].rows).toEqual([
      ["Desk", "$250.00"],
      ["Lamp", "$40.00"],
    ]);
    expect(r.body.totals[1]).toBe("$710.00");
  });

  it("groups dates by month and text by first letter, nested, with other totals", () => {
    const r = buildReport(
      "Orders",
      source,
      rows,
      cleanReportLayout({
        columns: [{ name: "Item", total: "count" }, { name: "Amount", total: "avg" }, { name: "Ordered", total: "max" }],
        groups: [{ column: "Ordered", by: "month", dir: "desc" }, { column: "Item", by: "letter" }],
      }),
    );
    expect(r.body.groups!.map((g) => g.label)).toEqual(["March 2026", "February 2026", "January 2026"]);
    const feb = r.body.groups![1];
    expect(feb.groups!.map((g) => g.label)).toEqual(["C", "D"]);
    expect(feb.totals).toEqual(["2", "$185.00", "2/11/2026"]);
    expect(r.body.totals).toEqual(["4", "$177.50", "3/15/2026"]);
  });

  it("can show only the totals", () => {
    const r = buildReport("Orders", source, rows, cleanReportLayout({ columns: [{ name: "Amount", total: "sum" }], groups: [{ column: "Customer", totals: false }], summaryOnly: true }));
    expect(r.body.groups!.every((g) => g.rows === undefined)).toBe(true);
    expect(r.levels[0].totals).toBe(false);
  });

  it("formats values for reading", () => {
    expect(formatValue("0.125", "number", "percent")).toBe("12.5%");
    expect(formatValue("1234.5", "number", "whole")).toBe("1,235");
    expect(formatValue("12", "number", "currency", "EUR")).toBe("€12.00");
    expect(formatValue(true, "yesno", "auto")).toBe("Yes");
    expect(formatValue(["a", "b"], "list", "auto")).toBe("a; b");
    expect(formatValue(null, "text", "auto")).toBe("");
  });

  it("keeps only the known parts of a layout", () => {
    expect(cleanReportLayout({ columns: [{ name: "A", total: "median", format: "auto" }, { name: "A" }], groups: Array(9).fill({ column: "A", by: "week" }), landscape: "yes" })).toEqual({
      title: undefined,
      columns: [{ name: "A", label: undefined, format: undefined, total: undefined }],
      groups: Array(4).fill({ column: "A", by: undefined, dir: undefined, totals: undefined }),
      sort: [],
      landscape: false,
      summaryOnly: false,
      currencyCode: undefined,
    });
  });
});

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("reports", () => {
  let cat: typeof import("@/lib/catalog");
  let rowsLib: typeof import("@/lib/rows");
  let qs: typeof import("@/lib/queries");
  let rp: typeof import("@/lib/reports");
  let pg: typeof import("@/lib/db");
  const owner = "r-owner@example.com";
  const viewer = "r-viewer@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rowsLib = await import("@/lib/rows");
    qs = await import("@/lib/queries");
    rp = await import("@/lib/reports");
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
        { name: "Ordered", type: "date" },
      ],
    });
    const C = await cat.getTable(customers.id, owner);
    const O = await cat.getTable(orders.id, owner);
    const [ada, bob] = await rowsLib.insertRows(C, owner, [{ [customers.fields[1].id]: "Ada", [customers.fields[2].id]: "Leeds" }, { [customers.fields[1].id]: "Bob", [customers.fields[2].id]: "York" }]);
    const [item, amount, cust, when] = orders.fields.slice(1).map((f) => f.id);
    await rowsLib.insertRows(O, owner, [
      { [item]: "Lamp", [amount]: "40", [cust]: ada.id, [when]: "2026-01-05" },
      { [item]: "Desk", [amount]: "250", [cust]: ada.id, [when]: "2026-02-10" },
      { [item]: "Chair", [amount]: "120", [cust]: bob.id, [when]: "2026-02-11" },
    ]);
    return { d, customers, orders };
  }

  it("runs a report over a table, showing lookups by their related record", async () => {
    const s = await shop();
    const r = await rp.createReport(s.d.id, owner, {
      name: "Sales by customer",
      source: { kind: "table", id: s.orders.id },
      layout: { columns: [{ name: "Item" }, { name: "Amount", total: "sum" }, { name: "Ordered" }], groups: [{ column: "Customer" }], sort: [{ column: "Item" }] },
    });
    const data = await rp.runReport(r.id, owner);
    expect(data.source.map((c) => c.name)).toEqual(["ID", "Item", "Amount", "Customer", "Ordered"]);
    expect(data.body.groups!.map((g) => [g.label, g.totals[1]])).toEqual([
      ["Ada", "$290.00"],
      ["Bob", "$120.00"],
    ]);
    expect(data.body.groups![0].rows).toEqual([
      ["Desk", "$250.00", "2/10/2026"],
      ["Lamp", "$40.00", "1/5/2026"],
    ]);
    expect(data.body.totals[1]).toBe("$410.00");
    // An unsaved layout previews without saving.
    const preview = await rp.runReport(r.id, owner, { columns: [{ name: "Item" }] });
    expect(preview.body.rows).toHaveLength(3);
    expect((await rp.getReport(r.id, owner)).layout.groups).toHaveLength(1);
  });

  it("runs a report over a saved query and follows renames", async () => {
    const s = await shop();
    const q = await qs.createQuery(s.d.id, owner, { name: "Big", kind: "sql", sql: `select c.name as who, o.amount from orders o join customers c on c.id = o.customer where o.amount >= 100` });
    const r = await rp.createReport(s.d.id, owner, { name: "Big orders", source: { kind: "query", id: q.id }, layout: { columns: [{ name: "who" }, { name: "amount", format: "currency", total: "sum" }] } });
    expect((await rp.runReport(r.id, owner)).body.totals[1]).toBe("$370.00");
    await qs.updateQuery(q.id, owner, { name: "Large" });
    expect((await rp.runReport(r.id, owner)).body.count).toBe(2);
    await qs.deleteQuery(q.id, owner);
    await expect(rp.runReport(r.id, owner)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/query this report shows was deleted/) });
  });

  it("checks names, sources and roles", async () => {
    const s = await shop();
    await pg.db().q(`INSERT INTO base_members (database_id, email, role) VALUES ($1, $2, 'viewer')`, [s.d.id, viewer]);
    const r = await rp.createReport(s.d.id, owner, { name: "Orders", source: { kind: "table", id: s.orders.id } });
    await expect(rp.createReport(s.d.id, owner, { name: "orders", source: { kind: "table", id: s.orders.id } })).rejects.toThrow(/already a report/);
    await expect(rp.createReport(s.d.id, owner, { name: "X", source: { kind: "table", id: "nope" } })).rejects.toThrow(/Pick the table/);
    expect((await rp.runReport(r.id, viewer)).body.count).toBe(3);
    await expect(rp.updateReport(r.id, viewer, { name: "Mine" })).rejects.toMatchObject({ status: 403 });
    await expect(rp.runReport(r.id, "stranger@example.com")).rejects.toMatchObject({ status: 404 });
    const other = await cat.createDatabase(owner, { name: "Other" });
    made.push(other.id);
    await expect(rp.createReport(other.id, owner, { name: "Theirs", source: { kind: "table", id: s.orders.id } })).rejects.toThrow(/Pick the table/);
    await cat.deleteField(s.orders.id, s.orders.fields[3].id, owner);
    await cat.deleteTable(s.customers.id, owner);
    await cat.deleteTable(s.orders.id, owner);
    await expect(rp.runReport(r.id, owner)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/table this report shows was deleted/) });
    expect((await rp.listReports(s.d.id, owner)).map((x) => x.name)).toEqual(["Orders"]);
    await rp.deleteReport(r.id, owner);
    expect(await rp.listReports(s.d.id, owner)).toEqual([]);
  });
});
