import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsToKeep } from "../lib/sheet-tools.ts";
import { bodyToText, textToBody } from "../lib/sheet-comments.ts";

test("remove duplicates keeps the first of each, comparing chosen columns", () => {
  const rows = [
    ["Name", "City", "Qty"],
    ["Ann", "Oslo", 1],
    ["ann ", "Oslo", 2],
    ["Bob", "Rome", 1],
    ["Ann", "Paris", 1],
    ["Bob", "Rome", 1],
    [null, "", null],
    ["", null, ""],
  ];
  assert.deepEqual(rowsToKeep(rows, [0, 1, 2], true), [0, 1, 2, 3, 4, 6]);
  assert.deepEqual(rowsToKeep(rows, [0, 1], true), [0, 1, 3, 4, 6], "case and spaces don't make text different");
  assert.deepEqual(rowsToKeep(rows, [0], false), [0, 1, 3, 6]);
});

test("comment bodies convert between Univer documents and plain text", () => {
  assert.deepEqual(textToBody("one\ntwo"), { dataStream: "one\rtwo\r\n", paragraphs: [{ startIndex: 3 }, { startIndex: 7 }], sectionBreaks: [{ startIndex: 8 }] });
  assert.equal(bodyToText({ dataStream: "one\rtwo\r\n" }), "one\ntwo");
});

test("current region grows to the surrounding empty rows and columns", async () => {
  const { currentRegion } = await import("../lib/sheet-tools.ts");
  const grid: Record<string, unknown> = { "1,1": "h1", "1,2": "h2", "2,1": 1, "3,2": 2, "4,1": 3, "6,1": "far" };
  assert.deepEqual(currentRegion((r, c) => grid[`${r},${c}`], 2, 1), { startRow: 1, endRow: 4, startColumn: 1, endColumn: 2 });
  assert.deepEqual(currentRegion((r, c) => grid[`${r},${c}`], 8, 8), { startRow: 8, endRow: 8, startColumn: 8, endColumn: 8 });
});
