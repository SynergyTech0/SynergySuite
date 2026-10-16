// Spreadsheet versions: the stored form, the preview grid and the comparison with now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { columnName, decodeWorkbook, encodeWorkbook, previewGrid, versionDiff } from "../lib/sheet-versions.ts";
import type { UniverWorkbook } from "../lib/xlsx.ts";

const book = (cells: Record<number, Record<number, any>>, extra: Record<string, any> = {}): UniverWorkbook =>
  ({
    id: "wb",
    name: "Book",
    appVersion: "",
    locale: "enUS",
    sheetOrder: ["a", ...Object.keys(extra)],
    styles: { pct: { n: { pattern: "0%" } } },
    sheets: { a: { id: "a", name: "Data", cellData: cells }, ...extra },
    resources: [],
  }) as any;

test("a version is the workbook as prefixed JSON, and nothing else decodes as one", () => {
  const b = book({ 0: { 0: { v: "x", t: 1 } } });
  const text = encodeWorkbook(b);
  assert.ok(text.startsWith("synergy-workbook:v1:"));
  assert.deepEqual(decodeWorkbook(text), b);
  assert.equal(decodeWorkbook("<p>a document</p>"), null);
  assert.equal(decodeWorkbook("synergy-deck:v1:{}"), null);
  assert.equal(decodeWorkbook("synergy-workbook:v1:{\"sheets\":{}}"), null, "no sheet order");
});

test("the preview shows the cells as the grid would, trimmed to what is used", () => {
  const g = previewGrid(book({ 0: { 0: { v: "Region", t: 1 }, 1: { v: 0.25, t: 2, s: "pct" } }, 11: { 6: { v: 3, t: 2 } } }), "a");
  assert.equal(g.rows.length, 12);
  assert.equal(g.columns.length, 7);
  assert.deepEqual(g.cells[0].slice(0, 2), ["Region", "25%"]);
  assert.equal(g.cells[11][6], "3");
  assert.deepEqual(g.more, { rows: false, columns: false });
  assert.deepEqual(previewGrid(book({ 99: { 30: { v: 1, t: 2 } } }), "a").more, { rows: true, columns: true });
  assert.equal(columnName(0), "A");
  assert.equal(columnName(27), "AB");
});

test("a version is compared with now by cells and sheets", () => {
  const before = book({ 0: { 0: { v: 1, t: 2 }, 1: { v: 2, t: 2 } } });
  const after = book({ 0: { 0: { v: 1, t: 2 }, 1: { v: 5, t: 2 } }, 1: { 0: { f: "=A1", v: 1 } } }, { b: { id: "b", name: "New", cellData: {} } });
  assert.deepEqual(versionDiff(before, after), { sheetsAdded: ["New"], sheetsRemoved: [], cellsChanged: 2 });
});
