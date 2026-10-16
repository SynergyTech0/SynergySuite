// Browser check for the Sheets editor: open an .xlsx, edit it (formulas,
// formatting, sort, filter), download it as .xlsx, check the file, re-open it.
//
// Needs the office app (and its Postgres) running, e.g. `npm run dev` with
// DEV_EMAIL set, plus `npm run collab` for live co-editing (and
// IMPORT_ALLOW_HOSTS=127.0.0.1 so Get data may fetch from the test's own
// local server; without it that part is skipped). For the AI helpers, start
// the app with OFFICE_AI_BASE_URL=http://127.0.0.1:3179/v1 and
// OFFICE_AI_MODEL=e2e-stub (the test serves a stand-in model there);
// otherwise the AI-off path is checked. Then:
//   BASE_URL=http://127.0.0.1:3070 npm run test:e2e -w apps/office
// Uses the Chromium that matches playwright-core (PLAYWRIGHT_BROWSERS_PATH).
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const step = (msg) => console.log(`- ${msg}`);

async function fixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(["Region", "Units", "Price", "Total"]);
  ws.addRow(["West", 30, 2.5, { formula: "B2*C2", result: 75 }]);
  ws.addRow(["East", 10, 4, { formula: "B3*C3", result: 40 }]);
  ws.addRow(["North", 20, 3, { formula: "B4*C4", result: 60 }]);
  ws.getRow(1).font = { bold: true };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  ws.getColumn(1).width = 18;
  ws.getCell("C2").numFmt = "$#,##0.00";
  ws.mergeCells("F1:G1");
  ws.getCell("F1").value = "Merged";
  ws.getCell("A2").note = "best region";
  ws.getCell("B2").dataValidation = { type: "whole", operator: "greaterThan", formulae: [0] };
  ws.addConditionalFormatting({
    ref: "B2:B4",
    rules: [{ type: "cellIs", operator: "greaterThan", formulae: [15], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } } } }],
  });
  // A second sheet with an Excel table, a picture and print settings.
  const extras = wb.addWorksheet("Extras");
  extras.addTable({
    name: "Orders",
    ref: "A1",
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium7", showRowStripes: true },
    columns: [{ name: "Region", totalsRowLabel: "Sum" }, { name: "Units", totalsRowFunction: "sum" }],
    rows: [["West", 30], ["East", 10]],
  });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAQYGBgB6JgYBnxWv0AAAAABJRU5ErkJggg==", "base64");
  extras.addImage(wb.addImage({ buffer: png, extension: "png" }), { tl: { col: 3, row: 1 }, ext: { width: 120, height: 60 } });
  extras.pageSetup = { orientation: "landscape", printArea: "A1:B4" };
  const file = path.join(tmpdir(), `sheets-e2e-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}

// Plugin state from the live workbook's snapshot.
const resourceIn = (page, name) =>
  page.evaluate((n) => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === n)?.data || "{}"), name);
const extrasState = async (page) => {
  const tables = await resourceIn(page, "SHEET_TABLE_PLUGIN");
  const drawings = await resourceIn(page, "SHEET_DRAWING_PLUGIN");
  const extrasId = await page.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Extras").getSheetId());
  return {
    table: tables[extrasId]?.tables?.map((t) => [t.name, t.options.tableStyleId]),
    images: drawings[extrasId]?.order?.length || 0,
  };
};

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  const file = await fixture();
  step("open a new spreadsheet");
  await page.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 180_000 });
  const docUrl = page.url();

  step("import the .xlsx through File > Open");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheetName() === "Sales", null, { timeout: 30_000 });
  const titleBox = page.locator('input[placeholder="Untitled"]');
  await page.waitForFunction((t) => document.querySelector('input[placeholder="Untitled"]')?.value === t, path.basename(file, ".xlsx"), { timeout: 5_000 })
    .catch(async () => assert.fail(`title bar shows the imported file's name, got ${await titleBox.inputValue()}`));
  const imported = await page.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    const r = (a) => sh.getRange(a);
    return {
      a1: r("A1").getValue(),
      d2: r("D2").getValue(),
      d2f: r("D2").getFormula(),
      bold: r("A1").getCellStyleData()?.bl,
      bg: r("A1").getCellStyleData()?.bg?.rgb,
      fmt: r("C2").getNumberFormat?.(),
      merged: r("F1").isPartOfMerge?.(),
      frozen: sh.getFreeze?.(),
      width: sh.getColumnWidth(0),
    };
  });
  assert.equal(imported.a1, "Region");
  assert.equal(imported.d2, 75);
  assert.equal(imported.d2f, "=B2*C2");
  assert.equal(imported.bold, 1);
  assert.equal(imported.bg, "#DDEBF7");
  assert.equal(imported.fmt, "$#,##0.00");
  assert.equal(imported.merged, true);
  assert.equal(imported.frozen.ySplit, 1);
  assert.equal(imported.width, 131);
  assert.deepEqual(await extrasState(page), { table: [["Orders", "table-default-2"]], images: 1 });

  step("type a formula into a cell with the keyboard");
  await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").activate());
  await page.keyboard.type("=SUM(B2:B4)");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").getValue() === 60, null, { timeout: 10_000 });

  step("format, sort and filter");
  await page.evaluate(async () => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("B6").setFontWeight("bold").setBackgroundColor("#ffff00");
    sh.getRange("D2:D4").setNumberFormat("#,##0.00");
    await sh.getRange("A2:D4").sort({ column: 1, ascending: true }); // by Units
    const filter = sh.getRange("A1:D4").createFilter();
    filter.setColumnFilterCriteria(0, { colId: 0, filters: { filters: ["West", "North"] } });
  });
  const edited = await page.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    return {
      order: [2, 3, 4].map((r) => sh.getRange(`A${r}`).getValue()),
      totals: [2, 3, 4].map((r) => Number(sh.getRange(`D${r}`).getValue())),
      hidden: sh.getFilter()?.getFilteredOutRows?.(),
    };
  });
  assert.deepEqual(edited.order, ["East", "North", "West"]);
  assert.deepEqual(edited.totals, [40, 60, 75], "formulas follow their rows when sorting");
  assert.deepEqual(edited.hidden, [1], "filter hides East");

  step("download through File > Download as Excel");
  await page.getByRole("button", { name: "File", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByRole("button", { name: /Download as Excel/ }).click()]);
  const out = path.join(tmpdir(), `sheets-e2e-out-${Date.now()}.xlsx`);
  await download.saveAs(out);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(out));
  const ws = wb.getWorksheet("Sales");
  assert.ok(ws, "sheet name survives");
  assert.deepEqual([2, 3, 4].map((r) => ws.getCell(`A${r}`).value), ["East", "North", "West"]);
  assert.equal(ws.getCell("D2").value.formula, "B2*C2");
  assert.equal(ws.getCell("D2").value.result, 40);
  assert.equal(ws.getCell("B6").value.formula, "SUM(B2:B4)");
  assert.equal(ws.getCell("B6").value.result, 60);
  assert.equal(ws.getCell("B6").font.bold, true);
  assert.equal(ws.getCell("B6").fill.fgColor.argb, "FFFFFF00");
  assert.equal(ws.getCell("D3").numFmt, "#,##0.00");
  assert.equal(ws.getCell("C4").numFmt, "$#,##0.00", "number formats move with sorted rows");
  assert.equal(ws.getCell("A1").font.bold, true);
  assert.equal(ws.autoFilter, "A1:D4");
  assert.deepEqual(ws.model.merges, ["F1:G1"]);
  assert.equal(ws.views[0].ySplit, 1);
  assert.equal(ws.getColumn(1).width, 18);
  assert.equal(ws.getCell("A4").note, "best region", "note moved with its row");
  assert.ok(ws.conditionalFormattings.length >= 1, "conditional formatting exported");
  assert.equal(ws.getCell("B4").dataValidation?.type, "whole", "validation moved with its row");
  const zip = await JSZip.loadAsync(await readFile(out));
  assert.match(await zip.file("xl/worksheets/sheet1.xml").async("string"), /<filterColumn colId="0"><filters><filter val="West"\/><filter val="North"\/><\/filters><\/filterColumn>/, "filter conditions exported");
  const extras = wb.getWorksheet("Extras");
  assert.equal(extras.getTables()[0].table.style.theme, "TableStyleMedium7");
  assert.equal(extras.getTables()[0].table.tableRef, "A1:B4");
  assert.equal(extras.getImages().length, 1);
  assert.equal(extras.pageSetup.orientation, "landscape");
  assert.equal(extras.pageSetup.printArea, "A1:B4");

  step("re-open the downloaded file");
  await page.locator('input[type="file"]').setInputFiles(out);
  await page.waitForTimeout(1500);
  const reopened = await page.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    return { b6: sh.getRange("B6").getValue(), a2: sh.getRange("A2").getValue(), filter: !!sh.getFilter() };
  });
  assert.deepEqual(reopened, { b6: 60, a2: "East", filter: true });
  const filterCols = (await resourceIn(page, "SHEET_FILTER_PLUGIN"))[await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheetId())].filterColumns;
  assert.deepEqual(filterCols, [{ colId: 0, filters: { filters: ["West", "North"] } }]);

  step("autosave: reload and find the workbook again");
  await page.waitForTimeout(2500); // debounced save + collab flush
  const titleBefore = await titleBox.inputValue();
  await page.goto(docUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.__univer?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange("B6").getValue() === 60, null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  assert.deepEqual(await extrasState(page), { table: [["Orders", "table-default-2"]], images: 1 }, "table look and picture survive a reload");
  assert.equal(await titleBox.inputValue(), titleBefore, "title survives a reload");

  step("co-editing: a second editor sees the workbook and feature edits live");
  const peer = await browser.newPage();
  peer.on("pageerror", (e) => errors.push(e.message));
  await peer.goto(docUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await peer.waitForFunction(() => window.__univer?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange("B6").getValue() === 60, null, { timeout: 60_000 });
  await page.evaluate(() => {
    const api = window.__univer;
    const sh = api.getActiveWorkbook().getActiveSheet();
    sh.getRange("E2").setValue("synced");
    sh.getRange("C2:C4").setDataValidation(api.newDataValidation().requireNumberBetween(0, 10).build());
    sh.addConditionalFormattingRule(sh.newConditionalFormattingRule().whenNumberLessThan(5).setBackground("#ff0000").setRanges([sh.getRange("C2:C4").getRange()]).build());
  });
  await peer.waitForFunction(
    () => {
      const wb = window.__univer.getActiveWorkbook();
      const snap = wb.save();
      const res = (n) => snap.resources?.find((r) => r.name === n)?.data || "";
      return wb.getActiveSheet().getRange("E2").getValue() === "synced" && res("SHEET_DATA_VALIDATION_PLUGIN").includes("decimal") && res("SHEET_CONDITIONAL_FORMATTING_PLUGIN").includes("lessThan");
    },
    null,
    { timeout: 20_000 },
  );
  await peer.close();

  step("comments: written by signed-in users, a commenter replies, both see it");
  const docId = docUrl.split("/").pop();
  await page.evaluate((id) => fetch(`/api/docs/${id}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "commenter@example.com", role: "commenter" }) }), docId);
  await page.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Sales").activate());
  await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C3").activate());
  await page.getByRole("button", { name: "Insert", exact: true }).first().click();
  await page.getByRole("button", { name: /^Comment/ }).first().click();
  await page.waitForTimeout(500);
  await page.keyboard.type("Is this price right?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const threadsOf = (p) => p.evaluate(async (id) => (await (await fetch(`/api/docs/${id}/comments`)).json()).threads, docId);
  let threads = [];
  for (let i = 0; i < 20 && !threads.length; i++) {
    await page.waitForTimeout(300);
    threads = await threadsOf(page);
  }
  assert.equal(threads.length, 1);
  assert.equal(JSON.parse(threads[0].anchor).ref, "C3");
  assert.equal(threads[0].messages[0].author_email, process.env.DEV_EMAIL || "shane@example.com");
  assert.equal(threads[0].messages[0].body, "Is this price right?");

  const ctx2 = await browser.newContext({ extraHTTPHeaders: { "x-dev-user": "commenter@example.com" }, viewport: { width: 1400, height: 900 } });
  const commenter = await ctx2.newPage();
  commenter.on("pageerror", (e) => errors.push(e.message));
  await commenter.goto(docUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await commenter.waitForFunction(() => window.__univer?.getActiveWorkbook?.()?.getSheetByName?.("Sales"), null, { timeout: 60_000 });
  await commenter.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Sales").activate());
  await commenter.waitForTimeout(1000);
  await commenter.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C3").activate());
  // The title bar tells a commenter what they can do, not "View only" or "editing".
  await commenter.getByText("Can comment", { exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(await commenter.getByText("View only", { exact: true }).count(), 0);
  assert.equal(await commenter.getByText(/\d+ editing/).count(), 0);
  // Presence: the owner sees the commenter in the roster.
  await page.waitForFunction(() => [...document.querySelectorAll("span[title]")].some((e) => /commenter/i.test(e.title) && !/\(you\)/.test(e.title)), null, { timeout: 15_000 });
  await commenter.getByRole("button", { name: "Insert", exact: true }).first().click();
  await commenter.getByRole("button", { name: /^Comment/ }).first().click();
  await commenter.getByText("Is this price right?").waitFor({ timeout: 10_000 });
  await commenter.keyboard.type("Yes, checked.");
  await commenter.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await page.getByText("Yes, checked.").waitFor({ timeout: 15_000 });
  threads = await threadsOf(page);
  assert.deepEqual(threads[0].messages.map((m) => [m.author_email, m.body]), [
    [process.env.DEV_EMAIL || "shane@example.com", "Is this price right?"],
    ["commenter@example.com", "Yes, checked."],
  ]);
  await ctx2.close();

  step("Data > Remove duplicates");
  await page.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("H1:I5").setValues([["Name", "N"], ["a", 1], ["A", 2], ["b", 3], ["a", 4]]);
    sh.getRange("H1:I5").activate();
  });
  await page.getByRole("button", { name: "Data", exact: true }).first().click();
  await page.getByRole("button", { name: /Remove duplicates/ }).click();
  await page.getByRole("checkbox", { name: "N", exact: true }).uncheck();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove duplicates", exact: true }).click();
  await page.waitForTimeout(500);
  const deduped = await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("H1:I5").getValues());
  assert.deepEqual(deduped, [["Name", "N"], ["a", 1], ["b", 3], [null, null], [null, null]]);

  step("Data > Split text to columns");
  await page.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("K1:K2").setValues([["x;y;z"], ["1;2"]]);
    sh.getRange("K1:K2").activate();
  });
  await page.getByRole("button", { name: "Data", exact: true }).first().click();
  await page.getByRole("button", { name: /Split text to columns/ }).click();
  await page.getByRole("radio", { name: "Semicolon" }).check();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page.waitForTimeout(500);
  const split = await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("K1:M2").getValues());
  assert.deepEqual(split.map((r) => r.map(String)), [["x", "y", "z"], ["1", "2", "null"]]);

  step("Data > Group rows: nested groups collapse, expand and reach the .xlsx");
  const visibleRows = () => page.evaluate(() => { const ws = window.__univer.getActiveWorkbook().getActiveSheet().getSheet(); return [19, 20, 21, 22, 23].map((r) => (ws.getRowVisible(r) ? 1 : 0)).join(""); });
  const dataMenu = async (label) => {
    await page.getByRole("button", { name: "Data", exact: true }).first().click();
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  };
  await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A20:A23").activate());
  await dataMenu("Group rows");
  await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A21:A22").activate());
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().scrollToCell?.(14, 0));
  await page.getByRole("button", { name: "Collapse rows 21–22" }).click();
  await page.getByRole("button", { name: "Collapse rows 20–23" }).click();
  await page.waitForFunction(() => !window.__univer.getActiveWorkbook().getActiveSheet().getSheet().getRowVisible(19));
  assert.equal(await visibleRows(), "00001");
  await page.getByRole("button", { name: "Expand rows 20–23" }).click();
  await page.waitForTimeout(300);
  assert.equal(await visibleRows(), "10011", "the inner group stays collapsed");
  await page.getByRole("button", { name: "Show row level 3" }).click();
  await page.waitForTimeout(300);
  assert.equal(await visibleRows(), "11111");
  await page.getByRole("button", { name: "File", exact: true }).click();
  const [grouped] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByRole("button", { name: /Download as Excel/ }).click()]);
  const outlineSheets = await Promise.all((await JSZip.loadAsync(await readFile(await grouped.path()))).file(/worksheets\/sheet\d+\.xml$/).map((f) => f.async("string")));
  assert.ok(outlineSheets.some((x) => /<row\b[^>]*r="21"[^>]*outlineLevel="2"|<row\b[^>]*outlineLevel="2"[^>]*r="21"/.test(x) && /outlineLevelRow="2"/.test(x)), "outline levels exported");

  step("Insert > Pivot table: fields, refresh, saved definition");
  await page.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("P1:R6").setValues([["Region", "Year", "Amount"], ["East", 2024, 100], ["East", 2025, 25], ["West", 2024, 10], ["West", 2025, 7], ["East", 2024, 50]]);
    sh.getRange("Q3").activate();
  });
  const dataSheetId = await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheetId());
  await page.getByRole("button", { name: "Insert", exact: true }).first().click();
  await page.getByRole("button", { name: /^Pivot table/ }).click();
  const panel = page.getByRole("complementary", { name: "Pivot table panel" });
  await panel.getByRole("button", { name: "Region in Rows" }).click();
  await panel.getByRole("button", { name: "Year in Columns" }).click();
  await panel.getByRole("button", { name: "Amount in Values" }).click();
  const pivotCells = () => page.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Pivot 1").getRange("A1:D5").getValues());
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Pivot 1")?.getRange("D5").getValue() === 192);
  assert.deepEqual(await pivotCells(), [["Sum of Amount", "Year", null, null], ["Region", 2024, 2025, "Grand Total"], ["East", 150, 25, 175], ["West", 10, 7, 17], ["Grand Total", 160, 32, 192]]);
  await page.evaluate((id) => window.__univer.getActiveWorkbook().getSheetBySheetId(id).getRange("R2").setValue(1000), dataSheetId);
  await page.getByRole("button", { name: "Data", exact: true }).first().click();
  await page.getByRole("button", { name: "Refresh pivot tables" }).click();
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Pivot 1").getRange("D5").getValue() === 1092);
  const savedPivot = await page.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_PIVOT_PLUGIN").data).pivots[0]);
  assert.deepEqual([savedPivot.rows, savedPivot.columns, savedPivot.values, savedPivot.lastSize], [["Region"], ["Year"], [{ field: "Amount", agg: "sum" }], { rows: 5, columns: 4 }]);
  await panel.getByRole("button", { name: "Close pivot table panel" }).click();

  step("File > Page setup and Print: landscape, repeated header row, PDF");
  await page.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Pivot 1").activate());
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: "Page setup…" }).click();
  const setupDialog = page.getByRole("dialog", { name: "Page setup" });
  await setupDialog.getByRole("radio", { name: "landscape" }).check();
  await setupDialog.getByLabel("Paper size").selectOption("9");
  await setupDialog.getByLabel("Rows to repeat").fill("1:2");
  await setupDialog.getByLabel("Footer center").fill("Page &P of &N");
  await setupDialog.getByRole("button", { name: "Save" }).click();
  const savedSetup = await page.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheet().getCustomMetadata()?.xlsx);
  assert.deepEqual(savedSetup, { pageSetup: { orientation: "landscape", paperSize: 9, printTitlesRow: "1:2" }, headerFooter: { oddFooter: "&CPage &P of &N" } });
  await page.keyboard.press("Control+p");
  const printDialog = page.getByRole("dialog", { name: "Print" });
  await printDialog.getByText("1 page", { exact: true }).waitFor();
  const [pdfDownload] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), printDialog.getByRole("button", { name: "Download PDF" }).click()]);
  const pdfText = new TextDecoder("latin1").decode(await readFile(await pdfDownload.path()));
  assert.ok(pdfText.startsWith("%PDF-"));
  assert.match(pdfText, /\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/, "A4 landscape");
  await printDialog.getByRole("button", { name: "Close" }).click();

  step("Data > Protect range and sheet: enforced for editors, by the browser and the server, and kept in .xlsx");
  for (const [email, role] of [["bob@example.com", "editor"], ["ana@example.com", "editor"]])
    await page.evaluate(([id, e, r]) => fetch(`/api/docs/${id}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, role: r }) }), [docId, email, role]);
  await page.evaluate(() => {
    const wb = window.__univer.getActiveWorkbook();
    const sh = wb.insertSheet("Guarded");
    sh.getRange("A1:C3").setValues([["Item", "Q1", "Q2"], ["Rent", 100, 110], ["Power", 40, 45]]);
    sh.activate();
    sh.getRange("B2:C3").activate();
  });
  await page.getByRole("button", { name: "Data", exact: true }).first().click();
  await page.getByRole("button", { name: "Protect range…" }).click();
  const protectPanel = page.getByRole("complementary", { name: "Protected sheets and ranges" });
  assert.equal(await protectPanel.getByLabel("Protected range").inputValue(), "B2:C3");
  await protectPanel.getByLabel("Description").fill("Budget figures");
  await protectPanel.getByRole("checkbox", { name: "ana@example.com" }).check();
  await protectPanel.getByRole("button", { name: "Save protection" }).click();
  await protectPanel.getByText("Guarded!B2:C3").waitFor();
  const protectionList = (p) => p.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_PROTECTION_PLUGIN")?.data || "{}").protections || []);
  const [rangeProt] = await protectionList(page);
  assert.deepEqual([rangeProt.range, rangeProt.editors, rangeProt.description], [{ startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 }, ["ana@example.com"], "Budget figures"]);

  const asUser = async (email) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-dev-user": email }, viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(docUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await p.waitForFunction(() => window.__univer?.getActiveWorkbook?.()?.getSheetByName?.("Guarded"), null, { timeout: 60_000 });
    await p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").activate());
    await p.waitForTimeout(800);
    return { ctx, p };
  };
  const guarded = (p, a1) => p.evaluate((a) => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange(a).getValue(), a1);
  const bob = await asUser("bob@example.com");
  await bob.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("B2").setValue(999)).catch(() => {});
  await bob.p.getByRole("status").getByText(/protected/).waitFor({ timeout: 5_000 });
  assert.equal(await guarded(bob.p, "B2"), 100, "an editor who isn't listed can't change it");
  await bob.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("D2").setValue("note"));
  await bob.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").insertRows(0, 1));
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("D3").getValue() === "note", null, { timeout: 15_000 });
  assert.deepEqual((await protectionList(page))[0].range, { startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 }, "a row inserted above moves the range for everyone");
  assert.deepEqual((await protectionList(bob.p))[0].range, { startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 });

  const ana = await asUser("ana@example.com");
  await ana.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("B3").setValue(105));
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("B3").getValue() === 105, null, { timeout: 15_000 });
  await ana.ctx.close();

  // A client that skips the browser check: the server refuses the edit and drops the connection.
  const forged = new Y.Doc();
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL || "ws://127.0.0.1:3071";
  // The provider leaves a socket it was handed open (and reconnecting) when
  // destroyed, so the socket is destroyed separately; otherwise it keeps this
  // process alive after the run.
  let forgedSocket;
  let refuseTimer;
  const closeCode = await new Promise((resolve, reject) => {
    forgedSocket = new HocuspocusProviderWebsocket({
      url: collabUrl,
      WebSocketPolyfill: class extends WebSocket {
        constructor(u, p) {
          super(u, p, { headers: { "x-dev-user": "bob@example.com" } });
        }
      },
    });
    const provider = new HocuspocusProvider({
      name: docId,
      document: forged,
      websocketProvider: forgedSocket,
      onSynced: async () => {
        const unitId = await page.evaluate(() => window.__univer.getActiveWorkbook().getId());
        const subUnitId = await page.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getSheetId());
        forged.getArray("ops").push([JSON.stringify({ id: "sheet.mutation.set-range-values", params: { unitId, subUnitId, cellValue: { 2: { 1: { v: 1 } } } } })]);
      },
      onClose: ({ event }) => {
        if (event?.code === 4403) {
          provider.destroy();
          resolve(event.code);
        }
      },
    });
    refuseTimer = setTimeout(() => reject(new Error("the server did not refuse the forged edit")), 15_000);
  }).finally(() => {
    clearTimeout(refuseTimer);
    forgedSocket.destroy();
  });
  assert.equal(closeCode, 4403);
  await page.waitForTimeout(1000);
  assert.equal(await guarded(page, "B3"), 105, "the forged edit reached nobody");

  // The whole sheet, with one column left open.
  await page.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").activate());
  await protectPanel.getByRole("button", { name: "Protect sheet" }).click();
  await protectPanel.getByLabel("Except ranges").fill("E1:E20");
  await protectPanel.getByRole("button", { name: "Save protection" }).click();
  await protectPanel.getByText("Guarded (whole sheet)").waitFor();
  await bob.p.getByRole("button", { name: "Protected sheet" }).waitFor({ timeout: 15_000 });
  await bob.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("A6").setValue("x")).catch(() => {});
  await bob.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").setName("Mine")).catch(() => {});
  await bob.p.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded").getRange("E2").setValue("open"));
  await page.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded")?.getRange("E2").getValue() === "open", null, { timeout: 15_000 });
  assert.equal(await guarded(page, "A6"), null);
  assert.equal(await guarded(bob.p, "A6"), null);
  await bob.ctx.close();

  const [protXlsx] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), (async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("button", { name: "Download as Excel (.xlsx)" }).click();
  })()]);
  const protZip = await JSZip.loadAsync(await readFile(await protXlsx.path()));
  const protWorkbookXml = await protZip.file("xl/workbook.xml").async("string");
  assert.match(protWorkbookXml, /_SynergyProtect1[^>]*hidden="1"[^>]*comment="[^"]*Budget figures/);
  const guardedIndex = (await page.evaluate(() => window.__univer.getActiveWorkbook().getSheets().map((s) => s.getSheetName()))).indexOf("Guarded");
  const guardedXml = await protZip.file(`xl/worksheets/sheet${guardedIndex + 1}.xml`).async("string");
  assert.match(guardedXml, /<sheetProtection[^>]*sheet="1"/);
  assert.match(guardedXml, /<protectedRange[^>]*sqref="E1:E20"/);

  step("the same .xlsx carries the comment thread and the pivot table, and opens with them");
  const threadedPart = Object.keys(protZip.files).find((f) => /^xl\/threadedComments\/.+\.xml$/.test(f));
  assert.ok(threadedPart, "a threaded comments part");
  const threadedXml = await protZip.file(threadedPart).async("string");
  assert.match(threadedXml, /ref="C3"[^>]*><text>Is this price right\?<\/text>/);
  assert.match(threadedXml, /parentId="[^"]+"><text>Yes, checked\.<\/text>/);
  assert.match(await protZip.file("xl/persons/person.xml").async("string"), /userId="commenter@example.com"/);
  assert.match(await protZip.file("xl/pivotTables/pivotTable1.xml").async("string"), /name="Pivot 1"/);
  const fresh = await browser.newPage();
  fresh.on("pageerror", (e) => errors.push(e.message));
  await fresh.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await fresh.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
  const freshId = fresh.url().split("/").pop();
  // File > Open goes by the extension, which a download's temporary path lacks.
  const protFile = path.join(tmpdir(), `sheets-e2e-protected-${Date.now()}.xlsx`);
  await protXlsx.saveAs(protFile);
  await fresh.locator('input[type="file"]').setInputFiles(protFile);
  await fresh.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Guarded"), null, { timeout: 30_000 });
  let freshThreads = [];
  for (let i = 0; i < 60 && !freshThreads.length; i++) {
    await fresh.waitForTimeout(500);
    freshThreads = await fresh.evaluate(async (id) => (await (await fetch(`/api/docs/${id}/comments`)).json()).threads, freshId);
  }
  assert.deepEqual(freshThreads.map((t) => [JSON.parse(t.anchor).ref, t.messages.map((m) => [m.author_name, m.body])]), [["C3", [[threads[0].messages[0].author_name, "Is this price right?"], [threads[0].messages[1].author_name, "Yes, checked."]]]]);
  const freshState = await fresh.evaluate(() => {
    const snap = window.__univer.getActiveWorkbook().save();
    const res = (n) => JSON.parse(snap.resources.find((r) => r.name === n)?.data || "{}");
    return { pivots: res("SHEET_SYNERGY_PIVOT_PLUGIN").pivots?.map((p) => [p.name, p.rows, p.columns]), protections: res("SHEET_SYNERGY_PROTECTION_PLUGIN").protections?.length, notes: Object.keys(res("SHEET_NOTE_PLUGIN")).length };
  });
  assert.deepEqual(freshState.pivots, [["Pivot 1", ["Region"], ["Year"]]]);
  assert.equal(freshState.protections, 2, "the owner opened it, so the protections come along");
  await fresh.close();

  step("sparklines, shapes, trace arrows, show formulas, Goal Seek and scenarios");
  const w = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  w.on("pageerror", (e) => errors.push(e.message));
  await w.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await w.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
  const wUrl = w.url();
  const wMenu = async (top, item) => {
    await w.getByRole("button", { name: top, exact: true }).first().click();
    await w.getByRole("button", { name: item }).first().click();
  };
  const wRes = (name) => w.evaluate((n) => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === n)?.data || "{}"), name);
  await w.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("A1:E3").setValues([
      [1, 4, 2, 5, 3],
      [3, -1, 0, 2, -2],
      [-1, 1, -1, 1, 1],
    ]);
    sh.getRange("A5").setValue(100000);
    sh.getRange("B5").setValue(0.001);
    sh.getRange("C5").setFormula("=A5*B5/(1-(1+B5)^-360)");
    sh.getRange("D5").setFormula("=C5*2+A1");
  });
  const peer2 = await browser.newPage();
  peer2.on("pageerror", (e) => errors.push(e.message));
  await peer2.goto(wUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await peer2.waitForFunction(() => window.__univer?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange("A5").getValue() === 100000, null, { timeout: 60_000 });
  for (const [row, item] of [[1, /^Line sparkline/], [2, /^Column sparkline/], [3, /^Win\/Loss sparkline/]]) {
    await w.evaluate((r) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(`A${r}:E${r}`).activate(), row);
    await wMenu("Insert", item);
    assert.equal(await w.getByLabel("Location range").inputValue(), `F${row}`, "the column next to the data is suggested");
    if (row === 1) await w.getByLabel("High point").check();
    await w.getByRole("button", { name: "OK", exact: true }).click();
  }
  const sparks = await wRes("SHEET_SYNERGY_SPARKLINE_PLUGIN");
  assert.deepEqual(sparks.groups.map((g) => [g.type, g.items.map((i) => [i.row, i.column])]), [["line", [[0, 5]]], ["column", [[1, 5]]], ["winloss", [[2, 5]]]]);
  await peer2.waitForFunction(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_SPARKLINE_PLUGIN")?.data || "{}").groups?.length === 3, null, { timeout: 20_000 });

  await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("H2").activate());
  await wMenu("Insert", /^Shape…/);
  await w.getByLabel("Shape", { exact: true }).selectOption("roundRect");
  await w.getByLabel("Shape text").fill("Total");
  await w.getByRole("button", { name: "OK", exact: true }).click();
  await w.locator("[data-sheet-shape]").first().waitFor({ timeout: 10_000 });
  await peer2.locator("[data-sheet-shape]").first().waitFor({ timeout: 20_000 });
  assert.equal(await peer2.locator("[data-sheet-shape]").first().innerText(), "Total", "a collaborator sees the shape");
  // Double-click opens Format shape.
  const shapeBox = await w.locator("[data-sheet-shape]").first().boundingBox();
  await w.mouse.dblclick(shapeBox.x + shapeBox.width / 2, shapeBox.y + shapeBox.height / 2);
  await w.getByLabel("Shape text").fill("Grand total");
  await w.getByRole("button", { name: "OK", exact: true }).click();
  await peer2.waitForFunction(() => document.querySelector("[data-sheet-shape]")?.textContent === "Grand total", null, { timeout: 20_000 });
  await peer2.close();

  // Show formulas changes what is drawn, not the values.
  await w.keyboard.press("Control+Backquote");
  await w.getByRole("button", { name: "Formulas", exact: true }).first().click();
  assert.match(await w.getByRole("button", { name: /Show formulas/ }).innerText(), /✓/);
  await w.getByRole("button", { name: "Formulas", exact: true }).first().click(); // closes the menu
  await w.getByRole("button", { name: /Show formulas/ }).waitFor({ state: "detached", timeout: 5_000 });
  assert.ok(Math.abs((await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C5").getValue())) - 330.9087) < 0.001);
  await w.keyboard.press("Control+Backquote");

  await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("D5").activate());
  await wMenu("Formulas", /^Trace precedents/);
  await w.waitForFunction(() => document.querySelectorAll("[data-trace-arrow]").length === 2, null, { timeout: 5_000 });
  await wMenu("Formulas", /^Trace precedents/);
  await w.waitForFunction(() => document.querySelectorAll("[data-trace-arrow]").length === 4, null, { timeout: 5_000 });
  await wMenu("Formulas", /^Remove arrows/);
  await w.waitForFunction(() => document.querySelectorAll("[data-trace-arrow]").length === 0, null, { timeout: 5_000 }).catch(async () =>
    assert.fail(`arrows left after Remove arrows: ${await w.locator("[data-trace-arrow]").count()}`),
  );
  await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B5").activate());
  await wMenu("Formulas", /^Trace dependents/);
  await w.waitForFunction(() => document.querySelectorAll("[data-trace-arrow]").length === 1, null, { timeout: 5_000 });
  await wMenu("Formulas", /^Remove arrows/);

  await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C5").activate());
  await wMenu("Data", /^Goal Seek/);
  assert.equal(await w.getByLabel("Set cell").inputValue(), "C5");
  await w.getByLabel("To value").fill("600");
  await w.getByLabel("By changing cell").fill("B5");
  await w.getByRole("button", { name: "OK", exact: true }).click();
  await w.getByRole("status").filter({ hasText: "found a solution" }).waitFor({ timeout: 60_000 });
  await w.getByRole("button", { name: "OK", exact: true }).click();
  const solved = await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B5").getValue());
  assert.ok(Math.abs(solved - 0.005006) < 0.00001, `goal seek found ${solved}`);
  await w.evaluate(() => window.__univer.undo());
  await w.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B5").getValue() === 0.001, null, { timeout: 5_000 });

  await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A5:B5").activate());
  await wMenu("Data", /^Scenario Manager/);
  for (const [scenario, units, rate] of [["Cheap money", "100000", "0.002"], ["Dear money", "100000", "0.008"]]) {
    await w.getByRole("button", { name: "Add…" }).click();
    await w.getByLabel("Scenario name").fill(scenario);
    assert.equal(await w.getByLabel("Changing cells").inputValue(), "A5:B5");
    await w.getByRole("button", { name: "Next", exact: true }).click();
    await w.getByLabel("Value for A5").fill(units);
    await w.getByLabel("Value for B5").fill(rate);
    await w.getByRole("button", { name: "OK", exact: true }).click();
  }
  await w.getByRole("button", { name: "Summary…" }).click();
  await w.getByLabel("Result cells").fill("C5");
  await w.getByRole("button", { name: "OK", exact: true }).click();
  await w.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheetName() === "Scenario Summary", null, { timeout: 30_000 });
  const summaryRows = await w.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1:E6").getValues());
  assert.deepEqual(summaryRows[0].slice(2), ["Current Values:", "Cheap money", "Dear money"]);
  assert.deepEqual(summaryRows[3].slice(1), ["B5", 0.001, 0.002, 0.008]);
  assert.equal(summaryRows[5][1], "C5");
  assert.ok(Math.abs(summaryRows[5][3] - 389.94) < 0.01 && Math.abs(summaryRows[5][4] - 848.16) < 0.01, JSON.stringify(summaryRows[5]));
  assert.equal(await w.evaluate(() => window.__univer.getActiveWorkbook().getSheets()[0].getRange("B5").getValue()), 0.001, "the model is put back");

  step("sparklines, shapes and scenarios in the downloaded .xlsx, and back");
  await w.getByRole("button", { name: "File", exact: true }).click();
  const [whatIfXlsx] = await Promise.all([w.waitForEvent("download", { timeout: 120_000 }), w.getByRole("button", { name: /Download as Excel/ }).click()]);
  const whatIfFile = path.join(tmpdir(), `sheets-e2e-whatif-${Date.now()}.xlsx`);
  await whatIfXlsx.saveAs(whatIfFile);
  const whatIfZip = await JSZip.loadAsync(await readFile(whatIfFile));
  const sheet1 = await whatIfZip.file("xl/worksheets/sheet1.xml").async("string");
  assert.equal((sheet1.match(/<x14:sparklineGroup\b/g) || []).length, 3);
  assert.match(sheet1, /<scenarios [^>]*><scenario name="Cheap money"/);
  const drawing1 = await whatIfZip.file("xl/drawings/drawing1.xml").async("string");
  assert.match(drawing1, /<a:prstGeom prst="roundRect">[\s\S]*<a:t>Grand total<\/a:t>/);
  await w.locator('input[type="file"]').setInputFiles(whatIfFile);
  await w.waitForFunction(() => window.__univer.getActiveWorkbook().getSheets().length === 2 && document.querySelectorAll("[data-sheet-shape]").length === 1, null, { timeout: 30_000 });
  const whatIfBack = await w.evaluate(() => {
    const snap = window.__univer.getActiveWorkbook().save();
    const res = (n) => JSON.parse(snap.resources.find((r) => r.name === n)?.data || "{}");
    return { sparks: res("SHEET_SYNERGY_SPARKLINE_PLUGIN").groups?.map((g) => g.type), scenarios: res("SHEET_SYNERGY_SCENARIO_PLUGIN").scenarios?.map((x) => x.name) };
  });
  assert.deepEqual(whatIfBack, { sparks: ["line", "column", "winloss"], scenarios: ["Cheap money", "Dear money"] });
  await w.close();

  step("Data > Data table and Solver: worked out on the live sheet, kept in .xlsx");
  const a = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await a.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
  const aMenu = async (top, item) => {
    await a.getByRole("button", { name: top, exact: true }).first().click();
    await a.getByRole("button", { name: item }).first().click();
  };
  const aVals = (ref) => a.evaluate((r) => window.__univer.getActiveWorkbook().getSheets()[0].getRange(r).getValues().flat(), ref);
  await a.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("B1").setValue(2);
    sh.getRange("C1").setFormula("=B1*B1");
    sh.getRange("B3").setFormula("=C1");
    sh.getRange("A4:A6").setValues([[1], [2], [3]]);
    sh.getRange("A3:B6").activate();
  });
  await aMenu("Data", /^Data table/);
  await a.getByLabel("Column input cell").fill("B1");
  await a.getByRole("button", { name: "OK", exact: true }).click();
  await a.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").getValue() === 9, null, { timeout: 30_000 });
  assert.deepEqual(await aVals("B4:B6"), [1, 4, 9]);
  assert.equal((await aVals("B1"))[0], 2, "the input cell is put back");
  // Like Excel's automatic calculation: an edit works the table out again.
  await a.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C1").setFormula("=B1*B1*10"));
  await a.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").getValue() === 90, null, { timeout: 30_000 });
  assert.deepEqual(await aVals("B4:B6"), [10, 40, 90]);

  // Maximise 3x + 2y with x + y <= 4, x + 3y <= 6, x <= 3, y whole.
  await a.evaluate(() => {
    const sh = window.__univer.getActiveWorkbook().getActiveSheet();
    sh.getRange("D1:E1").setValues([[0, 0]]);
    sh.getRange("F1").setFormula("=3*D1+2*E1");
    sh.getRange("G1").setFormula("=D1+E1");
    sh.getRange("H1").setFormula("=D1+3*E1");
    sh.getRange("F1").activate();
  });
  await aMenu("Data", /^Solver/);
  assert.equal(await a.getByLabel("Set objective").inputValue(), "$F$1");
  await a.getByLabel("By changing variable cells").fill("$D$1:$E$1");
  for (const [lhs, op, rhs] of [["G1", "<=", "4"], ["H1", "<=", "6"], ["D1", "<=", "3"], ["E1", "int", ""]]) {
    await a.getByRole("button", { name: "Add constraint" }).click();
    await a.getByLabel("Cell reference").fill(lhs);
    await a.getByLabel("Relation").selectOption(op);
    if (rhs) await a.getByLabel("Constraint", { exact: true }).fill(rhs);
    await a.getByRole("button", { name: "Add", exact: true }).click();
  }
  await a.getByRole("button", { name: "Solve", exact: true }).click();
  // Each trial waits on the live sheet to recalculate, which is slow on a busy machine.
  await a.getByRole("status").filter({ hasText: /^Solver (found|could|stopped)/ }).first().waitFor({ timeout: 180_000 });
  assert.match(await a.getByRole("status").filter({ hasText: /^Solver / }).first().innerText(), /Solver found a solution/);
  assert.equal(await a.getByLabel("Objective value").innerText(), "11");
  assert.deepEqual(await aVals("D1:E1"), [0, 0], "the tries are put back until the answer is kept");
  await a.getByRole("button", { name: "Keep Solver solution" }).click();
  await a.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("F1").getValue() === 11, null, { timeout: 10_000 });
  assert.deepEqual(await aVals("D1:E1"), [3, 1]);
  await a.evaluate(() => window.__univer.undo());
  await a.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("F1").getValue() === 0, null, { timeout: 5_000 });
  const model = (await a.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_SOLVER_PLUGIN")?.data || "{}"))).models?.[0];
  assert.equal(model?.constraints?.length, 4, "the model is kept with the workbook");

  await a.getByRole("button", { name: "File", exact: true }).click();
  const [analysisXlsx] = await Promise.all([a.waitForEvent("download", { timeout: 120_000 }), a.getByRole("button", { name: /Download as Excel/ }).click()]);
  const analysisFile = path.join(tmpdir(), `sheets-e2e-analysis-${Date.now()}.xlsx`);
  await analysisXlsx.saveAs(analysisFile);
  const analysisZip = await JSZip.loadAsync(await readFile(analysisFile));
  assert.match(await analysisZip.file("xl/worksheets/sheet1.xml").async("string"), /<c r="B4"[^>]*><f t="dataTable" ref="B4:B6" dt2D="0" dtr="0" r1="B1"\/>/);
  const analysisBook = await analysisZip.file("xl/workbook.xml").async("string");
  assert.match(analysisBook, /<definedName name="solver_opt" localSheetId="0" hidden="1">[^<]*\$F\$1<\/definedName>/);
  assert.match(analysisBook, /<definedName name="solver_rel4" localSheetId="0" hidden="1">4<\/definedName>/);
  await a.locator('input[type="file"]').setInputFiles(analysisFile);
  await a.waitForFunction(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_SOLVER_PLUGIN")?.data || "{}").models?.length === 1 && window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").getValue() === 90, null, { timeout: 30_000 });
  const tablesBack = await a.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_DATA_TABLE_PLUGIN")?.data || "{}").tables?.length);
  assert.equal(tablesBack, 1);
  await a.close();

  step("Data > Get data: CSV from the web and JSON from a file, refreshed, kept in .xlsx as connections");
  let feedRows = [["Item", "Price", "Notes"], ["Tea", "1.50", "x"], ["Coffee", "2.25", "y"], ["Cocoa", "3", "z"]];
  const feed = http.createServer((req, res) => {
    if (req.url === "/prices.csv") return void res.writeHead(200, { "content-type": "text/csv" }).end(feedRows.map((r) => r.join(",")).join("\n"));
    res.writeHead(404).end();
  });
  await new Promise((r) => feed.listen(0, "127.0.0.1", r));
  const feedUrl = `http://127.0.0.1:${feed.address().port}/prices.csv`;
  const g = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  g.on("pageerror", (e) => errors.push(e.message));
  try {
    await g.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await g.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const gMenu = async (top, item) => {
      await g.getByRole("button", { name: top, exact: true }).first().click();
      await g.getByRole("button", { name: item }).first().click();
    };
    const gRes = () => g.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_QUERY_PLUGIN")?.data || "{}").queries || []);
    const cellsOf = (sheet, ref) => g.evaluate(([s, r]) => window.__univer.getActiveWorkbook().getSheetByName(s).getRange(r).getValues(), [sheet, ref]);
    await gMenu("Data", /^Get data/);
    // The server won't fetch from private networks (the cloud metadata address here).
    await g.getByLabel("Web address").fill("http://169.254.169.254/latest/meta-data/");
    await g.getByRole("button", { name: "Load", exact: true }).first().click();
    await g.getByRole("alert").filter({ hasText: "private or local network" }).waitFor({ timeout: 30_000 });
    await g.getByLabel("Web address").fill(feedUrl);
    await g.getByRole("button", { name: "Load", exact: true }).first().click();
    const webOk = await Promise.race([
      g.getByRole("table", { name: "Preview" }).waitFor({ timeout: 30_000 }).then(() => true),
      g.getByRole("alert").filter({ hasText: "private or local network" }).waitFor({ timeout: 30_000 }).then(() => false),
    ]);
    if (webOk) {
      await g.getByLabel("Keep column Notes").uncheck();
      assert.equal(await g.getByLabel("Query name").inputValue(), "prices");
      await g.getByLabel("Query name").fill("Prices");
      await g.getByRole("button", { name: "Load", exact: true }).last().click();
      await g.waitForFunction(() => !!window.__univer.getActiveWorkbook().getSheetByName("Prices")?.getRange("B4").getValue(), null, { timeout: 30_000 });
      assert.deepEqual(await cellsOf("Prices", "A1:B4"), [["Item", "Price"], ["Tea", 1.5], ["Coffee", 2.25], ["Cocoa", 3]]);
      assert.deepEqual((await cellsOf("Prices", "C1:C4")).flat().filter((v) => v !== "" && v != null), [], "the Notes column was left out");
      // The source changes; Refresh all fetches it again and clears the rows that went away.
      feedRows = [["Item", "Price", "Notes"], ["Tea", "1.75", "x"]];
      await gMenu("Data", /^Refresh all queries/);
      await g.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Prices").getRange("B2").getValue() === 1.75, null, { timeout: 30_000 });
      assert.deepEqual((await cellsOf("Prices", "A3:B4")).flat().filter((v) => v !== "" && v != null), []);
    } else console.log("  (web import from a local server skipped: start the app with IMPORT_ALLOW_HOSTS=127.0.0.1)");
    await g.getByRole("button", { name: "Cancel" }).click().catch(() => {});

    await g.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      wb.setActiveSheet(wb.getSheets()[0]);
      wb.getSheets()[0].getRange("D2").activate();
    });
    await gMenu("Data", /^Get data/);
    await g.getByRole("tab", { name: "From file" }).click();
    await g.getByLabel("Data file").setInputFiles({ name: "team.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ team: [{ name: "Ann", age: 31, city: { name: "Leeds" } }, { name: "Bo", age: 27, city: { name: "York" } }] })) });
    await g.getByRole("table", { name: "Preview" }).waitFor({ timeout: 10_000 });
    await g.getByLabel("At", { exact: true }).check();
    assert.equal(await g.getByLabel("Destination cell").inputValue(), "D2");
    await g.getByRole("button", { name: "Load", exact: true }).last().click();
    await g.waitForFunction(() => window.__univer.getActiveWorkbook().getSheets()[0].getRange("F4").getValue() === "York", null, { timeout: 30_000 });
    const sheet0 = await g.evaluate(() => window.__univer.getActiveWorkbook().getSheets()[0].getSheetName());
    assert.deepEqual(await cellsOf(sheet0, "D2:F4"), [["name", "age", "city.name"], ["Ann", 31, "Leeds"], ["Bo", 27, "York"]]);
    const queries = await gRes();
    assert.deepEqual(queries.map((q) => [q.name, q.source.kind, q.size]), [...(webOk ? [["Prices", "web", { rows: 2, columns: 2 }]] : []), ["team", "file", { rows: 3, columns: 3 }]]);
    await gMenu("Data", /^Queries and connections/);
    await g.getByRole("list", { name: "Queries" }).getByText("team.json").waitFor({ timeout: 5_000 });
    await g.getByRole("button", { name: "Close", exact: true }).click();

    await g.getByRole("button", { name: "File", exact: true }).click();
    const [queryXlsx] = await Promise.all([g.waitForEvent("download", { timeout: 120_000 }), g.getByRole("button", { name: /Download as Excel/ }).click()]);
    const queryFile = path.join(tmpdir(), `sheets-e2e-queries-${Date.now()}.xlsx`);
    await queryXlsx.saveAs(queryFile);
    const queryZip = await JSZip.loadAsync(await readFile(queryFile));
    const conns = await queryZip.file("xl/connections.xml").async("string");
    assert.equal((conns.match(/<connection /g) || []).length, queries.length);
    if (webOk) assert.match(conns, /type="4"[^>]*><webPr textDates="1" url="http:\/\/127\.0\.0\.1:\d+\/prices\.csv"/);
    assert.match(conns, /<textPr codePage="65001" sourceFile="team.json"/);
    await g.locator('input[type="file"]').first().setInputFiles(queryFile);
    await g.waitForFunction((n) => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_QUERY_PLUGIN")?.data || "{}").queries?.length === n && window.__univer.getActiveWorkbook().getSheets()[0].getRange("F4").getValue() === "York", queries.length, { timeout: 30_000 });
    assert.deepEqual((await gRes()).map((q) => q.name), queries.map((q) => q.name));
  } finally {
    feed.close();
    await g.close();
  }

  step("slicers and a timeline filter a table and a pivot table; a pivot chart follows the pivot; all kept in .xlsx");
  const sl = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  sl.on("pageerror", (e) => errors.push(e.message));
  try {
    await sl.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await sl.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const slMenu = async (top, item) => {
      await sl.getByRole("button", { name: top, exact: true }).first().click();
      await sl.getByRole("button", { name: item }).first().click();
    };
    const slRes = (n) => sl.evaluate((name) => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === name)?.data || "{}"), n);
    // 2024-01-15, 2024-02-10, 2024-02-20, 2024-04-05 as Excel serial dates.
    await sl.evaluate(async () => {
      const wb = window.__univer.getActiveWorkbook();
      const sh = wb.getActiveSheet();
      sh.getRange("A1:C5").setValues([
        ["Region", "Date", "Sales"],
        ["West", 45306, 10],
        ["East", 45332, 20],
        ["West", 45342, 30],
        ["North", 45387, 40],
      ]);
      await sh.addTable("Sales", { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 });
      const sheetId = sh.getSheetId();
      const pivot = { id: "pv1", name: "Pivot 1", source: { sheetId, range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 } }, target: { sheetId, row: 7, column: 0 }, rows: ["Region"], columns: [], values: [{ field: "Sales", agg: "sum" }], filters: [] };
      await window.__univer.executeCommand("sheet.mutation.set-pivot-tables", { unitId: wb.getId(), value: [pivot] });
      sh.getRange("B3").activate();
    });
    await slMenu("Data", /^Refresh pivot tables/);
    await sl.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B12").getValue() === 100, null, { timeout: 10_000 });

    await slMenu("Insert", /^Slicer…/);
    assert.match(await sl.getByLabel("Table or pivot table").inputValue(), /^table:/, "the table under the selection is offered");
    await sl.getByLabel("Field Region").check();
    await sl.getByRole("button", { name: "OK", exact: true }).click();
    const regionSlicer = sl.getByRole("group", { name: "Slicer Region" });
    await regionSlicer.waitFor({ timeout: 10_000 });
    await regionSlicer.getByRole("button", { name: "West", exact: true }).click();
    await sl.waitForFunction(() => {
      const t = JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_TABLE_PLUGIN")?.data || "{}");
      const table = Object.values(t)[0]?.tables?.[0];
      return JSON.stringify(table?.filters?.tableColumnFilterList?.[0]?.values) === '["West"]';
    }, null, { timeout: 10_000 });
    assert.equal(await regionSlicer.getByRole("button", { name: "East", exact: true }).getAttribute("aria-pressed"), "false");

    // Pivot chart, then a timeline on the pivot's Date field.
    await sl.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A9").activate());
    await slMenu("Insert", /^Pivot chart/);
    const chartOf = async () => (await slRes("SHEET_SYNERGY_CHARTS_PLUGIN")).sheets?.[await sl.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheetId())]?.[0];
    await sl.waitForFunction(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_CHARTS_PLUGIN")?.data || "{}").sheets, null, { timeout: 10_000 });
    let chart = await chartOf();
    assert.equal(chart.pivotId, "pv1");
    assert.deepEqual([chart.series[0].categories.startRow, chart.series[0].categories.endRow], [8, 10], "East, North, West");
    await slMenu("Insert", /^Timeline…/);
    assert.equal(await sl.getByLabel("Table or pivot table").inputValue(), "pivot:pv1");
    await sl.getByLabel("Field Date").check();
    await sl.getByRole("button", { name: "OK", exact: true }).click();
    const timeline = sl.getByRole("group", { name: "Timeline Date" });
    await timeline.waitFor({ timeout: 10_000 });
    await timeline.getByRole("button", { name: "2024-02", exact: true }).click();
    // February only: East 20 and West 30.
    await sl.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B11").getValue() === 50, null, { timeout: 10_000 });
    assert.deepEqual(await sl.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A9:B11").getValues()), [["East", 20], ["West", 30], ["Grand Total", 50]]);
    assert.equal(await timeline.getByLabel("Timeline selection").innerText(), "2024-02");
    chart = await chartOf();
    assert.deepEqual([chart.series[0].categories.startRow, chart.series[0].categories.endRow], [8, 9], "the pivot chart follows the pivot");

    await sl.getByRole("button", { name: "File", exact: true }).click();
    const [slXlsx] = await Promise.all([sl.waitForEvent("download", { timeout: 120_000 }), sl.getByRole("button", { name: /Download as Excel/ }).click()]);
    const slFile = path.join(tmpdir(), `sheets-e2e-slicers-${Date.now()}.xlsx`);
    await slXlsx.saveAs(slFile);
    const slZip = await JSZip.loadAsync(await readFile(slFile));
    assert.match(await slZip.file("xl/workbook.xml").async("string"), /name="_SynergySlicer2"/);
    await sl.locator('input[type="file"]').first().setInputFiles(slFile);
    await sl.waitForFunction(() => document.querySelectorAll("[data-sheet-slicer]").length === 2 && window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").getValue() === "Region", null, { timeout: 30_000 });
    await sl.getByRole("group", { name: "Timeline Date" }).getByLabel("Timeline selection").filter({ hasText: "2024-02" }).waitFor({ timeout: 10_000 });
  } finally {
    await sl.close();
  }

  step("Automate: a sandboxed script, the action recorder, and .xlsm macros kept as they are");
  const au = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  au.on("pageerror", (e) => errors.push(e.message));
  try {
    await au.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await au.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const auMenu = async (top, item) => {
      await au.getByRole("button", { name: top, exact: true }).first().click();
      await au.getByRole("button", { name: item }).first().click();
    };
    const auCell = (ref, sheet) => au.evaluate(([r, s]) => (s ? window.__univer.getActiveWorkbook().getSheetByName(s) : window.__univer.getActiveWorkbook().getActiveSheet()).getRange(r).getValue(), [ref, sheet]);
    await au.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1:B3").setValues([["Item", "Qty"], ["Tea", 2], ["Cake", 5]]));
    await auMenu("Automate", /^Scripts/);
    const panel = au.getByRole("complementary", { name: "Automate panel" });
    await panel.getByLabel("Script name").fill("Totals");
    await panel.getByLabel("Script code").fill(`function main(workbook: ExcelScript.Workbook) {
  const sheet = workbook.getActiveWorksheet();
  const rows = sheet.getUsedRange().getValues().slice(1);
  const total = rows.reduce((s, r) => s + r[1], 0);
  sheet.getRange("A4:B4").setValues([["Total", total]]);
  sheet.getRange("A4:B4").getFormat().getFont().setBold(true);
  console.log("total is", total, typeof fetch);
}`);
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await panel.getByRole("status", { name: "Script output" }).filter({ hasText: "Script finished" }).waitFor({ timeout: 20_000 });
    assert.match(await panel.getByRole("status", { name: "Script output" }).innerText(), /total is 7 undefined/, "no network APIs in the sandbox");
    assert.deepEqual([await auCell("A4"), await auCell("B4")], ["Total", 7]);
    assert.equal(await au.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B4").getCellStyleData()?.bl), 1);
    // A failing script changes nothing.
    await panel.getByLabel("Script code").fill(`function main(workbook) { workbook.getActiveWorksheet().getRange("C1").setValue(1); throw new Error("stop here"); }`);
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await panel.getByRole("status", { name: "Script output" }).filter({ hasText: "Error: stop here" }).waitFor({ timeout: 20_000 });
    assert.equal(await auCell("C1"), null);

    await panel.getByRole("button", { name: "Record actions" }).click();
    await au.evaluate(async () => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("D1").setValue("Checked");
      sh.getRange("D2").setFormula("=B2*10");
      sh.getRange("D1").activate();
      await window.__univer.executeCommand("sheet.command.set-bold");
    });
    await panel.getByRole("button", { name: "Stop recording" }).click();
    const recordedCode = await panel.getByLabel("Script code").inputValue();
    assert.match(recordedCode, /sheet\.getRange\("D1"\)\.setValue\("Checked"\);/);
    assert.match(recordedCode, /sheet\.getRange\("D2"\)\.setFormula\("=B2\*10"\);/);
    assert.match(recordedCode, /sheet\.getRange\("D1"\)\.getFormat\(\)\.getFont\(\)\.setBold\(true\);/);
    // The recording replays on a fresh sheet.
    await au.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("D1:D2").setValues([[null], [null]]));
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await au.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("D2").getValue() === 20, null, { timeout: 20_000 });
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    const scripts = await au.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_SCRIPT_PLUGIN")?.data || "{}").scripts);
    assert.equal(scripts.length, 2);

    // An .xlsm: the VBA project comes back byte for byte, in an .xlsm.
    const xb = new ExcelJS.Workbook();
    xb.addWorksheet("Macro").getCell("A1").value = "hi";
    const xz = await JSZip.loadAsync(await xb.xlsx.writeBuffer());
    const vba = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 13) % 256));
    xz.file("xl/vbaProject.bin", vba);
    xz.file("xl/_rels/workbook.xml.rels", (await xz.file("xl/_rels/workbook.xml.rels").async("string")).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));
    xz.file("[Content_Types].xml", (await xz.file("[Content_Types].xml").async("string")).replace("</Types>", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'));
    const xlsmIn = path.join(tmpdir(), `sheets-e2e-macro-${Date.now()}.xlsm`);
    await writeFile(xlsmIn, await xz.generateAsync({ type: "nodebuffer" }));
    await au.locator('input[type="file"]').first().setInputFiles(xlsmIn);
    await au.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").getValue() === "hi", null, { timeout: 30_000 });
    await au.getByRole("button", { name: "File", exact: true }).click();
    const [xlsmOut] = await Promise.all([au.waitForEvent("download", { timeout: 120_000 }), au.getByRole("button", { name: /Download as Excel/ }).click()]);
    assert.match(xlsmOut.suggestedFilename(), /\.xlsm$/);
    const outZip = await JSZip.loadAsync(await readFile(await xlsmOut.path()));
    assert.ok(Buffer.from(await outZip.file("xl/vbaProject.bin").async("uint8array")).equals(vba), "the VBA project is untouched");
    assert.match(await outZip.file("[Content_Types].xml").async("string"), /sheet\.macroEnabled\.main\+xml/);
  } finally {
    await au.close();
  }


  step("Formulas: dynamic arrays spill, A1# follows the spill, iterative calculation; all kept in .xlsx");
  const da = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  da.on("pageerror", (e) => errors.push(e.message));
  try {
    await da.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await da.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const daMenu = async (top, item) => {
      await da.getByRole("button", { name: top, exact: true }).first().click();
      await da.getByRole("button", { name: item }).first().click();
    };
    const daVals = (ref) => da.evaluate((r) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(r).getValues().flat(), ref);
    await da.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("A1:A5").setValues([[3], [1], [2], [3], [5]]);
      sh.getRange("C1").setFormula("=SORT(UNIQUE(A1:A5))");
      sh.getRange("D1").setFormula("=SEQUENCE(2,3)");
      sh.getRange("E4").setFormula("=LET(x,A1*10,x+1)");
      sh.getRange("F4").setFormula("=MAP(A1:A2,LAMBDA(v,v+100))");
      sh.getRange("H1").setFormula("=SUM(C1#)");
      sh.getRange("H3").setFormula("=FILTER(A1:A5,A1:A5>2)");
    });
    // A spill reference typed in the cell editor.
    // Typing can race the editor on a busy machine, so try a few times.
    for (let attempt = 1; ; attempt++) {
      await da.bringToFront();
      await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("H2").activate());
      await da.waitForTimeout(500 * attempt);
      await da.keyboard.type("=ROWS(C1#)", { delay: 30 });
      await da.keyboard.press("Enter");
      const ok = await da
        .waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("H2").getValue() === 4, null, { timeout: 15_000 })
        .then(() => true, () => false);
      if (ok) break;
      if (attempt === 3) throw new Error(`H2 is ${JSON.stringify(await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("H2").getFormula() || window.__univer.getActiveWorkbook().getActiveSheet().getRange("H2").getValue()))}, not =ROWS(C1#) giving 4`);
      await da.keyboard.press("Escape");
    }
    assert.deepEqual(await daVals("C1:C4"), [1, 2, 3, 5]);
    assert.deepEqual(await daVals("D1:F2"), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(await daVals("E4:F5"), [31, 103, null, 101]);
    assert.deepEqual(await daVals("H1:H5"), [11, 4, 3, 3, 5]);
    // The spill grows, and the spill reference follows it.
    await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A6").setValue(8));
    await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C1").setFormula("=SORT(UNIQUE(A1:A6))"));
    await da.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("H2").getValue() === 5, null, { timeout: 30_000 });
    assert.equal((await daVals("H1"))[0], 19);

    // A circular reference: a warning, then iterative calculation.
    await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("J1").setFormula("=J1+1"));
    await da.getByText(/There's a circular reference/).waitFor({ timeout: 30_000 });
    await daMenu("Formulas", /^Calculation options/);
    await da.getByLabel("Enable iterative calculation").check();
    await da.getByLabel("Maximum iterations").fill("10");
    await da.getByRole("button", { name: "OK", exact: true }).click();
    await da.waitForFunction(() => Number(window.__univer.getActiveWorkbook().getActiveSheet().getRange("J1").getValue()) >= 10, null, { timeout: 30_000 });

    await da.getByRole("button", { name: "File", exact: true }).click();
    const [daOut] = await Promise.all([da.waitForEvent("download", { timeout: 120_000 }), da.getByRole("button", { name: /Download as Excel/ }).click()]);
    const daZip = await JSZip.loadAsync(await readFile(await daOut.path()));
    const daXml = await daZip.file("xl/worksheets/sheet1.xml").async("string");
    assert.match(daXml, /<c r="C1" cm="1"><f t="array" ref="C1:C5">_xlfn._xlws.SORT\(_xlfn.UNIQUE\(A1:A6\)\)<\/f><v>1<\/v><\/c>/);
    assert.match(daXml, /<c r="C5"><v>8<\/v><\/c>/, "spilled values are in the file");
    assert.match(daXml, /<f>ROWS\(_xlfn.ANCHORARRAY\(C1\)\)<\/f>/);
    assert.match(daXml, /<f>_xlfn.LET\(_xlpm.x,A1\*10,_xlpm.x\+1\)<\/f>/);
    assert.match(daXml, /_xlfn.MAP\(A1:A2,_xlfn.LAMBDA\(_xlpm.v,_xlpm.v\+100\)\)/);
    assert.ok(daZip.file("xl/metadata.xml"), "dynamic-array metadata");
    assert.match(await daZip.file("xl/workbook.xml").async("string"), /<calcPr[^>]* iterate="1" iterateCount="10"/);
    // Opened again, the formulas spill and the setting is back.
    const daIn = path.join(tmpdir(), `sheets-e2e-spill-${Date.now()}.xlsx`);
    await writeFile(daIn, await daZip.generateAsync({ type: "nodebuffer" }));
    await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1:J8").clear());
    await da.locator('input[type="file"]').first().setInputFiles(daIn);
    await da.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C5").getValue() === 8, null, { timeout: 30_000 });
    assert.deepEqual(await daVals("C1:C5"), [1, 2, 3, 5, 8]);
    assert.deepEqual(await daVals("H1:H5"), [19, 5, 3, 3, 5]);
    const calc = await da.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_CALC_SETTINGS")?.data || "{}"));
    assert.equal(calc.iterate, true);
    assert.equal(calc.maxIterations, 10);

    step("File > Version history: named and automatic versions, preview and restore");
    da.on("dialog", (d) => d.accept());
    await daMenu("File", /^Version history/);
    const vp = da.getByTestId("sheet-versions");
    await vp.getByTestId("sheet-version-name").fill("With spills");
    await vp.getByTestId("sheet-version-save").click();
    await vp.locator('[data-testid="sheet-version-item"][data-label="With spills"]').waitFor({ timeout: 20_000 });
    await da.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").setValue("changed"));
    await vp.locator('[data-testid="sheet-version-item"][data-label="With spills"]').click();
    const grid = vp.getByTestId("sheet-version-grid");
    await grid.waitFor();
    assert.equal(await grid.locator("tbody tr").first().locator("td").nth(1).innerText(), "3", "the preview shows the version's cells");
    assert.match(await vp.getByTestId("sheet-version-diff").innerText(), /cells? differ from now/);
    await vp.getByTestId("sheet-version-restore").click();
    await da.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").getValue() === 3, null, { timeout: 30_000 });
    await vp.locator('[data-testid="sheet-version-item"][data-label="Before restore"]').waitFor({ timeout: 20_000 });
  } finally {
    await da.close();
  }


  step("Flash Fill, cell styles and workbook themes, and split panes; kept in .xlsx");
  const ff = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  ff.on("pageerror", (e) => errors.push(e.message));
  try {
    await ff.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await ff.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    await ff.bringToFront();
    const ffMenu = async (top, item) => {
      await ff.getByRole("button", { name: top, exact: true }).first().click();
      await ff.getByRole("button", { name: item }).first().click();
    };
    const ffVals = (ref) => ff.evaluate((r) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(r).getValues().flat(), ref);
    await ff.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("A1:B5").setValues([["Name", "Short"], ["John Smith", "Smith, J."], ["Mary Ann Lee", null], ["Ravi Patel", null], ["Jo Wu", null]]);
      sh.getRange("B2").activate();
    });
    // Ctrl+E, as in Excel.
    await ff.waitForTimeout(300);
    await ff.keyboard.press("Control+e");
    await ff.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B5").getValue() === "Wu, J.", null, { timeout: 20_000 });
    assert.deepEqual(await ffVals("B1:B5"), ["Short", "Smith, J.", "Lee, M.", "Patel, R.", "Wu, J."]);
    await ff.getByText("Flash Fill changed 3 cells.").waitFor({ timeout: 10_000 });
    // One undo takes the whole fill back.
    await ff.evaluate(() => window.__univer.undo());
    await ff.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B3").getValue() == null, null, { timeout: 10_000 });
    await ff.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B2").activate());
    await ffMenu("Data", /^Flash Fill/);
    await ff.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B3").getValue() === "Lee, M.", null, { timeout: 20_000 });

    // Cell styles from the gallery, in the workbook theme.
    await ff.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1:B1").activate());
    await ffMenu("Format", /^Cell styles/);
    await ff.getByRole("button", { name: "Cell style Accent1", exact: true }).click();
    const styleAt = (ref) => ff.evaluate((r) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(r).getCellStyleData(), ref);
    assert.equal((await styleAt("B1")).bg.rgb, "#4472C4");
    await ff.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A5").activate());
    await ffMenu("Format", /^Cell styles/);
    await ff.getByRole("button", { name: "Cell style Good", exact: true }).click();
    assert.equal((await styleAt("A5")).bg.rgb, "#C6EFCE");
    // Another theme recolors the Accent1 cells and leaves Good alone.
    await ffMenu("Format", /^Theme/);
    await ff.getByRole("button", { name: "Theme Ocean" }).click();
    await ff.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").getCellStyleData()?.bg?.rgb === "#0F6FC6", null, { timeout: 20_000 });
    assert.equal((await styleAt("A5")).bg.rgb, "#C6EFCE");

    // Split: a second pane on the same workbook; an edit in it shows in the main pane.
    await ffMenu("View", /^Split top and bottom/);
    const pane = ff.getByTestId("sheet-split-pane");
    await ff.waitForFunction(() => window.__univerSplit?.getActiveWorkbook?.(), null, { timeout: 60_000 });
    await ff.getByRole("separator", { name: "Split bar" }).waitFor();
    await ff.waitForTimeout(1500);
    const paneBox = await pane.boundingBox();
    assert.ok(paneBox && paneBox.height > 150, "the pane takes the lower half");
    await ff.waitForFunction(() => window.__univerSplit?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange("B5")?.getValue?.() === "Wu, J.", null, { timeout: 30_000 });
    await ff.evaluate(() => window.__univerSplit.getActiveWorkbook().getActiveSheet().getRange("C2").setValue("from the pane"));
    await ff.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C2").getValue() === "from the pane", null, { timeout: 30_000 });
    await ff.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C2").clear());

    await ff.getByRole("button", { name: "File", exact: true }).click();
    const [ffOut] = await Promise.all([ff.waitForEvent("download", { timeout: 120_000 }), ff.getByRole("button", { name: /Download as Excel/ }).click()]);
    const ffZip = await JSZip.loadAsync(await readFile(await ffOut.path()));
    assert.match(await ffZip.file("xl/theme/theme1.xml").async("string"), /<a:accent1><a:srgbClr val="0F6FC6"\/><\/a:accent1>/);
    assert.match(await ffZip.file("xl/worksheets/sheet1.xml").async("string"), /<pane ySplit="\d+"[^>]*\/>/);
    const ffBook = new ExcelJS.Workbook();
    await ffBook.xlsx.load(await readFile(await ffOut.path()));
    assert.equal(ffBook.worksheets[0].getCell("B5").value, "Wu, J.");
    assert.equal(ffBook.worksheets[0].getCell("A1").fill.fgColor.argb, "FF0F6FC6");
    await ffMenu("View", /^Remove split/);
    assert.equal(await pane.count(), 0);
    // Opened again: the theme is back, and the file opens split.
    const ffIn = path.join(tmpdir(), `sheets-e2e-theme-${Date.now()}.xlsx`);
    await writeFile(ffIn, await ffZip.generateAsync({ type: "nodebuffer" }));
    await ff.locator('input[type="file"]').first().setInputFiles(ffIn);
    await ff.waitForFunction(() => window.__univerSplit?.getActiveWorkbook?.(), null, { timeout: 60_000 });
    const themeBack = await ff.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_THEME")?.data || "{}"));
    assert.equal(themeBack.colors?.accent1, "0F6FC6");
    await ffMenu("View", /^Remove split/);
  } finally {
    await ff.close();
  }


  step("Links to other spreadsheets: =[Budget]Plan!A1 reads another workbook, updates, breaks, and goes to .xlsx as Excel's external links");
  const lb = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const lu = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  lb.on("pageerror", (e) => errors.push(e.message));
  lu.on("pageerror", (e) => errors.push(e.message));
  try {
    // The workbook to link to: "Budget", with a sheet "Plan".
    await lb.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await lb.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const budgetId = lb.url().split("/").pop();
    await lb.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      wb.setName("Budget");
      wb.getActiveSheet().setName("Plan");
      wb.getActiveSheet().getRange("A1:A2").setValues([[42], [8]]);
    });
    await lb.waitForFunction(async (id) => {
      const d = await fetch(`/api/docs/${id}`).then((r) => r.json());
      return d.document?.title === "Budget" && JSON.stringify(d.document?.snapshot || "").includes("42");
    }, budgetId, { timeout: 30_000, polling: 1000 });

    await lu.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await lu.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const luMenu = async (top, item) => {
      await lu.getByRole("button", { name: top, exact: true }).first().click();
      await lu.getByRole("button", { name: item }).first().click();
    };
    const luVals = (ref) => lu.evaluate((r) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(r).getValues().flat(), ref);
    // Typing a reference to "Budget" links it.
    await lu.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("A1").setFormula("=[Budget]Plan!A1*2");
      sh.getRange("A2").setFormula("=SUM([Budget]Plan!A1:A2)");
    });
    await lu.getByText('Linked to "Budget".').waitFor({ timeout: 30_000 });
    await lu.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A2").getValue() === 50, null, { timeout: 30_000 });
    assert.deepEqual(await luVals("A1:A2"), [84, 50]);

    // Budget changes; Update values brings it in.
    await lb.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").setValue(100));
    await lb.waitForFunction(async (id) => JSON.stringify((await fetch(`/api/docs/${id}`).then((r) => r.json())).document?.snapshot || "").includes("100"), budgetId, { timeout: 30_000, polling: 1000 });
    await luMenu("Data", /^Edit links/);
    const linkRow = lu.locator('[data-testid="workbook-link"][data-name="Budget"]');
    // The saved copy of Budget can lag behind its editor, so update until the new value arrives.
    for (let attempt = 1; ; attempt++) {
      await linkRow.getByRole("button", { name: "Update values" }).click();
      const updated = await lu
        .waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").getValue() === 200, null, { timeout: 10_000 })
        .then(() => true, () => false);
      if (updated) break;
      if (attempt === 6) throw new Error(`A1 is ${(await luVals("A1"))[0]} after updating the link, not 200`);
    }

    // In .xlsx: an external link with the values, formulas by number.
    await lu.getByRole("button", { name: "Close", exact: true }).click();
    await lu.getByRole("button", { name: "File", exact: true }).click();
    const [luOut] = await Promise.all([lu.waitForEvent("download", { timeout: 120_000 }), lu.getByRole("button", { name: /Download as Excel/ }).click()]);
    const luZip = await JSZip.loadAsync(await readFile(await luOut.path()));
    assert.match(await luZip.file("xl/worksheets/sheet1.xml").async("string"), /<f>\[1\]Plan!A1\*2<\/f><v>200<\/v>/);
    assert.match(await luZip.file("xl/externalLinks/externalLink1.xml").async("string"), /<sheetName val="Plan"\/>[\s\S]*<cell r="A1"><v>100<\/v><\/cell>/);
    assert.match(await luZip.file("xl/externalLinks/_rels/externalLink1.xml.rels").async("string"), /Target="Budget.xlsx" TargetMode="External"/);

    // Break the link: the formulas become their values.
    await luMenu("Data", /^Edit links/);
    await lu.locator('[data-testid="workbook-link"][data-name="Budget"]').getByRole("button", { name: "Break link" }).click();
    await lu.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").getFormula() === "", null, { timeout: 30_000 });
    assert.deepEqual(await luVals("A1:A2"), [200, 108]);
    assert.equal(await lu.locator('[data-testid="workbook-link"]').count(), 0);
  } finally {
    await lb.close();
    await lu.close();
  }


  step("Analyze Data (suggested pivot tables, charts and insights) and Write a formula, through the suite's own AI model or with AI off");
  // A stand-in OpenAI-compatible model on port 3179: start the app with
  // OFFICE_AI_BASE_URL=http://127.0.0.1:3179/v1 OFFICE_AI_MODEL=e2e-stub to
  // check the AI path; otherwise the AI-off path is checked.
  const aiSeen = [];
  const aiStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      aiSeen.push(j);
      const tool = j.tools?.[0]?.function?.name;
      const args = tool === "record_formula" ? { formula: '=SUMIF(A2:A8,"North",C2:C8)', explanation: "Adds Sales where Region is North." } : { insights: [{ title: "Coffee sells most", text: "Coffee brings in 2,900 of 5,850 in sales." }] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] } }] }));
    });
  });
  await new Promise((r) => aiStub.once("error", () => r()).listen(3179, "127.0.0.1", r));
  const ad = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  ad.on("pageerror", (e) => errors.push(e.message));
  try {
    await ad.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await ad.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const adMenu = async (top, item) => {
      await ad.getByRole("button", { name: top, exact: true }).first().click();
      await ad.getByRole("button", { name: item }).first().click();
    };
    const aiOn = (await ad.evaluate(() => fetch("/api/sheet-ai").then((r) => r.json()))).model === "e2e-stub";
    await ad.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("A1:D8").setValues([["Region", "Product", "Sales", "Units"], ["North", "Tea", 1200, 40], ["South", "Tea", 300, 10], ["North", "Coffee", 2500, 80], ["East", "Coffee", 400, 14], ["North", "Cocoa", 900, 31], ["South", "Cocoa", 200, 7], ["East", "Tea", 350, 12]]);
      sh.getRange("B3").activate();
    });
    // One cell selected: the table around it is analyzed.
    await adMenu("Insert", /^Analyze Data/);
    const dlg = ad.getByRole("dialog", { name: "Analyze Data" });
    await dlg.getByText("7 rows in A1:D8.", { exact: false }).waitFor({ timeout: 20_000 });
    await dlg.locator('[data-testid="analyze-suggestion"][data-title="North leads Sales"]').getByText("North has the most Sales (4,600), 79% of the total across 3 Region values.").waitFor();
    await dlg.locator('[data-testid="analyze-suggestion"][data-title="Sales and Units move together"]').waitFor();
    // A suggested pivot table goes on a new sheet, with its pivot chart.
    await dlg.getByRole("button", { name: "Insert Total Sales by Region", exact: true }).click();
    await dlg.getByText('Inserted "Total Sales by Region".').waitFor({ timeout: 30_000 });
    const pivotOut = await ad.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      const res = wb.save().resources;
      const p = JSON.parse(res.find((r) => r.name === "SHEET_SYNERGY_PIVOT_PLUGIN")?.data || "{}").pivots?.[0];
      const charts = JSON.parse(res.find((r) => r.name === "SHEET_SYNERGY_CHARTS_PLUGIN")?.data || "{}").sheets?.[p?.target?.sheetId] || [];
      return { rows: p?.rows, values: wb.getSheetBySheetId(p.target.sheetId).getRange("A1:B5").getValues(), chart: charts[0] && { type: charts[0].type, pivot: charts[0].pivotId === p.id } };
    });
    assert.deepEqual(pivotOut.rows, ["Region"]);
    assert.ok(pivotOut.values.some((r) => r[0] === "North" && r[1] === 4600), JSON.stringify(pivotOut.values));
    assert.deepEqual(pivotOut.chart, { type: "pie", pivot: true });
    if (aiOn) {
      await dlg.getByRole("button", { name: "More insights from AI" }).click();
      await dlg.getByTestId("analyze-ai-insight").getByText("Coffee brings in 2,900 of 5,850 in sales.").waitFor({ timeout: 30_000 });
      assert.match(aiSeen.at(-1).messages.at(-1).content, /- Sales: number, 7 values, sum 5,850/);
    } else await dlg.getByTestId("analyze-ai-off").waitFor();
    await dlg.getByRole("button", { name: "Close", exact: true }).click();

    // Write a formula: in F2, next to the table.
    await ad.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      wb.getSheets()[0].activate();
      wb.getSheets()[0].getRange("F2").activate();
    });
    await ad.waitForTimeout(300);
    await adMenu("Formulas", /^Write a formula/);
    const fd = ad.getByRole("dialog", { name: "Write a formula" });
    if (aiOn) {
      await fd.getByLabel("Formula request").fill("total sales for North");
      await fd.getByRole("button", { name: "Write formula" }).click();
      await fd.getByTestId("formula-answer").getByText('=SUMIF(A2:A8,"North",C2:C8)').waitFor({ timeout: 30_000 });
      const sent = aiSeen.at(-1).messages.at(-1).content;
      assert.match(sent, /Request: total sales for North\n/);
      assert.match(sent, /The formula goes in cell F2\./);
      assert.match(sent, /A = Region, B = Product, C = Sales, D = Units/);
      await fd.getByRole("button", { name: "Insert in F2" }).click();
      await ad.waitForFunction(() => window.__univer.getActiveWorkbook().getSheets()[0].getRange("F2").getValue() === 4600, null, { timeout: 20_000 });
    } else {
      await fd.getByTestId("formula-ai-off").waitFor();
      const off = await ad.evaluate(() => fetch("/api/sheet-ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "formula", prompt: "sum" }) }).then(async (r) => [r.status, (await r.json()).error]));
      assert.equal(off[0], 503);
      assert.match(off[1], /^AI is off/);
      await fd.getByRole("button", { name: "Close", exact: true }).click();
    }
  } finally {
    await ad.close();
    aiStub.close();
  }


  step("Data tables recalculate after a collaborator's edit, and settle (no back-and-forth between clients)");
  const dta = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const dtb = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  dta.on("pageerror", (e) => errors.push(e.message));
  dtb.on("pageerror", (e) => errors.push(e.message));
  try {
    await dta.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await dta.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    await dta.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("B1").setValue(2);
      sh.getRange("C1").setFormula("=B1*B1");
      sh.getRange("B3").setFormula("=C1");
      sh.getRange("A4:A6").setValues([[1], [2], [3]]);
      sh.getRange("A3:B6").activate();
    });
    await dta.getByRole("button", { name: "Data", exact: true }).first().click();
    await dta.getByRole("button", { name: /^Data table/ }).first().click();
    await dta.getByLabel("Column input cell").fill("B1");
    await dta.getByRole("button", { name: "OK", exact: true }).click();
    await dta.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").getValue() === 9, null, { timeout: 30_000 });
    await dtb.goto(dta.url(), { waitUntil: "domcontentloaded", timeout: 120_000 });
    await dtb.waitForFunction(() => window.__univer?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange("B6")?.getValue?.() === 9, null, { timeout: 120_000 });
    // Count the result writes each client sends from here on.
    for (const p of [dta, dtb])
      await p.evaluate(() => {
        window.__dtWrites = 0;
        window.__univer.addEvent(window.__univer.Event.CommandExecuted, (e) => {
          if (e.id === "sheet.command.set-range-values") window.__dtWrites++;
        });
      });
    // B changes the formula; A (and B) work the table out again.
    await dtb.bringToFront();
    await dtb.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C1").setFormula("=B1*B1*10"));
    for (const p of [dta, dtb]) await p.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B6").getValue() === 90, null, { timeout: 30_000 });
    for (const p of [dta, dtb]) assert.deepEqual(await p.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B4:B6").getValues().flat()), [10, 40, 90]);
    // The trial inputs never reached the other client: the input is still 2 there.
    assert.equal(await dta.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B1").getValue()), 2);
    // It settles: a few seconds on, nobody is still writing results.
    await dta.waitForTimeout(3000);
    const before = await Promise.all([dta, dtb].map((p) => p.evaluate(() => window.__dtWrites)));
    await dta.waitForTimeout(4000);
    const after = await Promise.all([dta, dtb].map((p) => p.evaluate(() => window.__dtWrites)));
    assert.deepEqual(after, before, "no more result writes once settled");
    assert.ok(before[0] + before[1] >= 2 && before[0] + before[1] <= 4, `result writes: ${before}`);
  } finally {
    await dta.close();
    await dtb.close();
  }

  step("Formulas: 3-D references across sheets, Evaluate Formula step by step, the Watch Window; array constants");
  const fm = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  fm.on("pageerror", (e) => errors.push(e.message));
  try {
    await fm.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await fm.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const fmMenu = async (top, item) => {
      await fm.getByRole("button", { name: top, exact: true }).first().click();
      await fm.getByRole("button", { name: item }).first().click();
    };
    await fm.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      const first = wb.getActiveSheet();
      first.setName("Jan");
      wb.insertSheet("Feb").getRange("B2").setValue(20);
      wb.insertSheet("Mar").getRange("B2").setValue(300);
      wb.setActiveSheet(first);
      first.getRange("B2").setValue(1);
      first.getRange("D1").setFormula("=SUM(Jan:Mar!B2)");
      first.getRange("D2").setFormula("=AVERAGE(Jan:Feb!B2)");
      first.getRange("D3").setFormula("=SUM({1,2;3,4})*2");
      first.getRange("D4").setFormula("=IF(B2>0,(D1-1)*2,B9)");
    });
    const fmVal = (ref) => fm.evaluate((r) => window.__univer.getActiveWorkbook().getSheetByName("Jan").getRange(r).getValue(), ref);
    await fm.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Jan").getRange("D1").getValue() === 321, null, { timeout: 15_000 });
    assert.equal(await fmVal("D2"), 10.5);
    assert.equal(await fmVal("D3"), 20, "array constants");
    assert.equal(await fm.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Jan").getRange("D1").getFormula()), "=SUM(Jan:Mar!B2)", "the cell keeps the 3-D reference");
    // A sheet added inside the span counts at once; a change on one sheet flows through.
    await fm.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      const mid = wb.insertSheet("Extra");
      mid.getRange("B2").setValue(4000);
      wb.moveSheet(mid, 2);
      wb.setActiveSheet(wb.getSheetByName("Jan"));
      wb.getSheetByName("Feb").getRange("B2").setValue(25);
    });
    await fm.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("Jan").getRange("D1").getValue() === 4326, null, { timeout: 15_000 })
      .catch(async () => assert.fail(`3-D SUM after a new sheet in the span: ${await fmVal("D1")}`));

    // Evaluate Formula: underlined part, then its value, until the result.
    await fm.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Jan").getRange("D4").activate());
    await fmMenu("Formulas", "Evaluate Formula…");
    const evText = () => fm.getByTestId("evaluate-text").innerText();
    const next = () => fm.getByTestId("evaluate-next").innerText();
    assert.equal(await evText(), "=IF(B2>0,(D1-1)*2,B9)");
    assert.equal(await next(), "B2");
    const seen = [];
    for (let i = 0; i < 10; i++) {
      const has = await fm.getByTestId("evaluate-next").count();
      if (!has) break;
      seen.push(`${await evText()} [${await next()}]`);
      await fm.getByRole("button", { name: "Evaluate", exact: true }).click();
      await fm.waitForFunction((prev) => document.querySelector('[data-testid="evaluate-text"]')?.textContent !== prev, seen.at(-1).replace(/ \[.*$/, ""), { timeout: 10_000 });
    }
    assert.deepEqual(seen, [
      "=IF(B2>0,(D1-1)*2,B9) [B2]",
      "=IF(1>0,(D1-1)*2,B9) [1>0]",
      "=IF(TRUE,(D1-1)*2,B9) [D1]",
      "=IF(TRUE,(4326-1)*2,B9) [4326-1]",
      "=IF(TRUE,4325*2,B9) [4325*2]",
      "=IF(TRUE,8650,B9) [IF(TRUE,8650,B9)]",
    ]);
    assert.equal(await evText(), "=8650");
    await fm.getByRole("button", { name: "Restart" }).click();
    assert.equal(await next(), "B2");
    await fm.getByRole("button", { name: "Close", exact: true }).click();

    // Watch Window: watch cells on another sheet, see them change from here.
    await fm.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      const feb = wb.getSheetByName("Feb");
      wb.setActiveSheet(feb);
      feb.getRange("B2").activate();
    });
    await fmMenu("Formulas", "Watch Window");
    await fm.getByTestId("watch-window").getByRole("button", { name: "Add watch" }).click();
    await fm.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      wb.setActiveSheet(wb.getSheetByName("Jan"));
      wb.getSheetByName("Jan").getRange("D1").activate();
    });
    await fm.getByTestId("watch-window").getByRole("button", { name: "Add watch" }).click();
    const watched = () => fm.$$eval("[data-watch]", (rows) => rows.map((r) => `${r.getAttribute("data-watch")}=${r.querySelector("[data-watch-value]").textContent}`));
    await fm.waitForFunction(() => document.querySelectorAll("[data-watch]").length === 2, null, { timeout: 5_000 });
    assert.deepEqual(await watched(), ["Feb!B2=25", "Jan!D1=4326"]);
    await fm.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("Feb").getRange("B2").setValue(30));
    await fm.waitForFunction(() => [...document.querySelectorAll("[data-watch-value]")].map((x) => x.textContent).join() === "30,4331", null, { timeout: 10_000 })
      .catch(async () => assert.fail(`watch window after a change: ${await watched()}`));
    assert.match(await fm.getByTestId("watch-window").innerText(), /=SUM\(Jan:Mar!B2\)/);
    // Kept for the next visit (per person, in this browser).
    await fm.reload({ waitUntil: "domcontentloaded" });
    await fm.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    await fmMenu("Formulas", "Watch Window");
    await fm.waitForFunction(() => document.querySelectorAll("[data-watch]").length === 2, null, { timeout: 10_000 });
  } finally {
    await fm.close();
  }
  step("Data > Protect sheet with a password, and a range with its own: locked for the owner too until unlocked, kept in .xlsx as Excel's hashes");
  const pw = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  pw.on("pageerror", (e) => errors.push(e.message));
  try {
    await pw.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await pw.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const pwMenu = async (top, item) => {
      await pw.getByRole("button", { name: top, exact: true }).first().click();
      await pw.getByRole("button", { name: item }).first().click();
    };
    const pwVal = (a1) => pw.evaluate((a) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(a).getValue(), a1);
    const pwSet = (a1, v) => pw.evaluate(([a, x]) => { try { window.__univer.getActiveWorkbook().getActiveSheet().getRange(a).setValue(x); } catch {} }, [a1, v]);
    await pw.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1").setValue(1));
    await pwMenu("Data", "Protect sheet…");
    const panel = pw.getByRole("complementary", { name: "Protected sheets and ranges" });
    await panel.getByLabel("Except ranges").fill("E1:E5");
    await panel.getByLabel("Range password").fill("open");
    await panel.getByLabel("Sheet password").fill("lock");
    await panel.getByRole("button", { name: "Save protection" }).click();
    await panel.locator("[data-password]").waitFor({ timeout: 30_000 });
    await pw.keyboard.press("Escape");

    await pwSet("A1", 2);
    await pw.getByRole("status").getByText(/password/).waitFor({ timeout: 5_000 });
    assert.equal(await pwVal("A1"), 1, "the owner is held off by the password too");
    await pwSet("E2", 5);
    assert.ok((await pwVal("E2")) == null, "the range has its own password");

    // The range's password opens just the range.
    await pw.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("E2").activate());
    await pwMenu("Data", "Unlock range…");
    await pw.getByLabel("Password", { exact: true }).fill("open");
    await pw.getByRole("button", { name: "OK" }).click();
    await pw.getByText("Range unlocked for you").waitFor({ timeout: 30_000 });
    await pwSet("E2", 5);
    assert.equal(await pwVal("E2"), 5);
    await pwSet("A1", 3);
    assert.equal(await pwVal("A1"), 1);

    // A wrong sheet password is turned away; the right one opens the sheet.
    await pwMenu("Data", "Unprotect sheet…");
    await pw.getByLabel("Password", { exact: true }).fill("nope");
    await pw.getByRole("button", { name: "OK" }).click();
    await pw.getByText("The password you supplied is not correct.").waitFor({ timeout: 30_000 });
    await pw.getByLabel("Password", { exact: true }).fill("lock");
    await pw.getByRole("button", { name: "OK" }).click();
    await pw.getByText("Sheet unprotected for you").waitFor({ timeout: 30_000 });
    await pwSet("A1", 4);
    assert.equal(await pwVal("A1"), 4);

    // .xlsx: Excel's SHA-512 hashes, for the sheet and the range.
    const [pwDl] = await Promise.all([pw.waitForEvent("download", { timeout: 120_000 }), pwMenu("File", "Download as Excel (.xlsx)")]);
    const pwZip = await JSZip.loadAsync(await readFile(await pwDl.path()));
    const pwXml = await pwZip.file("xl/worksheets/sheet1.xml").async("string");
    assert.match(pwXml, /<sheetProtection[^>]*algorithmName="SHA-512"[^>]*hashValue="[^"]+"[^>]*spinCount="100000"/);
    assert.match(pwXml, /<protectedRange[^>]*algorithmName="SHA-512"[^>]*sqref="E1:E5"/);
  } finally {
    await pw.close();
  }
  step("Data > Get data: applied steps (filter, custom column, group by) shape the data and are run again on refresh");
  const gq = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  gq.on("pageerror", (e) => errors.push(e.message));
  try {
    await gq.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await gq.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    await gq.getByRole("button", { name: "Data", exact: true }).first().click();
    await gq.getByRole("button", { name: /^Get data/ }).first().click();
    await gq.getByRole("tab", { name: "From file" }).click();
    const orders = "Region,Item,Qty,Price\nNorth,Tea,2,1.5\nSouth,Tea,1,1.5\nNorth,Cake,3,4\nWest,Tea,0,1.5\nSouth,Cake,2,4\n";
    await gq.getByLabel("Data file").setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(orders) });
    await gq.getByRole("table", { name: "Preview" }).waitFor({ timeout: 10_000 });
    const addStep = async (kind, fill) => {
      await gq.getByLabel("Step", { exact: true }).selectOption(kind);
      await fill();
      await gq.getByRole("button", { name: "Add step" }).click();
    };
    await addStep("filter", async () => {
      await gq.getByLabel("Step column").selectOption("Qty");
      await gq.getByLabel("Condition").selectOption(">");
      await gq.getByLabel("Value", { exact: true }).fill("0");
    });
    // A formula that names a missing column is refused before it becomes a step.
    await gq.getByLabel("Step", { exact: true }).selectOption("custom");
    await gq.getByLabel("New column name").fill("Amount");
    await gq.getByLabel("Formula").fill("[Qty] * [Cost]");
    await gq.getByRole("button", { name: "Add step" }).click();
    await gq.getByRole("alert").filter({ hasText: 'There is no column "Cost"' }).waitFor({ timeout: 5_000 });
    await gq.getByLabel("Formula").fill("[Qty] * [Price]");
    await gq.getByRole("button", { name: "Add step" }).click();
    await addStep("group", async () => {
      await gq.getByLabel("Group by column").selectOption("Region");
      await gq.getByLabel("Aggregate").selectOption("sum");
      await gq.getByLabel("Of column").selectOption("Amount");
      await gq.getByLabel("New column name").fill("Sales");
    });
    await addStep("sort", async () => gq.getByLabel("Step column").selectOption("Sales"));
    assert.deepEqual(await gq.getByRole("list", { name: "Applied steps" }).locator("li").evaluateAll((li) => li.map((x) => x.getAttribute("data-step"))), ["filter", "custom", "group", "sort"]);
    await gq.getByRole("button", { name: "Remove step 4" }).click();
    await addStep("sort", async () => {
      await gq.getByLabel("Step column").selectOption("Sales");
      await gq.getByText("Descending").click();
    });
    await gq.getByRole("button", { name: "Load", exact: true }).last().click();
    await gq.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("orders")?.getRange("B3").getValue() === 9.5, null, { timeout: 30_000 });
    assert.deepEqual(await gq.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("orders").getRange("A1:B3").getValues()), [["Region", "Sales"], ["North", 15], ["South", 9.5]]);
    const steps = await gq.evaluate(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_QUERY_PLUGIN").data).queries[0].steps.transforms.map((t) => t.kind));
    assert.deepEqual(steps, ["filter", "custom", "group", "sort"]);
    // Refresh from a new file: the same steps run on the new data.
    await gq.getByRole("button", { name: "Data", exact: true }).first().click();
    await gq.getByRole("button", { name: /^Queries and connections/ }).first().click();
    const [chooser] = await Promise.all([gq.waitForEvent("filechooser"), gq.getByRole("button", { name: "Refresh orders" }).click()]);
    await chooser.setFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from("Region,Item,Qty,Price\nWest,Tea,10,1\nNorth,Tea,1,1\n") });
    await gq.waitForFunction(() => window.__univer.getActiveWorkbook().getSheetByName("orders").getRange("A2").getValue() === "West", null, { timeout: 30_000 });
    assert.deepEqual(await gq.evaluate(() => window.__univer.getActiveWorkbook().getSheetByName("orders").getRange("A1:B4").getValues()), [["Region", "Sales"], ["West", 10], ["North", 1], [null, null]]);
  } finally {
    await gq.close();
  }
  step("View > Custom Views: save the look of the workbook under a name and bring it back; kept in .xlsx");
  const cv = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  cv.on("pageerror", (e) => errors.push(e.message));
  try {
    await cv.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await cv.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const cvMenu = async (top, item) => {
      await cv.getByRole("button", { name: top, exact: true }).first().click();
      await cv.getByRole("button", { name: item }).first().click();
    };
    const look = () => cv.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      const snap = sh.getSheet().getSnapshot();
      const hidden = Object.entries(snap.rowData || {}).filter(([, r]) => r?.hd === 1).map(([k]) => Number(k));
      return { hidden, freeze: [sh.getFreeze().xSplit, sh.getFreeze().ySplit], grid: !sh.hasHiddenGridLines() };
    });
    await cv.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("A1:A10").setValues([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10]]);
      sh.hideRows(3, 2);
      sh.setFreeze({ xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 });
      sh.setHiddenGridlines(true);
    });
    await cv.waitForTimeout(300);
    await cvMenu("View", "Custom Views…");
    await cv.getByLabel("View name").fill("Short list");
    await cv.getByRole("button", { name: "Add", exact: true }).click();
    await cv.getByRole("list", { name: "Views" }).getByText("Short list").waitFor({ timeout: 10_000 });
    await cv.getByLabel("View name").fill("short LIST");
    await cv.getByRole("button", { name: "Add", exact: true }).click();
    await cv.getByRole("alert").filter({ hasText: "already a view" }).waitFor({ timeout: 5_000 });
    await cv.getByRole("button", { name: "Close", exact: true }).click();
    // Everything back to normal, then the view again.
    await cv.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.showRows(0, 20);
      sh.cancelFreeze();
      sh.setHiddenGridlines(false);
    });
    await cv.waitForTimeout(300);
    assert.deepEqual(await look(), { hidden: [], freeze: [0, 0], grid: true });
    await cvMenu("View", "Custom Views…");
    await cv.getByRole("button", { name: "Show Short list" }).click();
    await cv.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getFreeze().ySplit === 1, null, { timeout: 10_000 });
    assert.deepEqual(await look(), { hidden: [3, 4], freeze: [0, 1], grid: false });
    const [cvDl] = await Promise.all([cv.waitForEvent("download", { timeout: 120_000 }), cvMenu("File", "Download as Excel (.xlsx)")]);
    const cvZip = await JSZip.loadAsync(await readFile(await cvDl.path()));
    assert.match(await cvZip.file("xl/workbook.xml").async("string"), /<customWorkbookView name="Short list"/);
    assert.match(await cvZip.file("xl/worksheets/sheet1.xml").async("string"), /<customSheetView [^>]*showGridLines="0" hiddenRows="1"><pane ySplit="1"/);
  } finally {
    await cv.close();
  }
  step("Quick Analysis (Ctrl+Q), Review > Check Accessibility with alt text, and File > Sensitivity: kept in .xlsx");
  const qa = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  qa.on("pageerror", (e) => errors.push(e.message));
  try {
    await qa.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await qa.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const qaMenu = async (top, item) => {
      await qa.getByRole("button", { name: top, exact: true }).first().click();
      await qa.getByRole("button", { name: item }).first().click();
    };
    const qaGet = (a1) => qa.evaluate((a) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(a).getValue(), a1);
    await qa.evaluate(() => {
      const sh = window.__univer.getActiveWorkbook().getActiveSheet();
      sh.getRange("A1:C4").setValues([["Region", "Q1", "Q2"], ["North", 10, 20], ["South", 5, 7], ["West", 1, 3]]);
      sh.getRange("B1:C4").activate();
    });
    await qa.waitForTimeout(300);
    // Totals: Sum in a row below, worked out past the header.
    await qa.locator("body").press("Control+q");
    await qa.getByRole("dialog", { name: "Quick Analysis" }).waitFor({ timeout: 10_000 });
    await qa.getByRole("tab", { name: "Totals" }).click();
    await qa.getByRole("button", { name: "Sum (row below)" }).click();
    await qa.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("C5").getValue() === 30, null, { timeout: 10_000 });
    assert.deepEqual([await qaGet("A5"), await qaGet("B5")], ["Sum", 16]);
    assert.equal(await qa.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B5").getFormula()), "=SUM(B2:B4)");
    // Formatting: data bars on the numbers.
    await qa.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B1:C4").activate());
    await qaMenu("Insert", "Quick Analysis…");
    await qa.getByRole("button", { name: "Data Bars" }).click();
    await qa.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getConditionalFormattingRules().length === 1, null, { timeout: 10_000 });
    assert.deepEqual(await qa.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getConditionalFormattingRules()[0].ranges[0]), { startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 });
    // Sparklines, one per row, in the next column; and a chart.
    await qa.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B1:C4").activate());
    await qaMenu("Insert", "Quick Analysis…");
    await qa.getByRole("tab", { name: "Sparklines" }).click();
    await qa.getByRole("button", { name: "Line", exact: true }).click();
    await qa.waitForFunction(() => JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_SPARKLINE_PLUGIN")?.data || "{}").groups?.[0]?.items?.length === 3, null, { timeout: 10_000 });
    await qa.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1:C4").activate());
    await qaMenu("Insert", "Quick Analysis…");
    await qa.getByRole("tab", { name: "Charts" }).click();
    await qa.getByRole("button", { name: "Clustered Column" }).click();
    await qa.waitForFunction(() => Object.values(JSON.parse(window.__univer.getActiveWorkbook().save().resources.find((r) => r.name === "SHEET_SYNERGY_CHARTS_PLUGIN")?.data || "{}").sheets || {}).flat().length === 1, null, { timeout: 10_000 });

    // Check Accessibility: the chart has no alt text, the sheet a default name.
    await qa.keyboard.press("Escape");
    await qaMenu("Review", "Check Accessibility");
    const panel = qa.getByRole("complementary", { name: "Accessibility" });
    await panel.locator('[data-rule="Missing alternative text"]').getByText(/^Chart.*without alt text$/).waitFor({ timeout: 10_000 });
    assert.ok(await panel.locator('[data-rule="Default sheet name"]').count() >= 1 || (await qa.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getSheetName())) !== "Sheet1");
    await panel.getByLabel("Alt text").fill("Column chart of Q1 and Q2 by region");
    await panel.getByRole("button", { name: "Save alt text" }).click();
    await panel.locator('[data-rule="Missing alternative text"]').waitFor({ state: "detached", timeout: 10_000 });

    // Sensitivity.
    await qaMenu("File", "Sensitivity…");
    await qa.getByRole("radio", { name: "Confidential", exact: true }).check();
    await qa.getByRole("button", { name: "Apply" }).click();
    await qa.getByTestId("sensitivity-label").filter({ hasText: "Confidential" }).waitFor({ timeout: 10_000 });

    const [qaDl] = await Promise.all([qa.waitForEvent("download", { timeout: 120_000 }), qaMenu("File", "Download as Excel (.xlsx)")]);
    const qaZip = await JSZip.loadAsync(await readFile(await qaDl.path()));
    assert.match(await qaZip.file("docProps/custom.xml").async("string"), /MSIP_Label_[0-9a-f-]+_Name"><vt:lpwstr>Confidential</);
    const qaDrawing = await qaZip.file("xl/drawings/drawing1.xml").async("string");
    assert.match(qaDrawing, /descr="Column chart of Q1 and Q2 by region"/);
  } finally {
    await qa.close();
  }
  step("Insert > Form control: a check box and a spin button work their linked cells; written as Excel's VML controls");
  const fc = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  fc.on("pageerror", (e) => errors.push(e.message));
  try {
    await fc.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await fc.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const fcMenu = async (top, item) => {
      await fc.getByRole("button", { name: top, exact: true }).first().click();
      await fc.getByRole("button", { name: item }).first().click();
    };
    const fcVal = (a1) => fc.evaluate((a) => window.__univer.getActiveWorkbook().getActiveSheet().getRange(a).getValue(), a1);
    await fc.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("D2").activate());
    await fcMenu("Insert", "Form control…");
    await fc.getByLabel("Text", { exact: true }).fill("Include tax");
    await fc.getByLabel("Cell link").fill("$B$2");
    await fc.getByRole("dialog", { name: "Insert form control" }).getByRole("button", { name: "Insert", exact: true }).click();
    const box = fc.getByRole("group", { name: "Form control Include tax" });
    await box.waitFor({ timeout: 15_000 });
    await box.getByRole("checkbox").click();
    await fc.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B2").getCellData()?.t === 3 && window.__univer.getActiveWorkbook().getActiveSheet().getRange("B2").getValue() === 1, null, { timeout: 10_000 });
    await box.getByRole("checkbox").click();
    await fc.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B2").getCellData()?.t === 3 && window.__univer.getActiveWorkbook().getActiveSheet().getRange("B2").getValue() === 0, null, { timeout: 10_000 });

    await fc.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("D6").activate());
    await fcMenu("Insert", "Form control…");
    await fc.getByLabel("Control", { exact: true }).selectOption("spin");
    await fc.getByLabel("Cell link").fill("$B$3");
    await fc.getByLabel("Minimum").fill("1");
    await fc.getByLabel("Maximum").fill("3");
    await fc.getByRole("dialog", { name: "Insert form control" }).getByRole("button", { name: "Insert", exact: true }).click();
    const up = fc.getByRole("button", { name: "Spin up" });
    await up.waitFor({ timeout: 15_000 });
    for (let i = 0; i < 4; i++) await up.click();
    await fc.waitForFunction(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("B3").getValue() === 3, null, { timeout: 10_000 });
    assert.equal(await fcVal("B3"), 3, "stops at the maximum");

    const [fcDl] = await Promise.all([fc.waitForEvent("download", { timeout: 120_000 }), fcMenu("File", "Download as Excel (.xlsx)")]);
    const fcZip = await JSZip.loadAsync(await readFile(await fcDl.path()));
    const vmlName = Object.keys(fcZip.files).find((p) => /vmlDrawing\d+\.vml$/.test(p));
    assert.ok(vmlName, "a VML drawing for the controls");
    const fcVml = await fcZip.file(vmlName).async("string");
    assert.match(fcVml, /ObjectType="Checkbox">[\s\S]*?<x:FmlaLink>\$B\$2<\/x:FmlaLink>/);
    assert.match(fcVml, /ObjectType="Spin">[\s\S]*?<x:Val>3<\/x:Val><x:Min>1<\/x:Min><x:Max>3<\/x:Max>/);
    assert.match(await fcZip.file("xl/worksheets/sheet1.xml").async("string"), /<legacyDrawing r:id="rId\d+"\/>/);
  } finally {
    await fc.close();
  }
  step("Automate: the larger script API (formatting, sizes, sort, rows, merge, freeze panes, tables, sheet names) applied to the workbook");
  const as = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  as.on("pageerror", (e) => errors.push(e.message));
  try {
    await as.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await as.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    await as.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange("A1:B4").setValues([["Item", "Qty"], ["Tea", 2], ["Cake", 5], ["Bun", 1]]));
    await as.getByRole("button", { name: "Automate", exact: true }).first().click();
    await as.getByRole("button", { name: /^Scripts/ }).first().click();
    const asPanel = as.getByRole("complementary", { name: "Automate panel" });
    await asPanel.getByLabel("Script name").fill("Tidy");
    await asPanel.getByLabel("Script code").fill(`function main(workbook: ExcelScript.Workbook) {
  const sheet = workbook.getActiveWorksheet();
  sheet.getRange("A2:B4").getSort().apply([{ key: 1, ascending: false }]);
  sheet.getRange("A1:B1").getFormat().getFont().setSize(14);
  sheet.getRange("B1:B4").getFormat().setHorizontalAlignment(ExcelScript.HorizontalAlignment.right);
  sheet.getRange("A1").getFormat().setColumnWidth(150);
  sheet.getRange("A2").getEntireRow().insert(ExcelScript.InsertShiftDirection.down);
  sheet.getRange("A2:B2").merge(false);
  sheet.getFreezePanes().freezeRows(1);
  sheet.addTable("D1:E3", true);
  sheet.setName("Stock");
}`);
    await asPanel.getByRole("button", { name: "Save", exact: true }).click();
    await asPanel.getByRole("button", { name: "Run", exact: true }).click();
    await asPanel.getByRole("status", { name: "Script output" }).filter({ hasText: "Script finished" }).waitFor({ timeout: 30_000 });
    const got = await as.evaluate(() => {
      const wb = window.__univer.getActiveWorkbook();
      const sh = wb.getSheetByName("Stock");
      return {
        values: sh.getRange("A3:B5").getValues(),
        size: sh.getRange("A1").getCellStyleData()?.fs,
        right: sh.getRange("B4").getCellStyleData()?.ht,
        width: sh.getSheet().getColumnWidth(0),
        merged: sh.getSheet().getMergeData().map((m) => [m.startRow, m.startColumn, m.endRow, m.endColumn]),
        freeze: sh.getFreeze().ySplit,
        tables: (wb.getTableList?.() || []).length,
      };
    });
    assert.deepEqual(got.values, [["Cake", 5], ["Tea", 2], ["Bun", 1]], "sorted, then pushed down a row");
    assert.equal(got.size, 14);
    assert.equal(got.right, 3, "right-aligned");
    assert.equal(got.width, 150);
    assert.deepEqual(got.merged, [[1, 0, 1, 1]]);
    assert.equal(got.freeze, 1);
    assert.equal(got.tables, 1);
  } finally {
    await as.close();
  }
  step("Review > Protect Workbook: sheets can't be added or renamed until unprotected with the password; kept in .xlsx as workbookProtection");
  const wp = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  wp.on("pageerror", (e) => errors.push(e.message));
  try {
    await wp.goto(`${BASE}/sheet`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await wp.waitForFunction(() => window.__univer?.getActiveWorkbook?.(), null, { timeout: 120_000 });
    const wpMenu = async (top, item) => {
      await wp.getByRole("button", { name: top, exact: true }).first().click();
      await wp.getByRole("button", { name: item }).first().click();
    };
    const sheetCount = () => wp.evaluate(() => window.__univer.getActiveWorkbook().getSheets().length);
    const tryAdd = () => wp.evaluate(() => { try { window.__univer.getActiveWorkbook().insertSheet("Extra"); } catch {} });
    await wpMenu("Review", "Protect Workbook…");
    await wp.getByRole("textbox", { name: "Password" }).fill("lock it");
    await wp.getByRole("button", { name: "OK", exact: true }).click();
    await wp.getByText("The workbook's structure is protected.").first().waitFor({ timeout: 30_000 });
    const n = await sheetCount();
    await tryAdd();
    await wp.waitForTimeout(500);
    assert.equal(await sheetCount(), n, "no sheet added while protected");
    // .xlsx: Excel's workbookProtection, with the password as its hash.
    const [wpDl] = await Promise.all([wp.waitForEvent("download", { timeout: 120_000 }), wpMenu("File", "Download as Excel (.xlsx)")]);
    const wpZip = await JSZip.loadAsync(await readFile(await wpDl.path()));
    assert.match(await wpZip.file("xl/workbook.xml").async("string"), /<workbookProtection[^>]*workbookAlgorithmName="SHA-512"[^>]*lockStructure="1"/);
    // A wrong password is refused; the right one unlocks.
    await wpMenu("Review", "Unprotect Workbook…");
    await wp.getByRole("textbox", { name: "Password" }).fill("nope");
    await wp.getByRole("button", { name: "OK", exact: true }).click();
    await wp.getByText("The password you supplied is not correct.").waitFor({ timeout: 30_000 });
    await wp.getByRole("textbox", { name: "Password" }).fill("lock it");
    await wp.getByRole("button", { name: "OK", exact: true }).click();
    await wp.getByText("The workbook's structure is no longer protected.").first().waitFor({ timeout: 30_000 });
    await tryAdd();
    await wp.waitForFunction((k) => window.__univer.getActiveWorkbook().getSheets().length === k + 1, n, { timeout: 15_000 });
  } finally {
    await wp.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("sheets e2e: ok");
} finally {
  await browser.close();
}
