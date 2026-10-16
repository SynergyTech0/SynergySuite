// Row/column grouping: the outline model and its .xlsx round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { groupsOf, indicesToShow, innermostGroupFor, levelsFrom, runs, shiftLevels, showLevel } from "../lib/sheet-outline.ts";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";

const levels = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

test("groups are the runs of rows at or above each level", () => {
  const l = levels({ 2: 1, 3: 2, 4: 2, 5: 1, 8: 1 });
  assert.deepEqual(groupsOf(l), [
    { level: 1, start: 2, end: 5 },
    { level: 1, start: 8, end: 8 },
    { level: 2, start: 3, end: 4 },
  ]);
  assert.deepEqual(innermostGroupFor(l, 4), { level: 2, start: 3, end: 4 });
  assert.deepEqual(innermostGroupFor(l, 6), { level: 1, start: 2, end: 5 }, "the summary row belongs to its group");
});

test("grouping and ungrouping change levels within 0-7", () => {
  assert.deepEqual([...shiftLevels(levels({ 1: 7 }), 0, 2, 1)], [[0, 1], [2, 1]]);
  assert.deepEqual([...shiftLevels(levels({ 1: 1, 2: 2 }), 0, 2, -1)], [[1, 0], [2, 1]]);
});

test("expanding an outer group keeps a collapsed inner group hidden", () => {
  const l = levels({ 2: 1, 3: 2, 4: 2, 5: 1 });
  const outer = { level: 1, start: 2, end: 5 };
  assert.deepEqual(indicesToShow(l, outer, new Set([5])), [2, 5]);
  assert.deepEqual(indicesToShow(l, outer, new Set()), [2, 3, 4, 5]);
});

test("show level n hides everything at level n or deeper", () => {
  const l = levels({ 2: 1, 3: 2, 4: 2, 5: 1 });
  assert.deepEqual(showLevel(l, 2), { hide: [3, 4], show: [2, 5], collapse: [5], expand: [6] });
  assert.deepEqual(showLevel(l, 1).hide, [2, 3, 4, 5]);
  assert.deepEqual(runs([5, 1, 2, 3, 7]), [[1, 3], [5, 1], [7, 1]]);
});

test("reads grouping written by another library (openpyxl)", async () => {
  const bytes = new Uint8Array(await readFile(new URL("./fixtures/openpyxl-outline.xlsx", import.meta.url)));
  const book = await xlsxToUniver(bytes);
  const sheet = book.sheets[book.sheetOrder[0]];
  const rowLevels = levelsFrom(sheet.rowData as any);
  assert.deepEqual([...rowLevels].sort((a, b) => a[0] - b[0]), [[1, 1], [2, 1], [3, 2], [4, 2], [5, 2], [6, 1], [7, 1], [8, 1]]);
  assert.equal(sheet.rowData?.[6]?.custom?.olc, true, "row 7 is the collapsed summary");
  assert.equal(sheet.rowData?.[4]?.hd, 1);
  assert.deepEqual([...levelsFrom(sheet.columnData as any)], [[2, 1], [3, 1]]);
  assert.equal(sheet.columnData?.[4]?.custom?.olc, true);
  assert.equal(sheet.columnData?.[2]?.hd, 1);
});

test("writes levels, collapsed marks and the sheet's outline depth", async () => {
  const id = "s1";
  const book: UniverWorkbook = {
    id: "b", name: "Outline", appVersion: "", locale: "enUS", sheetOrder: [id], styles: {}, resources: [],
    sheets: {
      [id]: {
        id, name: "Data", rowCount: 100, columnCount: 26,
        cellData: { 0: { 0: { v: "x", t: 1 } } },
        // rows 2-5 grouped, 3-4 nested and collapsed (summary row 5 marked)
        rowData: { 1: { custom: { ol: 1 } }, 2: { custom: { ol: 2 }, hd: 1 }, 3: { custom: { ol: 2 }, hd: 1 }, 4: { custom: { ol: 1, olc: true } } },
        columnData: { 1: { custom: { ol: 1 }, hd: 1 }, 2: { custom: { ol: 1 }, hd: 1 }, 3: { custom: { olc: true } } },
      },
    },
  };
  const out = await univerToXlsx(book);
  const xml = await (await JSZip.loadAsync(out)).file("xl/worksheets/sheet1.xml")!.async("string");
  const rowTag = (r: number) => new RegExp(`<row\\b[^>]*\\br="${r}"[^>]*>`).exec(xml)?.[0] || "";
  assert.match(rowTag(2), /outlineLevel="1"/);
  assert.match(rowTag(3), /outlineLevel="2"/);
  assert.match(rowTag(3), /hidden="1"/);
  assert.doesNotMatch(rowTag(3), /collapsed/);
  assert.match(rowTag(5), /collapsed="1"/);
  assert.match(xml, /<sheetFormatPr\b[^>]*outlineLevelRow="2"/);
  assert.match(xml, /<sheetFormatPr\b[^>]*outlineLevelCol="1"/);
  const colTags = [...xml.matchAll(/<col\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(colTags.some((t) => /min="2"/.test(t) && /max="3"/.test(t) && /outlineLevel="1"/.test(t) && !/collapsed/.test(t)), colTags.join(" "));
  assert.ok(colTags.some((t) => /min="4"/.test(t) && /collapsed="1"/.test(t)), colTags.join(" "));

  const back = await xlsxToUniver(out);
  const s = back.sheets[back.sheetOrder[0]];
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.rowData || {}).filter(([, v]) => v.custom).map(([k, v]) => [k, v.custom])),
    { 1: { ol: 1 }, 2: { ol: 2 }, 3: { ol: 2 }, 4: { ol: 1, olc: true } },
  );
  assert.equal(s.rowData?.[2]?.hd, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.columnData || {}).filter(([, v]) => v.custom).map(([k, v]) => [k, v.custom])),
    { 1: { ol: 1 }, 2: { ol: 1 }, 3: { olc: true } },
  );
});
