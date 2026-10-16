import { describe, expect, it } from "vitest";
import { convertBrackets, fixKeywordCalls, prepareSql, type SqlScope } from "@/lib/sql";
import { criteriaSql, designSql, cleanDef, type DesignTable } from "@/lib/designer";
import type { Field } from "@/lib/fields";

const scope: SqlScope = {
  views: new Map([
    ["Customers", ["ID", "Name", "City"]],
    ["Orders", ["ID", "Item", "Amount", "Customer", "Order Date"]],
  ]),
  queries: new Map([
    ["Big orders", `SELECT * FROM "Orders" WHERE "Amount" > 100`],
    ["Loop A", `SELECT * FROM "Loop B"`],
    ["Loop B", `SELECT * FROM "Loop A"`],
  ]),
};

const ok = (sql: string) => prepareSql(sql, scope);
const refused = (sql: string) => expect(() => prepareSql(sql, scope)).toThrow();

describe("prepareSql", () => {
  it("accepts a select over the views and matches names regardless of case", () => {
    const out = ok(`select name, city from customers where name ilike 'a%' order by name`);
    expect(out).toContain(`"Name"`);
    expect(out).toContain(`"Customers"`);
    expect(out).toContain(`"City"`);
  });

  it("accepts Access [brackets], joins, aggregates, CTEs and unions", () => {
    ok(`SELECT [Customers].[Name], sum([Amount]) AS [Total] FROM [Customers] JOIN [Orders] ON [Orders].[Customer] = [Customers].[ID] GROUP BY 1`);
    ok(`WITH t AS (SELECT "City", count(*) n FROM "Customers" GROUP BY 1) SELECT * FROM t WHERE n > 1`);
    ok(`SELECT "Name" FROM "Customers" UNION SELECT "Item" FROM "Orders"`);
    ok(`SELECT date_trunc('month', "Order Date") m, round(avg("Amount"), 2) FROM "Orders" GROUP BY 1`);
    ok(`SELECT "Item", row_number() over (order by "Amount" desc) FROM "Orders"`);
    ok(`SELECT * FROM generate_series(1, 3) g`);
    ok(`SELECT "Amount"::numeric(10,2), cast("Order Date" as text), current_date FROM "Orders"`);
  });

  it("inlines saved queries as CTEs and refuses cycles", () => {
    const out = ok(`select item from [Big orders]`);
    expect(out).toMatch(/^WITH "Big orders" AS \(/);
    expect(out).toContain(`"Item"`);
    expect(() => ok(`select * from "Loop A"`)).toThrow(/reads itself/);
  });

  it("refuses anything that writes, or reads outside the database", () => {
    refused(`DELETE FROM "Customers"`);
    refused(`UPDATE "Customers" SET "Name" = 'x'`);
    refused(`DROP TABLE "Customers"`);
    refused(`SELECT 1; DELETE FROM "Customers"`);
    refused(`WITH x AS (DELETE FROM "Customers" RETURNING *) SELECT * FROM x`);
    refused(`SELECT * FROM pg_user`);
    refused(`SELECT * FROM pg_catalog.pg_user`);
    refused(`SELECT * FROM public.base_members`);
    refused(`SELECT * FROM base_members`);
    refused(`SELECT * FROM db_abc.t_abc`);
    refused(`SELECT pg_sleep(10)`);
    refused(`SELECT pg_read_file('/etc/passwd')`);
    refused(`SELECT set_config('search_path', 'public', true)`);
    refused(`SELECT current_user`);
    refused(`SELECT 'base_members'::regclass`);
    refused(`SELECT pg_catalog.lower("Name") FROM "Customers"`);
    refused(`SELECT $1`);
    refused(`SELECT * FROM "Nope"`);
    refused(`SELECT * FROM lower('x')`);
    refused(`SELECT (SELECT count(*) FROM pg_stat_activity)`);
    refused(`SELECT * FROM "Customers" WHERE EXISTS (SELECT 1 FROM base_queries)`);
  });
});

describe("helpers", () => {
  it("converts [names] but not subscripts or strings", () => {
    expect(convertBrackets(`select [Order Date], x[1], "Tags"[2], '[a]' from [Orders]`)).toBe(`select "Order Date", x[1], "Tags"[2], '[a]' from "Orders"`);
    expect(convertBrackets(`select ARRAY[1,2], [E-mail], "Tags"[n + 1] from x JOIN [Order Lines]`)).toBe(`select ARRAY[1,2], "E-mail", "Tags"[n + 1] from x JOIN "Order Lines"`);
  });

  it("prints ANY and ALL as keywords outside strings", () => {
    expect(fixKeywordCalls(`x = "any" (y) AND 'say "any" (' = z`)).toBe(`x = ANY (y) AND 'say "any" (' = z`);
    expect(fixKeywordCalls(`ON (b .id = ("any" (f(a .l, ')')) ) )`)).toBe(`ON (b .id = ANY (f(a .l, ')'))  )`);
  });
});

const f = (id: string, name: string, type: Field["type"], options: Field["options"] = {}): Field => ({
  id, name, pgName: id === "cid" || id === "oid" ? "id" : `f_${id}`, type, options, required: false, description: "", position: 0,
});

const tables: DesignTable[] = [
  { id: "c", name: "Customers", fields: [f("cid", "ID", "autonumber"), f("cn", "Name", "text"), f("cc", "City", "text")] },
  {
    id: "o",
    name: "Orders",
    fields: [f("oid", "ID", "autonumber"), f("oi", "Item", "text"), f("oa", "Amount", "currency"), f("ocu", "Customer", "lookup", { targetTable: "c" }), f("od", "Order Date", "date"), f("op", "Paid", "yesno")],
  },
];

describe("designer", () => {
  it("joins tables along lookups and builds select, where and order", () => {
    const sql = designSql(
      cleanDef({
        tables: ["c", "o"],
        columns: [
          { table: "c", field: "cn", sort: "asc" },
          { table: "o", field: "oi" },
          { table: "o", field: "oa", criteria: [">100"] },
        ],
      }),
      tables,
    );
    expect(sql).toBe(
      `SELECT "Customers"."Name", "Orders"."Item", "Orders"."Amount"\nFROM "Customers" JOIN "Orders" ON "Orders"."Customer" = "Customers"."ID"\nWHERE "Orders"."Amount" > 100\nORDER BY "Customers"."Name" ASC`,
    );
    expect(() => prepareSql(sql, scope)).not.toThrow();
  });

  it("keeps all records of one side when asked (Access join properties 2 and 3)", () => {
    const def = { tables: ["c", "o"], columns: [{ table: "c", field: "cn" }] };
    expect(designSql(cleanDef({ ...def, joins: { ocu: "one" } }), tables)).toContain(`"Customers" LEFT JOIN "Orders"`);
    expect(designSql(cleanDef({ ...def, joins: { ocu: "many" } }), tables)).toContain(`"Customers" RIGHT JOIN "Orders"`);
  });

  it("groups and totals, with criteria on totals going to HAVING", () => {
    const sql = designSql(
      cleanDef({
        tables: ["o"],
        totals: true,
        columns: [
          { table: "o", field: "ocu" },
          { table: "o", field: "oa", total: "sum", criteria: [">=500"], sort: "desc" },
          { table: "o", field: "op", total: "where", criteria: ["Yes"] },
        ],
      }),
      tables,
    );
    expect(sql).toBe(
      `SELECT "Orders"."Customer", sum("Orders"."Amount") AS "SumOfAmount"\nFROM "Orders"\nWHERE "Orders"."Paid" = true\nGROUP BY "Orders"."Customer"\nHAVING sum("Orders"."Amount") >= 500\nORDER BY sum("Orders"."Amount") DESC`,
    );
    expect(() => prepareSql(sql, scope)).not.toThrow();
  });

  it("ORs criteria rows and accepts expressions", () => {
    const sql = designSql(
      cleanDef({
        tables: ["c"],
        columns: [
          { table: "c", field: "cn", criteria: ['Like "A*"', ""] },
          { table: "c", field: "cc", criteria: ["", '"Leeds"'] },
          { expression: "upper([Name])", alias: "Shout" },
        ],
        limit: 10,
      }),
      tables,
    );
    expect(sql).toContain(`WHERE ("Customers"."Name"::text ILIKE 'A%') OR (lower("Customers"."City") = lower('Leeds'))`);
    expect(sql).toContain(`(upper([Name])) AS "Shout"`);
    expect(sql).toMatch(/LIMIT 10$/);
    expect(prepareSql(sql, scope)).toMatch(/upper \("Name"\)/);
  });

  it("refuses tables that aren't related", () => {
    const loose: DesignTable[] = [...tables, { id: "x", name: "Notes", fields: [f("xid", "ID", "autonumber")] }];
    expect(() => designSql(cleanDef({ tables: ["c", "x"], columns: [{ table: "c", field: "cn" }] }), loose)).toThrow(/isn't related/);
  });
});

describe("criteria", () => {
  const text = f("t", "Name", "text");
  const num = f("n", "Amount", "number");
  const date = f("d", "When", "date");
  it("reads Access criteria", () => {
    expect(criteriaSql("Smith", "x", text)).toBe("lower(x) = lower('Smith')");
    expect(criteriaSql('"O\'Neil"', "x", text)).toBe("lower(x) = lower('O''Neil')");
    expect(criteriaSql(">5 And <10", "x", num)).toBe("(x > 5 AND x < 10)");
    expect(criteriaSql("Between #1/2/2026# And #2026-03-31#", "x", date)).toBe("x BETWEEN '2026-01-02' AND '2026-03-31'");
    expect(criteriaSql("Is Null", "x", text)).toBe("x IS NULL");
    expect(criteriaSql("Is Not Null", "x", text)).toBe("x IS NOT NULL");
    expect(criteriaSql('In ("a", "b")', "x", text)).toBe("lower(x) IN (lower('a'), lower('b'))");
    expect(criteriaSql('Not "a"', "x", text)).toBe("lower(x) <> lower('a')");
    expect(criteriaSql('Like "50%*"', "x", text)).toBe("x::text ILIKE '50\\%%'");
    expect(criteriaSql("<Date()", "x", date)).toBe("x < current_date");
    expect(criteriaSql("-3 Or 7", "x", num)).toBe("(x = -3 OR x = 7)");
    expect(() => criteriaSql('"open', "x", text)).toThrow(/quote/);
    expect(() => criteriaSql("#nope#", "x", date)).toThrow(/isn't a date/);
    expect(() => criteriaSql("x; drop", "x", text)).toThrow();
  });
});
