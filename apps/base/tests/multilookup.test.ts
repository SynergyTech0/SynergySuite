/**
 * Multi-value lookups against a real Postgres (TEST_DATABASE_URL): the integrity triggers that
 * stand in for a foreign key, labels in pick order, filters, queries, reports and CSV.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coerce, FieldValueError, MAX_LOOKUP_VALUES, type Field } from "@/lib/fields";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

describe("multi-value lookup values", () => {
  const f = { id: "f", name: "Tags", pgName: "f_f", type: "multilookup", options: {}, required: false, description: "", position: 1 } as Field;
  it("takes ids as a list, objects or text, without repeats", () => {
    expect(coerce(f, ["3", 7, { id: "3" }])).toEqual(["3", "7"]);
    expect(coerce(f, "3; 7")).toEqual(["3", "7"]);
    expect(coerce(f, [])).toBeNull();
    expect(coerce(f, "")).toBeNull();
    expect(() => coerce(f, ["x"])).toThrow(FieldValueError);
    expect(() => coerce(f, Array.from({ length: MAX_LOOKUP_VALUES + 1 }, (_, i) => i + 1))).toThrow(/at most/);
  });
});

suite("multi-value lookups", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let qs: typeof import("@/lib/queries");
  let rp: typeof import("@/lib/reports");
  let ex: typeof import("@/lib/exportCsv");
  let pg: typeof import("@/lib/db");
  const owner = "mlk-owner@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    qs = await import("@/lib/queries");
    rp = await import("@/lib/reports");
    ex = await import("@/lib/exportCsv");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  /** Tags (Name) and Posts (Title, Tags -> many Tags). */
  async function blog() {
    const d = await cat.createDatabase(owner, { name: "Blog" });
    made.push(d.id);
    const tags = await cat.createTable(d.id, owner, { name: "Tags", fields: [{ name: "Name", type: "text" }] });
    const posts = await cat.createTable(d.id, owner, {
      name: "Posts",
      fields: [
        { name: "Title", type: "text" },
        { name: "Tags", type: "multilookup", options: { targetTable: tags.id } },
      ],
    });
    const name = tags.fields[1].id;
    const [title, tagf] = [posts.fields[1].id, posts.fields[2].id];
    const T = await cat.getTable(tags.id, owner);
    const P = await cat.getTable(posts.id, owner);
    const [news, tech, food] = await rows.insertRows(T, owner, [{ [name]: "News" }, { [name]: "Tech" }, { [name]: "Food" }]);
    return { d, tags, posts, name, title, tagf, T, P, news, tech, food };
  }

  it("keeps related records in the order they were picked, with their labels", async () => {
    const s = await blog();
    expect(s.posts.fields[2].options).toMatchObject({ targetTable: s.tags.id, displayField: s.name });
    expect(s.posts.fields[2].options.onDelete).toBeUndefined();
    const [p] = await rows.insertRows(s.P, owner, [{ [s.title]: "Hello", [s.tagf]: [s.tech.id, s.news.id] }]);
    expect(p.values[s.tagf]).toEqual([s.tech.id, s.news.id]);
    expect(p.labels?.[s.tagf]).toBe("Tech; News");
    expect(p.items?.[s.tagf]).toEqual([
      { id: s.tech.id, label: "Tech" },
      { id: s.news.id, label: "News" },
    ]);
    const cleared = await rows.updateRow(s.P, owner, p.id, { [s.tagf]: [] });
    expect(cleared.values[s.tagf]).toBeNull();
    expect(cleared.items?.[s.tagf]).toEqual([]);
  });

  it("refuses ids that point at nothing, on insert and update", async () => {
    const s = await blog();
    await expect(rows.insertRows(s.P, owner, [{ [s.tagf]: [s.news.id, "999999"] }])).rejects.toMatchObject({ code: "23503" });
    await expect(rows.insertRows(s.P, owner, [{ [s.tagf]: [s.news.id, "999999"] }])).rejects.toThrow(/related record/);
    const [p] = await rows.insertRows(s.P, owner, [{ [s.tagf]: [s.news.id] }]);
    await expect(rows.updateRow(s.P, owner, p.id, { [s.tagf]: ["999999"] })).rejects.toMatchObject({ code: "23503" });
  });

  it("takes a deleted record off every list that holds it", async () => {
    const s = await blog();
    const [a, b] = await rows.insertRows(s.P, owner, [
      { [s.title]: "A", [s.tagf]: [s.news.id, s.tech.id, s.food.id] },
      { [s.title]: "B", [s.tagf]: [s.tech.id] },
    ]);
    expect(await rows.deleteRows(s.T, [s.tech.id])).toBe(1);
    const { rows: after } = await rows.listRows(s.P, { sort: [{ field: s.title, dir: "asc" }] });
    expect(after.map((r) => r.values[s.tagf])).toEqual([[s.news.id, s.food.id], null]);
    expect(after.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("filters on a related record or its label, and lists it as a relationship", async () => {
    const s = await blog();
    await rows.insertRows(s.P, owner, [
      { [s.title]: "A", [s.tagf]: [s.news.id, s.tech.id] },
      { [s.title]: "B", [s.tagf]: [s.food.id] },
      { [s.title]: "C" },
    ]);
    const count = async (op: string, value?: string) => (await rows.listRows(s.P, { filter: { match: "all", conditions: [{ field: s.tagf, op: op as never, value }] } })).total;
    expect(await count("eq", s.tech.id)).toBe(1);
    expect(await count("ne", s.tech.id)).toBe(2);
    expect(await count("contains", "foo")).toBe(1);
    expect(await count("notcontains", "news")).toBe(2);
    expect(await count("empty")).toBe(1);
    expect((await rows.listRows(s.P, { search: "tech" })).total).toBe(1);
    expect(await rows.lookupChoices(s.P, s.posts.fields[2], "te")).toEqual([{ id: s.tech.id, label: "Tech" }]);
    // The subdatasheet under a tag: posts that hold it.
    expect((await rows.listRows(s.P, { require: [{ field: s.tagf, op: "eq", value: s.news.id }] })).rows.map((r) => r.values[s.title])).toEqual(["A"]);
    const rels = await cat.relationsTo(s.tags.id);
    expect(rels).toEqual([{ tableId: s.posts.id, tableName: "Posts", fieldId: s.tagf, fieldName: "Tags", onDelete: "remove" }]);
  });

  it("guards the table it looks up, and drops its triggers with the field", async () => {
    const s = await blog();
    await expect(cat.deleteTable(s.tags.id, owner)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Posts\.Tags/) });
    await cat.deleteField(s.posts.id, s.tagf, owner);
    await cat.deleteTable(s.tags.id, owner);
    const { rows: fns } = await pg.db().q(`SELECT proname FROM pg_proc WHERE proname LIKE $1`, [`mlk_%_${s.tagf}`]);
    expect(fns).toEqual([]);
  });

  it("turns a single lookup into a multi-value one, keeping its values, and no other way", async () => {
    const s = await blog();
    const f = await cat.addField(s.posts.id, owner, { name: "Main tag", type: "lookup", options: { targetTable: s.tags.id } });
    const P = await cat.getTable(s.posts.id, owner);
    const [p, q] = await rows.insertRows(P, owner, [{ [f.id]: s.food.id }, {}]);
    await expect(cat.updateField(s.posts.id, f.id, owner, { type: "multilookup", options: { targetTable: s.posts.id } })).rejects.toThrow();
    const m = await cat.updateField(s.posts.id, f.id, owner, { type: "multilookup" });
    expect(m.type).toBe("multilookup");
    const P2 = await cat.getTable(s.posts.id, owner);
    const { rows: got } = await rows.listRows(P2, { sort: [{ field: P2.fields[0].id, dir: "asc" }] });
    expect(got.find((r) => r.id === p.id)?.values[f.id]).toEqual([s.food.id]);
    expect(got.find((r) => r.id === q.id)?.values[f.id]).toBeNull();
    // Its checks came with it.
    await expect(rows.updateRow(P2, owner, q.id, { [f.id]: ["999999"] })).rejects.toMatchObject({ code: "23503" });
    await expect(cat.updateField(s.posts.id, s.tagf, owner, { type: "lookup" })).rejects.toThrow();
    await expect(cat.updateField(s.posts.id, s.tagf, owner, { type: "text" })).rejects.toThrow();
  });

  it("shows in queries, the designer's joins, reports and CSV", async () => {
    const s = await blog();
    await rows.insertRows(s.P, owner, [
      { [s.title]: "A", [s.tagf]: [s.tech.id, s.news.id] },
      { [s.title]: "B", [s.tagf]: [s.news.id] },
    ]);
    const sql = await qs.runQuery(s.d.id, owner, { kind: "sql", sql: `select t.name, count(*)::int n from posts p join tags t on t.id = any(p.tags) group by t.name order by t.name` });
    expect(sql.rows).toEqual([
      ["News", 2],
      ["Tech", 1],
    ]);
    const design = await qs.runQuery(s.d.id, owner, {
      kind: "design",
      definition: {
        tables: [s.posts.id, s.tags.id],
        columns: [
          { table: s.posts.id, field: s.title, sort: "asc" },
          { table: s.tags.id, field: s.name, sort: "asc" },
        ],
      },
    });
    expect(design.rows).toEqual([
      ["A", "News"],
      ["A", "Tech"],
      ["B", "News"],
    ]);
    const r = await rp.createReport(s.d.id, owner, { name: "Posts", source: { kind: "table", id: s.posts.id }, layout: { columns: [{ name: "Title" }, { name: "Tags" }], sort: [{ column: "Title" }] } });
    expect((await rp.runReport(r.id, owner)).body.rows).toEqual([
      ["A", "Tech; News"],
      ["B", "News"],
    ]);
    const res = new Response(ex.tableCsv(s.P, { sort: [{ field: s.title, dir: "asc" }] }));
    const lines = (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lines.slice(1).map((l) => l.split(",").slice(1).join(","))).toEqual(["A,Tech; News", "B,News"]);
  });
});
