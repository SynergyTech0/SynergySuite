// Live mail merge: formulas worked out again on the replayed Sheet (with
// Univer's formula engine), number formats and defined names replayed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replayOps, type LiveBook } from "../lib/docs/sheet-live";
import { recalcBook, hasFormulas } from "../lib/docs/sheet-recalc";
import { sheetTable } from "../lib/docs/mail-merge";
import { cellDisplayText } from "../lib/xlsx";

const base = (): LiveBook => ({
  id: "wb1",
  sheetOrder: ["s1"],
  sheets: {
    s1: {
      id: "s1",
      name: "People",
      rowCount: 100,
      columnCount: 10,
      cellData: {
        0: { 0: { v: "Name" }, 1: { v: "Qty" }, 2: { v: "Total" }, 3: { v: "Label" } },
        1: { 0: { v: "Ann" }, 1: { v: 2 }, 2: { f: "=B2*Price", v: 6 }, 3: { f: '=A2&" ("&C2&")"', v: "Ann (6)" } },
        2: { 0: { v: "Bob" }, 1: { v: 5 }, 2: { f: "=B3*Price", v: 15 }, 3: { f: '=A3&" ("&C3&")"', v: "Bob (15)" } },
      },
    },
  },
  styles: {},
  resources: [{ name: "SHEET_DEFINED_NAME_PLUGIN", data: JSON.stringify({ n1: { id: "n1", name: "Price", formulaOrRefString: "3" } }) }],
});

const table = (b: LiveBook) => sheetTable(b as never, "s1", (c) => cellDisplayText(b as never, c as never));

test("formulas are worked out again after the replayed edits, with defined names", async () => {
  const { book, unsupported } = replayOps(base(), [
    { id: "sheet.mutation.set-range-values", params: { subUnitId: "s1", cellValue: { 1: { 1: { v: 10 } } } } },
    { id: "formula.mutation.set-defined-name", params: { unitId: "wb1", id: "n1", name: "Price", formulaOrRefString: "4" } },
    { id: "sheet.mutation.set.numfmt", params: { unitId: "wb1", subUnitId: "s1", values: { p1: { ranges: [{ startRow: 1, endRow: 2, startColumn: 2, endColumn: 2 }] } }, refMap: { p1: { pattern: "0.00" } } } },
    { id: "sheets.mutation.add-hyper-link", params: {} },
    { id: "sheet.mutation.add-conditional-rule", params: {} },
  ]);
  assert.deepEqual(unsupported, []);
  assert.ok(hasFormulas(book));
  // before: the stale values the log carried
  assert.equal(table(book).records[0].Total, "6.00");
  const fresh = await recalcBook(book);
  const t = table(fresh);
  assert.equal(t.records[0].Total, "40.00");
  assert.equal(t.records[0].Label, "Ann (40)");
  assert.equal(t.records[1].Total, "20.00");
  // removing the number format
  const { book: plain } = replayOps(fresh, [{ id: "sheet.mutation.remove.numfmt", params: { unitId: "wb1", subUnitId: "s1", ranges: [{ startRow: 1, endRow: 2, startColumn: 2, endColumn: 2 }] } }]);
  assert.equal(table(plain).records[0].Total, "40");
  // a removed name leaves #NAME?
  const { book: noName } = replayOps(book, [{ id: "formula.mutation.remove-defined-name", params: { unitId: "wb1", id: "n1" } }]);
  assert.match(table(await recalcBook(noName)).records[0].Total, /#NAME\?/);
});

test("a book without formulas is returned as it is", async () => {
  const b = base();
  for (const row of Object.values(b.sheets.s1.cellData!)) for (const c of Object.values(row)) delete (c as Record<string, unknown>).f;
  assert.equal(hasFormulas(b), false);
  assert.equal(await recalcBook(b), b);
});
