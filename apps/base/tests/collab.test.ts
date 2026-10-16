/**
 * Comments on records and data links for Sheets, against a real Postgres (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

async function text(s: ReadableStream<Uint8Array> | string): Promise<string> {
  return typeof s === "string" ? s : new Response(s).text();
}

suite("comments and data links", () => {
  let cat: typeof import("@/lib/catalog");
  let rowsLib: typeof import("@/lib/rows");
  let cm: typeof import("@/lib/comments");
  let dl: typeof import("@/lib/dataLinks");
  let ex: typeof import("@/lib/exportCsv");
  let qs: typeof import("@/lib/queries");
  let sh: typeof import("@/lib/sharing");
  let pg: typeof import("@/lib/db");
  const owner = "c-owner@example.com";
  const ed = "c-editor@example.com";
  const viewer = "c-viewer@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cat = await import("@/lib/catalog");
    rowsLib = await import("@/lib/rows");
    cm = await import("@/lib/comments");
    dl = await import("@/lib/dataLinks");
    ex = await import("@/lib/exportCsv");
    qs = await import("@/lib/queries");
    sh = await import("@/lib/sharing");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  async function people() {
    const d = await cat.createDatabase(owner, { name: "People" });
    made.push(d.id);
    await sh.shareDatabase(d.id, owner, { email: ed, role: "editor" });
    await sh.shareDatabase(d.id, owner, { email: viewer, role: "viewer" });
    const t = await cat.createTable(d.id, owner, { name: "People", fields: [{ name: "Name", type: "text" }, { name: "Age", type: "number" }] });
    const T = await cat.getTable(t.id, owner);
    const rows = await rowsLib.insertRows(T, owner, [{ [t.fields[1].id]: "Ada", [t.fields[2].id]: "36" }, { [t.fields[1].id]: "Bob, Jr.", [t.fields[2].id]: "41" }]);
    return { d, t, T, rows };
  }

  it("keeps comments on a record, for editors to add and authors or owners to delete", async () => {
    const { t, T, rows } = await people();
    expect(await cm.listComments(t.id, rows[0].id, viewer)).toEqual([]);
    await cm.addComment(t.id, rows[0].id, ed, "  Check the age  ");
    const list = await cm.addComment(t.id, rows[0].id, owner, "Done");
    expect(list.map((c) => [c.author, c.body, c.canDelete])).toEqual([
      [ed, "Check the age", true],
      [owner, "Done", true],
    ]);
    expect((await cm.listComments(t.id, rows[0].id, ed)).map((c) => c.canDelete)).toEqual([true, false]);
    expect(await cm.listComments(t.id, rows[1].id, owner)).toEqual([]);
    await expect(cm.addComment(t.id, rows[0].id, viewer, "Hi")).rejects.toMatchObject({ status: 403 });
    await expect(cm.addComment(t.id, rows[0].id, ed, "   ")).rejects.toThrow(/Write a comment/);
    await expect(cm.addComment(t.id, rows[0].id, ed, "x".repeat(4001))).rejects.toThrow(/up to 4,000/);
    await expect(cm.addComment(t.id, "999999", ed, "Nobody")).rejects.toMatchObject({ status: 404 });
    await expect(cm.listComments(t.id, rows[0].id, "stranger@example.com")).rejects.toMatchObject({ status: 404 });
    await expect(cm.deleteComment(list[1].id, ed)).rejects.toMatchObject({ status: 403 });
    await cm.deleteComment(list[0].id, owner);
    expect((await cm.listComments(t.id, rows[0].id, owner)).map((c) => c.body)).toEqual(["Done"]);
    // Deleting the record takes its comments.
    await rowsLib.deleteRows(T, [rows[0].id]);
    expect((await pg.db().q(`SELECT 1 FROM base_comments WHERE table_id = $1`, [t.id])).rows).toHaveLength(0);
  });

  it("reads a table or query through a data link until it's turned off", async () => {
    const { d, t } = await people();
    const source = { kind: "table", id: t.id };
    expect(await dl.getLink(d.id, viewer, source)).toBeNull();
    await expect(dl.makeLink(d.id, viewer, source)).rejects.toMatchObject({ status: 403 });
    await expect(dl.makeLink(d.id, ed, { kind: "table", id: "nope" })).rejects.toThrow(/Pick the table/);
    const link = await dl.makeLink(d.id, ed, source);
    expect(link.path).toMatch(/^\/api\/feed\/[A-Za-z0-9_-]{32}\.csv$/);
    expect((await dl.makeLink(d.id, owner, source)).token).toBe(link.token);
    expect((await dl.getLink(d.id, viewer, source))?.createdBy).toBe(ed);

    const r = await dl.resolveLink(link.token);
    expect(r.kind).toBe("table");
    const csv = await text(ex.tableCsv((r as { table: Awaited<ReturnType<typeof cat.getTable>> }).table));
    expect(csv.replace(/^﻿/, "").trim().split(/\r?\n/)).toEqual(["ID,Name,Age", "1,Ada,36", '2,"Bob, Jr.",41']);

    const q = await qs.createQuery(d.id, owner, { name: "Older", kind: "sql", sql: "select name from people where age > 40" });
    const ql = await dl.makeLink(d.id, owner, { kind: "query", id: q.id });
    const qr = await dl.resolveLink(ql.token);
    if (qr.kind !== "query") throw new Error("expected a query");
    expect((await ex.queryCsv(qr.query, qr.email)).replace(/^﻿/, "").trim().split(/\r?\n/)).toEqual(["Name", '"Bob, Jr."']);

    // A link stops working when its maker loses access, or when it's turned off.
    await sh.unshareDatabase(d.id, owner, ed);
    await expect(dl.resolveLink(link.token)).rejects.toMatchObject({ status: 404 });
    await dl.removeLink(d.id, owner, { kind: "query", id: q.id });
    await expect(dl.resolveLink(ql.token)).rejects.toMatchObject({ status: 404 });
    await expect(dl.resolveLink("short")).rejects.toMatchObject({ status: 404 });
  });
});
