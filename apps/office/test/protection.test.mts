// Sheet and range protection: the rules, how ranges follow structural edits,
// the server-side check of collaboration messages, and the .xlsx round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as Y from "yjs";
import {
  enforceOnSnapshot,
  foldProtections,
  PROTECTION_RESOURCE,
  protectionsOf,
  SET_PROTECTIONS_MUTATION,
  violation,
  withProtections,
  type Protection,
} from "../lib/protection-rules.mjs";
import { judgeChange, scanUpdate, syncUpdateOf } from "../server/protection-guard.mjs";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";

const g = (startRow: number, startColumn: number, endRow = startRow, endColumn = startColumn) => ({ startRow, startColumn, endRow, endColumn });
const rangeP: Protection = { id: "p1", sheetId: "s1", range: g(1, 1, 4, 3), editors: ["ana@example.com"], description: "Totals" };
const sheetP: Protection = { id: "p2", sheetId: "s2", range: null, editors: [], except: [g(0, 4, 2, 4)] };
const all = [rangeP, sheetP];
const editor = { email: "bob@example.com", role: "editor" };
const listed = { email: "Ana@Example.com", role: "editor" };
const owner = { email: "own@example.com", role: "owner" };
const setValue = (sheetId: string, r: number, c: number) => ({ id: "sheet.mutation.set-range-values", params: { unitId: "u", subUnitId: sheetId, cellValue: { [r]: { [c]: { v: 1 } } } } });

test("only the owner and listed editors change a protected range", () => {
  assert.ok(violation(all, setValue("s1", 2, 2), editor));
  assert.equal(violation(all, setValue("s1", 2, 2), listed), null, "listed editor (emails compare case-insensitively)");
  assert.equal(violation(all, setValue("s1", 2, 2), owner), null);
  assert.equal(violation(all, setValue("s1", 0, 0), editor), null, "outside the range");
  assert.ok(violation(all, { id: "sheet.mutation.add-worksheet-merge", params: { subUnitId: "s1", ranges: [g(0, 0, 1, 1)] } }, editor), "a merge reaching into the range");
  assert.equal(violation(all, { id: "sheet.mutation.set-worksheet-row-height", params: { subUnitId: "s1", ranges: [g(2, 0)] } }, editor), null, "row heights are free under a range protection");
  assert.ok(violation(all, { id: "sheet.mutation.remove-sheet", params: { subUnitId: "s1" } }, editor), "its sheet can't be deleted");
  assert.ok(violation(all, { id: SET_PROTECTIONS_MUTATION, params: { unitId: "u", value: [] } }, listed), "only the owner changes protections");
});

test("rows and columns: inserting above moves a range, inserting inside or deleting is blocked", () => {
  const ins = (row: number) => ({ id: "sheet.mutation.insert-row", params: { subUnitId: "s1", range: g(row, 0, row, 25) } });
  const del = (a: number, b: number) => ({ id: "sheet.mutation.remove-rows", params: { subUnitId: "s1", range: g(a, 0, b, 25) } });
  assert.equal(violation(all, ins(0), editor), null);
  assert.equal(violation(all, ins(1), editor), null, "at the top edge the range just moves down");
  assert.ok(violation(all, ins(2), editor));
  assert.equal(violation(all, ins(5), editor), null);
  assert.ok(violation(all, del(4, 6), editor));
  assert.equal(violation(all, del(6, 9), editor), null);
  assert.ok(violation(all, { id: "sheet.mutation.insert-col", params: { subUnitId: "s1", range: g(0, 2, 0, 2) } }, editor));
});

test("a protected sheet allows only its exception ranges", () => {
  assert.ok(violation(all, setValue("s2", 0, 0), editor));
  assert.equal(violation(all, setValue("s2", 1, 4), editor), null, "inside the exception");
  assert.ok(violation(all, { id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "s2", name: "x" } }, editor));
  assert.ok(violation(all, { id: "sheet.mutation.insert-row", params: { subUnitId: "s2", range: g(9, 0, 9, 9) } }, editor));
  assert.equal(violation(all, { id: "sheet.mutation.set-frozen", params: { subUnitId: "s2" } }, editor), null, "view settings stay free");
  assert.equal(violation(all, { id: "sheet.mutation.set-range-values", params: { subUnitId: "s3", cellValue: { 0: { 0: { v: 1 } } } } }, editor), null, "other sheets");
});

test("protected ranges follow inserted, deleted and moved rows and columns", () => {
  const after = (op: { id: string; params: unknown }) => foldProtections([rangeP], op)[0]?.range;
  assert.deepEqual(after({ id: "sheet.mutation.insert-row", params: { subUnitId: "s1", range: g(0, 0, 1, 0) } }), g(3, 1, 6, 3));
  assert.deepEqual(after({ id: "sheet.mutation.remove-rows", params: { subUnitId: "s1", range: g(0, 0, 0, 0) } }), g(0, 1, 3, 3));
  assert.deepEqual(after({ id: "sheet.mutation.remove-rows", params: { subUnitId: "s1", range: g(3, 0, 9, 0) } }), g(1, 1, 2, 3), "owner deletes part of it");
  assert.equal(foldProtections([rangeP], { id: "sheet.mutation.remove-rows", params: { subUnitId: "s1", range: g(0, 0, 9, 0) } }).length, 0, "all of it");
  assert.deepEqual(after({ id: "sheet.mutation.insert-col", params: { subUnitId: "s1", range: g(0, 0, 0, 0) } }), g(1, 2, 4, 4));
  assert.deepEqual(after({ id: "sheet.mutation.move-rows", params: { subUnitId: "s1", sourceRange: g(8, 0, 8, 0), targetRange: g(0, 0, 0, 0) } }), g(2, 1, 5, 3));
  assert.deepEqual(after({ id: "sheet.mutation.insert-row", params: { subUnitId: "other", range: g(0, 0, 0, 0) } }), rangeP.range, "another sheet");
  assert.equal(foldProtections(all, { id: "sheet.mutation.remove-sheet", params: { subUnitId: "s2" } }).length, 1);
});

const book = (cells: Record<number, Record<number, unknown>>, protections: Protection[]) =>
  withProtections({ id: "u", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "S", cellData: cells } } } as any, protections);

test("a save from an editor keeps the stored protections and protected cells", () => {
  const stored = book({ 2: { 2: { v: "kept" } }, 0: { 0: { v: "a" } } }, [rangeP]);
  const incoming = book({ 2: { 2: { v: "changed" }, 3: { v: "new" } }, 0: { 0: { v: "b" } } }, []);
  const out: any = enforceOnSnapshot(stored, incoming, editor);
  assert.deepEqual(protectionsOf(out), [rangeP]);
  assert.equal(out.sheets.s1.cellData[2][2].v, "kept");
  assert.equal(out.sheets.s1.cellData[2][3], undefined, "a new cell inside the range is dropped");
  assert.equal(out.sheets.s1.cellData[0][0].v, "b", "outside the range the save stands");
  assert.equal((enforceOnSnapshot(stored, incoming, listed) as any).sheets.s1.cellData[2][2].v, "changed");
});

// A sync-step-2 message as the Hocuspocus provider sends it.
function syncMessage(name: string, update: Uint8Array): Uint8Array {
  const out: number[] = [];
  const varUint = (n: number) => {
    while (n > 0x7f) {
      out.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    out.push(n);
  };
  const bytes = new TextEncoder().encode(name);
  varUint(bytes.length);
  out.push(...bytes);
  varUint(0);
  varUint(2);
  varUint(update.length);
  return new Uint8Array([...out, ...update]);
}

test("the server refuses a collaboration message that edits a protected range", () => {
  const server = new Y.Doc();
  server.getMap("meta").set("base", JSON.stringify(book({}, [rangeP])));
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const before = Y.encodeStateVector(server);
  client.getArray("ops").push([JSON.stringify(setValue("s1", 0, 0)), JSON.stringify(setValue("s1", 2, 2))]);
  const change = scanUpdate(syncUpdateOf(syncMessage("doc", Y.encodeStateAsUpdate(client, before)))!)!;
  assert.equal(change.ops.length, 2);
  assert.ok(judgeChange(change, [rangeP], editor, true));
  assert.equal(judgeChange(change, [rangeP], listed, true), null);

  // An insert above moves the range first, so a later edit at its old place is fine.
  const c2 = new Y.Doc();
  Y.applyUpdate(c2, Y.encodeStateAsUpdate(server));
  c2.getArray("ops").push([JSON.stringify({ id: "sheet.mutation.insert-row", params: { subUnitId: "s1", range: g(0, 0, 9, 0) } }), JSON.stringify(setValue("s1", 2, 2))]);
  assert.equal(judgeChange(scanUpdate(Y.encodeStateAsUpdate(c2, before))!, [rangeP], editor, true), null);

  // Replacing the workbook while something is protected: owner only.
  const c3 = new Y.Doc();
  Y.applyUpdate(c3, Y.encodeStateAsUpdate(server));
  c3.getMap("meta").set("base", JSON.stringify(book({}, [])));
  const replace = scanUpdate(Y.encodeStateAsUpdate(c3, before))!;
  assert.ok(judgeChange(replace, [rangeP], editor, true));
  assert.equal(judgeChange(replace, [rangeP], owner, true), null);
  assert.equal(judgeChange(replace, [], editor, true), null, "nothing protected: anyone may");

  // Awareness and sync-step-1 messages carry no edits.
  assert.equal(syncUpdateOf(new Uint8Array([3, 100, 111, 99, 1, 0])), null);
});

test(".xlsx keeps protected sheets (as Excel protection) and ranges with their editors", async () => {
  // Imported sheets are numbered sheet-1, sheet-2, ...
  const p1: Protection = { id: "r1", sheetId: "sheet-1", range: g(1, 1, 4, 3), editors: ["ana@example.com", "cy@example.com"], description: "Totals, do not touch" };
  const p2: Protection = { id: "w1", sheetId: "sheet-2", range: null, editors: ["ana@example.com"], except: [g(0, 4, 2, 4), g(6, 0)] };
  const wb = withProtections(
    {
      id: "u",
      name: "P",
      appVersion: "",
      locale: "enUS",
      styles: {},
      sheetOrder: ["sheet-1", "sheet-2"],
      sheets: { "sheet-1": { id: "sheet-1", name: "Data", cellData: { 0: { 0: { v: 1 } } } }, "sheet-2": { id: "sheet-2", name: "Locked sheet", cellData: { 0: { 0: { v: 2 } } } } },
    } as UniverWorkbook,
    [p1, p2],
  );
  const bytes = await univerToXlsx(wb);
  const zip = await JSZip.loadAsync(bytes);
  const s2 = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  assert.match(s2, /<sheetProtection[^>]*sheet="1"/);
  assert.match(s2, /<protectedRanges><protectedRange[^>]*sqref="E1:E3"/);
  assert.ok(s2.indexOf("<sheetProtection") > s2.indexOf("</sheetData>") && s2.indexOf("<sheetProtection") < s2.indexOf("<pageMargins"), "schema order");
  const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.doesNotMatch(s1, /sheetProtection/);
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  assert.match(workbookXml, /<definedName name="_SynergyProtect1" localSheetId="0" hidden="1"/);

  // openpyxl (a strict reader) sees the protection and the hidden names.
  const dir = mkdtempSync(path.join(tmpdir(), "prot-"));
  try {
    const file = path.join(dir, "p.xlsx");
    writeFileSync(file, bytes);
    const py = execFileSync("python3", ["-c", "import sys,openpyxl;wb=openpyxl.load_workbook(sys.argv[1]);print(wb['Locked sheet'].protection.sheet, wb['Data'].protection.sheet)", file]).toString().trim();
    assert.equal(py, "True False");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const back = await xlsxToUniver(bytes);
  const got = protectionsOf(back);
  assert.deepEqual(got.find((p) => p.id === "r1"), p1);
  const sheet = got.find((p) => p.sheetId === "sheet-2")!;
  assert.equal(sheet.id, "w1");
  assert.equal(sheet.range, null);
  assert.deepEqual(sheet.editors, ["ana@example.com"]);
  assert.deepEqual(sheet.except, [g(0, 4, 2, 4), g(6, 0)]);
  const names = JSON.parse(back.resources!.find((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN")?.data || "{}");
  assert.equal(Object.keys(names).length, 0, "the helper names don't show up as defined names");
  assert.ok(back.resources!.some((r) => r.name === PROTECTION_RESOURCE));
});

test("a long editor list survives Excel's 255-character name comments", async () => {
  const editors = Array.from({ length: 20 }, (_, i) => `person.number${i}@example.com`);
  const p: Protection = { id: "big", sheetId: "sheet-1", range: g(0, 0, 9, 9), editors };
  const wb = withProtections({ id: "u", name: "P", appVersion: "", locale: "enUS", styles: {}, sheetOrder: ["sheet-1"], sheets: { "sheet-1": { id: "sheet-1", name: "S", cellData: {} } } } as UniverWorkbook, [p]);
  const bytes = await univerToXlsx(wb);
  const workbookXml = await (await JSZip.loadAsync(bytes)).file("xl/workbook.xml")!.async("string");
  for (const m of workbookXml.matchAll(/comment="([^"]*)"/g)) assert.ok(m[1].replace(/&quot;/g, '"').length <= 255);
  assert.deepEqual(protectionsOf(await xlsxToUniver(bytes))[0], p);
});

test("a sheet protected in Excel opens protected, with its unlocked cells and edit ranges open", async () => {
  const book = await xlsxToUniver(await readFile(new URL("./fixtures/openpyxl-protection.xlsx", import.meta.url)));
  const list = protectionsOf(book);
  assert.equal(list.length, 1);
  const [p] = list;
  assert.equal(p.sheetId, book.sheetOrder[0]);
  assert.equal(p.range, null);
  assert.deepEqual(p.editors, ["*"], "with a password, anyone who can edit and knows it");
  assert.deepEqual(p.except, [g(0, 4, 2, 4), g(1, 2, 3, 2)], "the Inputs range and the unlocked C2:C4");
  assert.equal(p.xlsx?.password, "DAA7", "Excel's password hash is kept for the way back");
  assert.equal(p.xlsx?.formatColumns, "0");
  const again = await JSZip.loadAsync(await univerToXlsx(book));
  const xml = await again.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(xml, /<sheetProtection[^>]*password="DAA7"/);
});
