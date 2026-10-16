import { test } from "node:test";
import assert from "node:assert/strict";
import { computePivot, fieldItems, fieldNames } from "../lib/pivot.ts";

const table = [
  ["Region", "Rep", "Year", "Sales", "Units"],
  ["East", "Ann", 2024, 100, 1],
  ["East", "Bob", 2024, 50, 2],
  ["East", "Ann", 2025, 25, 3],
  ["West", "Cid", 2024, 10, 4],
  ["West", "Cid", 2025, "n/a", 5],
  [null, "Dee", 2025, 5, 6],
  [null, null, null, null, null],
];

const base = { columns: [], filters: [], values: [{ field: "Sales", agg: "sum" as const }] };

test("one row field: sums per item and a grand total", () => {
  const g = computePivot(table, { ...base, rows: ["Region"] });
  assert.deepEqual(g.cells, [
    ["Region", "Sum of Sales"],
    ["East", 175],
    ["West", 10],
    ["(blank)", 5],
    ["Grand Total", 190],
  ]);
  assert.deepEqual(g.boldRows, [0, 4]);
});

test("two row fields get subtotals; outer labels appear once per block", () => {
  const g = computePivot(table, { ...base, rows: ["Region", "Rep"] });
  assert.deepEqual(g.cells, [
    ["Region", "Rep", "Sum of Sales"],
    ["East", "Ann", 125],
    [null, "Bob", 50],
    ["East Total", null, 175],
    ["West", "Cid", 10],
    ["West Total", null, 10],
    ["(blank)", "Dee", 5],
    ["(blank) Total", null, 5],
    ["Grand Total", null, 190],
  ]);
});

test("column fields spread values across, with grand total column", () => {
  const g = computePivot(table, { ...base, rows: ["Region"], columns: ["Year"] });
  assert.deepEqual(g.cells, [
    ["Sum of Sales", "Year", null, null],
    ["Region", 2024, 2025, "Grand Total"],
    ["East", 150, 25, 175],
    ["West", 10, null, 10],
    ["(blank)", null, 5, 5],
    ["Grand Total", 160, 30, 190],
  ]);
  assert.equal(g.headerRows, 2);
  assert.deepEqual(g.boldColumns, [3]);
});

test("several values, other aggregations, and filters", () => {
  const g = computePivot(table, {
    rows: ["Region"],
    columns: [],
    values: [{ field: "Sales", agg: "count" }, { field: "Units", agg: "average" }, { field: "Sales", agg: "max" }],
    filters: [{ field: "Region", exclude: ["(blank)"] }],
  });
  assert.deepEqual(g.cells, [
    ["Region", "Count of Sales", "Average of Units", "Max of Sales"],
    ["East", 3, 2, 100],
    ["West", 2, 4.5, 10],
    ["Grand Total", 5, 3, 100],
  ]);
});

test("no row fields: a single total row", () => {
  const g = computePivot(table, { ...base, rows: [], columns: ["Year"] });
  assert.deepEqual(g.cells.at(-1), [null, 160, 30, 190]);
});

test("field names are unique and items sorted with blanks last", () => {
  assert.deepEqual(fieldNames(["A", "", "A", null]), ["A", "Column 2", "A 2", "Column 4"]);
  assert.deepEqual(fieldItems(table, "Region"), ["East", "West", "(blank)"]);
  assert.deepEqual(fieldItems([["n"], [10], [9], [100]], "n"), ["9", "10", "100"]);
});
