// Formula references (for trace arrows) and Goal Seek.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dependentsOf, formulaAt, formulaRefs, precedentsOf, traceLevel } from "../lib/formula-refs.ts";
import { goalSeek } from "../lib/goal-seek.ts";
import { NO_TRACE, traceMore } from "../lib/sheet-what-if.ts";

const book = {
  sheetOrder: ["s1", "s2"],
  sheets: {
    s1: {
      name: "Inputs",
      cellData: {
        0: { 0: { v: 1 }, 1: { v: 2 } },
        1: { 0: { f: "=A1*2+'My Data'!$B$3", si: "x" }, 1: { si: "x" } },
        2: { 0: { f: '=SUM(A1:B2)&"C9"' }, 1: { f: "=COUNT(C:C)+SUM(2:3)+my_name" } },
      },
    },
    s2: { name: "My Data", cellData: { 2: { 1: { v: 5 } }, 4: { 0: { f: "=inputs!A1+Inputs!A3" } } } },
  },
};

test("references in a formula, with sheets, ranges, whole rows and columns", () => {
  assert.deepEqual(formulaRefs("=A1*2+'My Data'!$B$3", book, "s1"), [
    { sheetId: "s1", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    { sheetId: "s2", startRow: 2, endRow: 2, startColumn: 1, endColumn: 1 },
  ]);
  assert.deepEqual(formulaRefs('=SUM(B2:A1)&"C9"', book, "s1"), [{ sheetId: "s1", startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }], "text in quotes is not a reference");
  const [cols, rows] = formulaRefs("=COUNT(C:C)+SUM(2:3)+my_name+LOG10(4)", book, "s1");
  assert.deepEqual([cols.startColumn, cols.endColumn, cols.startRow], [2, 2, 0]);
  assert.deepEqual([rows.startRow, rows.endRow, rows.startColumn], [1, 2, 0]);
  assert.equal(formulaRefs("=[Book2]Sheet1!A1+Nowhere!B2", book, "s1").length, 0);
});

test("shared formulas are expanded for the cell that asks", () => {
  assert.equal(formulaAt(book, { sheetId: "s1", row: 1, column: 1 }), "=B1*2+'My Data'!$B$3");
  assert.deepEqual(precedentsOf(book, { sheetId: "s1", row: 1, column: 1 })[0], { sheetId: "s1", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 });
});

test("dependents are found on every sheet", () => {
  const deps = dependentsOf(book, { sheetId: "s1", row: 0, column: 0 });
  // B3's 2:3 covers rows 2-3 only, so it doesn't read A1.
  assert.deepEqual(deps, [
    { sheetId: "s1", row: 1, column: 0 },
    { sheetId: "s1", row: 2, column: 0 },
    { sheetId: "s2", row: 4, column: 0 },
  ]);
  const arrows = traceLevel(book, [{ sheetId: "s2", row: 2, column: 1 }], "dependents");
  assert.deepEqual(arrows.map((a) => a.to), [
    { sheetId: "s1", row: 1, column: 0 },
    { sheetId: "s1", row: 1, column: 1 },
  ]);
});

test("goal seek finds the input for a target", async () => {
  const r = await goalSeek((x) => x * x * 3 + 2, 50, 1);
  assert.ok(r.found);
  assert.ok(Math.abs(r.result - 50) <= 0.001);
  assert.ok(Math.abs(r.value - 4) < 0.001);
  // A loan payment: what rate gives a payment of 600 on 100000 over 360 months?
  const pmt = (rate: number) => (100000 * rate) / (1 - (1 + rate) ** -360);
  const loan = await goalSeek(async (x) => pmt(x), 600, 0.001);
  assert.ok(loan.found, JSON.stringify(loan));
  assert.ok(Math.abs(loan.value - 0.005) < 0.0001);
  // No answer: keeps the closest try and says so.
  const none = await goalSeek((x) => x * x + 1, 0, 3, { maxIterations: 40 });
  assert.equal(none.found, false);
  assert.ok(none.result < 1.01);
  // A flat start (no slope) widens its steps until it brackets the answer.
  const step = await goalSeek((x) => Math.tanh((x - 2) * 50), 0, 0);
  assert.ok(Math.abs(step.value - 2) < 0.01, JSON.stringify(step));
});

test("trace levels add one arrow per referenced range", () => {
  const b = { sheetOrder: ["s"], sheets: { s: { name: "S", cellData: { 0: { 0: { v: 1 }, 1: { f: "=A1*A1+A1" }, 2: { f: "=B1+A1" } } } } } };
  const one = traceMore(b, NO_TRACE, { sheetId: "s", row: 0, column: 2 }, "precedents");
  assert.equal(one.added, 2);
  const two = traceMore(b, one.state, { sheetId: "s", row: 0, column: 2 }, "precedents");
  assert.equal(two.added, 1, "A1 -> B1 once, though B1 reads A1 three times");
  assert.equal(traceMore(b, two.state, { sheetId: "s", row: 0, column: 2 }, "precedents").added, 0);
});
