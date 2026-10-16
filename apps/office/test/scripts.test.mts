// Scripts: the sandbox, the operations a script produces, the recorder's
// lines, and .xlsm macros and custom XML kept byte for byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { toJavaScript, type Oracle, type ScriptResult, type Snapshot } from "../lib/script-worker.ts";

const sandboxSource = () => readFileSync(new URL("../public/script-sandbox.js", import.meta.url), "utf8");
import { valueLines } from "../lib/sheet-scripts.ts";

/** Runs the sandbox's own code in a fresh context, as the worker would. */
async function run(code: string, snapshot: Snapshot, oracle: Oracle = {}): Promise<ScriptResult> {
  let result: ScriptResult | null = null;
  const ctx: Record<string, unknown> = { postMessage: (m: ScriptResult) => (result = m), fetch: () => "network!", XMLHttpRequest: class {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(sandboxSource(), ctx);
  (ctx.onmessage as (e: { data: unknown }) => void)({ data: { code: await toJavaScript(code), snapshot, oracle } });
  // Messages are copied between the worker and the page.
  return JSON.parse(JSON.stringify(result));
}

const snap: Snapshot = { active: "Data", sheets: [{ name: "Data", values: [["Item", "Qty"], ["Tea", 2], ["Cake", 5]], formulas: [[null, null], [null, null], [null, null]] }] };

test("a script reads the copy and its changes come back as operations", async () => {
  const r = await run(
    `function main(workbook: ExcelScript.Workbook) {
      const sheet = workbook.getActiveWorksheet();
      const rows = sheet.getUsedRange().getValues();
      let total = 0;
      for (const [, q] of rows.slice(1)) total += q;
      sheet.getRange("A4:B4").setValues([["Total", total]]);
      sheet.getRange("C2").setFormula("B2*2");
      sheet.getRange("A1:B1").getFormat().getFont().setBold(true);
      sheet.getRange("B2:B4").setNumberFormat("0.00");
      const s2 = workbook.addWorksheet("Summary");
      s2.getRange("A1").setValue(sheet.getRange("B4").getValue());
      console.log("total", total, { rows: rows.length });
      return total;
    }`,
    snap,
  );
  assert.equal(r.ok, true, (r as { error?: string }).error);
  assert.deepEqual(r.logs, ['total 7 {"rows":3}']);
  assert.equal((r as { returned?: unknown }).returned, 7);
  assert.deepEqual(r.ops, [
    { op: "values", sheet: "Data", row: 3, column: 0, cells: [[{ v: "Total" }, { v: 7 }]] },
    { op: "values", sheet: "Data", row: 1, column: 2, cells: [[{ f: "=B2*2" }]] },
    { op: "style", sheet: "Data", box: { row: 0, column: 0, rows: 1, columns: 2 }, style: { bold: true } },
    { op: "format", sheet: "Data", box: { row: 1, column: 1, rows: 3, columns: 1 }, pattern: "0.00" },
    { op: "addSheet", name: "Summary" },
    { op: "values", sheet: "Summary", row: 0, column: 0, cells: [[{ v: 7 }]] },
  ]);
});

test("the sandbox has no network, and errors change nothing", async () => {
  const r = await run(`function main(workbook) { workbook.getActiveWorksheet().getRange("A1").setValue(1); return fetch("https://example.com"); }`, snap);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /TypeError: fetch is not a function/);
  const x = await run(`function main(workbook) { return typeof XMLHttpRequest + typeof globalThis.fetch; }`, snap);
  assert.equal((x as { returned?: unknown }).returned, "undefinedundefined");
  assert.match((await run(`const x = 1;`, snap) as { error: string }).error, /needs a function main/);
  assert.match((await run(`function main(w) { w.getActiveWorksheet().getRange("A1:B2").setValues([[1]]); }`, snap) as { error: string }).error, /needs 2 rows of 2 values/);
  assert.match((await run(`function main(w) { w.getActiveWorksheet().getRange("nope"); }`, snap) as { error: string }).error, /not a cell or range address/);
});

test("recorded edits become script lines", () => {
  assert.deepEqual(valueLines({ 0: { 0: { v: "Name" }, 1: { f: "=SUM(B2:B9)" } }, 2: { 3: null as any } }), [
    '  sheet.getRange("A1").setValue("Name");',
    '  sheet.getRange("B1").setFormula("=SUM(B2:B9)");',
    '  sheet.getRange("D3").clear();',
  ]);
});

test(".xlsm macros, code names and other programs' custom XML are kept byte for byte; scripts ride along", async () => {
  const { univerToXlsx, xlsxToUniver, isMacroEnabled } = await import("../lib/xlsx.ts");
  const JSZip = (await import("jszip")).default;
  const base = await univerToXlsx({ id: "u", name: "W", appVersion: "", locale: "enUS", styles: {}, sheetOrder: ["s"], sheets: { s: { id: "s", name: "Sheet1", cellData: { 0: { 0: { v: 1 } } } } }, resources: [] } as any);
  const zip = await JSZip.loadAsync(base);
  const vba = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
  const sig = Uint8Array.from([1, 2, 3, 4]);
  // Power Query keeps its queries in a UTF-16 custom XML item.
  const mashup = Buffer.from('﻿<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">AAAA</DataMashup>', "utf16le");
  zip.file("xl/vbaProject.bin", vba);
  zip.file("xl/vbaProjectSignature.bin", sig);
  zip.file("xl/_rels/vbaProject.bin.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature" Target="vbaProjectSignature.bin"/></Relationships>`);
  zip.file("customXml/item1.xml", mashup);
  zip.file("customXml/itemProps1.xml", `<?xml version="1.0" encoding="UTF-8"?><ds:datastoreItem ds:itemID="{AB}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>`);
  zip.file("customXml/_rels/item1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`);
  zip.file(
    "xl/_rels/workbook.xml.rels",
    (await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(
      "</Relationships>",
      '<Relationship Id="rId90" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/><Relationship Id="rId91" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>',
    ),
  );
  zip.file("[Content_Types].xml", (await zip.file("[Content_Types].xml")!.async("string")).replace("</Types>", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/xl/vbaProjectSignature.bin" ContentType="application/vnd.ms-office.vbaProjectSignature"/></Types>'));
  zip.file("xl/workbook.xml", (await zip.file("xl/workbook.xml")!.async("string")).replace("<workbookPr ", '<workbookPr codeName="ThisWorkbook" '));
  zip.file("xl/worksheets/sheet1.xml", (await zip.file("xl/worksheets/sheet1.xml")!.async("string")).replace(/(<worksheet\b[^>]*>)/, '$1<sheetPr codeName="Sheet1"/>'));
  const book = await xlsxToUniver(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(isMacroEnabled(book), true);
  book.resources!.push({ name: "SHEET_SYNERGY_SCRIPT_PLUGIN", data: JSON.stringify({ scripts: [{ id: "a", name: "Tidy <up> & go", code: 'function main(w) { console.log("héllo ✓"); }' }] }) });
  const out = await JSZip.loadAsync(await univerToXlsx(book));
  assert.deepEqual(new Uint8Array(await out.file("xl/vbaProject.bin")!.async("uint8array")), vba);
  assert.deepEqual(new Uint8Array(await out.file("xl/vbaProjectSignature.bin")!.async("uint8array")), sig);
  assert.match(await out.file("xl/_rels/vbaProject.bin.rels")!.async("string"), /vbaProjectSignature" Target="vbaProjectSignature.bin"/);
  const types = await out.file("[Content_Types].xml")!.async("string");
  assert.match(types, /PartName="\/xl\/workbook.xml" ContentType="application\/vnd.ms-excel.sheet.macroEnabled.main\+xml"/);
  assert.match(types, /PartName="\/xl\/vbaProject.bin" ContentType="application\/vnd.ms-office.vbaProject"/);
  assert.match(await out.file("xl/workbook.xml")!.async("string"), /<workbookPr codeName="ThisWorkbook"/);
  assert.match(await out.file("xl/worksheets/sheet1.xml")!.async("string"), /<sheetPr codeName="Sheet1"/);
  assert.deepEqual(Buffer.from(await out.file("customXml/item1.xml")!.async("uint8array")), mashup);
  assert.match(await out.file("customXml/item2.xml")!.async("string"), /<scripts xmlns="urn:synergy:scripts"><script id="a" name="Tidy &lt;up&gt; &amp; go">/);
  const again = await xlsxToUniver(await out.generateAsync({ type: "uint8array" }));
  assert.deepEqual(JSON.parse(again.resources!.find((r) => r.name === "SHEET_SYNERGY_SCRIPT_PLUGIN")!.data).scripts, [{ id: "a", name: "Tidy <up> & go", code: 'function main(w) { console.log("héllo ✓"); }' }]);
  assert.equal(JSON.parse(again.resources!.find((r) => r.name === "SHEET_SYNERGY_KEPT_PARTS")!.data).customXml.length, 1, "our scripts part isn't kept twice");
});

test("TypeScript scripts run, types and all (enums, interfaces, casts)", async () => {
  const r = await run(
    `interface Row { item: string; qty: number }
    enum Col { Item, Qty }
    function main(workbook: ExcelScript.Workbook): number {
      const rows: Row[] = workbook.getActiveWorksheet().getRange("A2:B3").getValues().map((v) => ({ item: v[Col.Item] as string, qty: <number>v[Col.Qty] }));
      return rows.reduce((n: number, x: Row) => n + x.qty, 0);
    }`,
    snap,
  );
  assert.equal(r.ok, true, (r as { error?: string }).error);
  assert.equal((r as { returned?: unknown }).returned, 7);
});

test("reading a formula after changing cells asks for a recalculation, then carries on with the results", async () => {
  const withFormula: Snapshot = { active: "Data", sheets: [{ name: "Data", values: [[2, 4]], formulas: [[null, "=A1*2"]] }] };
  const code = `function main(workbook) {
    const s = workbook.getActiveWorksheet();
    const before = s.getRange("B1").getValue();
    s.getRange("A1").setValue(5);
    let after;
    try { after = s.getRange("B1").getValue(); } catch (e) { after = "caught"; }
    s.getRange("C1").setValue(after);
    return [before, after].join(",");
  }`;
  const first = await run(code, withFormula);
  assert.equal(first.ok, false);
  assert.equal((first as { sync?: number }).sync, 1, "stops after the first change, even though the script caught it");
  assert.deepEqual(first.ops, [{ op: "values", sheet: "Data", row: 0, column: 0, cells: [[{ v: 5 }]] }]);
  const second = await run(code, withFormula, { 1: { Data: [[5, 10]] } });
  assert.equal(second.ok, true, (second as { error?: string }).error);
  assert.equal((second as { returned?: unknown }).returned, "4,10");
  assert.deepEqual(second.ops.at(-1), { op: "values", sheet: "Data", row: 0, column: 2, cells: [[{ v: 10 }]] });
});

test("more of the Office Scripts API: formatting, sizes, merges, rows, sorting, sheets, freeze panes and tables", async () => {
  const s: Snapshot = { ...snap, sheets: [{ ...snap.sheets[0], values: [["Item", "Qty"], ["Tea", 2], ["Cake", 5], ["Bun", 1]], formulas: [[null, null], [null, null], [null, null], [null, null]] }], selection: { sheet: "Data", box: { row: 1, column: 0, rows: 2, columns: 2 } } };
  const r = await run(
    `function main(workbook: ExcelScript.Workbook) {
      const sheet = workbook.getActiveWorksheet();
      const f = sheet.getRange("A1:B1").getFormat();
      f.getFont().setSize(14);
      f.getFont().setName("Georgia");
      f.setHorizontalAlignment(ExcelScript.HorizontalAlignment.center);
      f.setWrapText(true);
      sheet.getRange("B1").getFormat().setColumnWidth(120);
      sheet.getRange("A1").getSurroundingRegion().getFormat().autofitColumns();
      sheet.getRange("A2:B4").getSort().apply([{ key: 1, ascending: false }]);
      sheet.getRange("A2").getEntireRow().insert(ExcelScript.InsertShiftDirection.down);
      console.log(sheet.getRange("A3").getText(), workbook.getSelectedRange().getAddress(), workbook.getActiveCell().getAddress());
      sheet.getRange("C1:D1").merge(false);
      sheet.getFreezePanes().freezeRows(1);
      sheet.addTable("A1:B5", true);
      sheet.setTabColor("#ff0000");
      sheet.setName("Stock");
      workbook.addWorksheet("Old").delete();
    }`,
    s,
  );
  assert.equal(r.ok, true, (r as { error?: string }).error);
  assert.deepEqual(r.logs, ["Cake Data!A2:B3 Data!A2"]);
  const kinds = r.ops.map((o) => o.op);
  assert.deepEqual(kinds, ["style", "style", "style", "style", "size", "autofit", "values", "insert", "merge", "freeze", "addTable", "sheet", "renameSheet", "addSheet", "deleteSheet"]);
  assert.deepEqual(r.ops[6], { op: "values", sheet: "Data", row: 1, column: 0, cells: [[{ v: "Cake" }, { v: 5 }], [{ v: "Tea" }, { v: 2 }], [{ v: "Bun" }, { v: 1 }]] });
  assert.deepEqual(r.ops[5], { op: "autofit", sheet: "Data", index: 0, count: 2 });
  assert.deepEqual(r.ops[7], { op: "insert", sheet: "Data", dim: "rows", index: 1, count: 1 });
  assert.deepEqual(r.ops[9], { op: "freeze", sheet: "Data", rows: 1, columns: 0 });
  assert.deepEqual(r.ops[12], { op: "renameSheet", sheet: "Data", name: "Stock" });
  // Sorting formulas isn't faked.
  const bad = await run(`function main(wb) { wb.getActiveWorksheet().getRange("A1:A2").getSort().apply([{ key: 0 }]); }`, { active: "Data", sheets: [{ name: "Data", values: [[1], [2]], formulas: [["=B1"], [null]] }] });
  assert.match((bad as { error: string }).error, /sort values only/);
});
