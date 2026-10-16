// Collaboration helpers: the live Sheet replay mail merge reads, who a
// comment newly mentions, the "@" being typed, and presence initials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replayOps, liveBookFrom, type LiveBook } from "../lib/docs/sheet-live";
import { sheetTable } from "../lib/docs/mail-merge";
import { newMentions } from "../lib/notifications";
import { mentionQuery } from "../components/docs/MentionBox";
import { initialsOf } from "../components/docs/presence-ext";

const base = (): LiveBook => ({
  sheetOrder: ["s1"],
  sheets: {
    s1: {
      id: "s1",
      name: "People",
      rowCount: 10,
      columnCount: 3,
      cellData: { 0: { 0: { v: "Name" }, 1: { v: "City" } }, 1: { 0: { v: "Ada" }, 1: { v: "London" } }, 2: { 0: { v: "Grace" }, 1: { v: "Arlington" } } },
    },
  },
});
const show = (c: unknown) => String((c as { v?: unknown } | undefined)?.v ?? "");
const names = (b: LiveBook) => sheetTable(b as never, "s1", show).records.map((r) => r.Name);

test("set-range-values: new cells, edits and clears", () => {
  const { book, unsupported } = replayOps(base(), [
    { id: "sheet.mutation.set-range-values", params: { unitId: "u", subUnitId: "s1", cellValue: { 3: { 0: { v: "Alan" }, 1: { v: "Wilmslow" } } } } },
    { id: "sheet.mutation.set-range-values", params: { unitId: "u", subUnitId: "s1", cellValue: { 1: { 0: { v: "Ada L." } } } } },
    { id: "sheet.mutation.set-range-values", params: { unitId: "u", subUnitId: "s1", cellValue: { 2: { 0: null, 1: { v: null } } } } },
    { id: "sheet.mutation.set-worksheet-col-width", params: {} },
    { id: "sheet.mutation.set-range-values", params: { unitId: "u", subUnitId: "s1", cellValue: { 1: { 1: { s: "bold" } } } } },
  ]);
  assert.deepEqual(unsupported, []);
  assert.deepEqual(names(book), ["Ada L.", "Alan"]);
  assert.deepEqual(book.sheets.s1.cellData![1][1], { v: "London", s: "bold" }, "a style change keeps the value");
  assert.equal(base().sheets.s1.cellData![1][0].v, "Ada", "the base is not changed");
});

test("rows and columns inserted, removed and moved; sort; sheets", () => {
  let { book } = replayOps(base(), [
    { id: "sheet.mutation.insert-row", params: { subUnitId: "s1", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 2 } } },
    { id: "sheet.mutation.set-range-values", params: { subUnitId: "s1", cellValue: { 1: { 0: { v: "Zed" } } } } },
  ]);
  assert.deepEqual(names(book), ["Zed", "Ada", "Grace"]);
  ({ book } = replayOps(book, [{ id: "sheet.mutation.remove-rows", params: { subUnitId: "s1", range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 2 } } }]));
  assert.deepEqual(names(book), ["Zed", "Grace"]);
  ({ book } = replayOps(book, [{ id: "sheet.mutation.move-rows", params: { subUnitId: "s1", sourceRange: { startRow: 2, endRow: 2 }, targetRange: { startRow: 1, endRow: 1 } } }]));
  assert.deepEqual(names(book), ["Grace", "Zed"]);
  // sort descending by name: row 1 takes row 2's cells and the other way round
  ({ book } = replayOps(book, [{ id: "sheet.mutation.reorder-range", params: { subUnitId: "s1", range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 }, order: { 1: 2, 2: 1 } } }]));
  assert.deepEqual(names(book), ["Zed", "Grace"]);
  ({ book } = replayOps(book, [{ id: "sheet.mutation.insert-col", params: { subUnitId: "s1", range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 } } }]));
  assert.deepEqual(sheetTable(book as never, "s1", show).fields, ["Column 1", "Name", "City"]);
  ({ book } = replayOps(book, [{ id: "sheet.mutation.remove-col", params: { subUnitId: "s1", range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 } } }]));
  assert.deepEqual(sheetTable(book as never, "s1", show).fields, ["Name", "City"]);
  ({ book } = replayOps(book, [
    { id: "sheet.mutation.insert-sheet", params: { index: 0, sheet: { id: "s2", name: "New", cellData: { 0: { 0: { v: "X" } } } } } },
    { id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "s2", name: "Renamed" } },
  ]));
  assert.deepEqual(book.sheetOrder, ["s2", "s1"]);
  assert.equal(book.sheets.s2.name, "Renamed");
  ({ book } = replayOps(book, [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "s2" } }]));
  assert.deepEqual(book.sheetOrder, ["s1"]);
  // something we cannot replay is reported
  assert.deepEqual(replayOps(base(), [{ id: "sheet.mutation.something-new", params: {} }]).unsupported, ["sheet.mutation.something-new"]);
});

test("the collaboration document's base and log", () => {
  assert.equal(liveBookFrom(undefined, []), null);
  assert.equal(liveBookFrom("not json", []), null);
  const live = liveBookFrom(JSON.stringify(base()), [JSON.stringify({ id: "sheet.mutation.set-range-values", params: { subUnitId: "s1", cellValue: { 5: { 0: { v: "Kat" } } } } }), "garbage"])!;
  assert.equal(live.ops, 1);
  assert.deepEqual(names(live.book), ["Ada", "Grace", "Kat"]);
});

test("mentions: new, not the author, not twice in a thread", () => {
  assert.deepEqual(newMentions("Hi @Ann@Example.com and @bob@example.com", [], "bob@example.com"), ["ann@example.com"]);
  assert.deepEqual(newMentions("@ann@example.com again, and @cy@example.com", ["thanks @ann@example.com"], "me@example.com"), ["cy@example.com"]);
  assert.deepEqual(newMentions("email me at ann@example.com", [], "x@example.com"), []);
});

test("the @ being typed", () => {
  assert.deepEqual(mentionQuery("Hello @an", 9), { start: 6, q: "an" });
  assert.deepEqual(mentionQuery("@", 1), { start: 0, q: "" });
  assert.deepEqual(mentionQuery("ask @ann@exa", 12), { start: 4, q: "ann@exa" });
  assert.equal(mentionQuery("mail ann@example.com", 20), null, "an address is not a mention");
  assert.equal(mentionQuery("@ann done", 9), null);
});

test("presence initials", () => {
  assert.equal(initialsOf("Ada Lovelace"), "AL");
  assert.equal(initialsOf("grace"), "G");
  assert.equal(initialsOf("alan.turing@example.com"), "AT");
  assert.equal(initialsOf(""), "?");
});
