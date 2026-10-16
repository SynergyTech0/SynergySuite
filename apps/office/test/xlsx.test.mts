// Round-trip tests for lib/xlsx.ts. Fixture workbooks are generated here with
// ExcelJS (styles, validation, conditional formats...) and SheetJS (a second,
// independent writer), so no binaries are checked in.
// Run: npm test -w apps/office
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import {
  xlsxToUniver,
  univerToXlsx,
  legacyToUniver,
  univerSheetToCsv,
  formulaFromExcel,
  formulaToExcel,
  shiftFormula,
  toArgb,
  RESOURCE,
  type UniverWorkbook,
  type UniverCell,
  type UniverStyle,
} from "../lib/xlsx.ts";

async function fixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1, showGridLines: false, zoomScale: 125 }],
    properties: { tabColor: { argb: "FF00B050" } } as any,
  });
  ws.getCell("A1").value = "Item";
  ws.getCell("B1").value = "Qty";
  ws.getCell("C1").value = "Price";
  ws.getCell("D1").value = "Total";
  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { theme: 4 } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    c.border = { bottom: { style: "medium", color: { argb: "FF0000FF" } } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  const rows: [string, number, number][] = [
    ["Apple", 3, 1.5],
    ["Pear", 5, 2.25],
    ["Plum", 2, 4],
  ];
  rows.forEach(([n, q, p], i) => {
    const r = i + 2;
    ws.getCell(`A${r}`).value = n;
    ws.getCell(`B${r}`).value = q;
    ws.getCell(`C${r}`).value = p;
    ws.getCell(`C${r}`).numFmt = "$#,##0.00";
  });
  ws.getCell("D2").value = { formula: "B2*C2", result: 4.5 };
  ws.fillFormula("D3:D4", "B3*C3", [11.25, 8]);
  ws.getCell("D5").value = { formula: "_xlfn.XLOOKUP(\"Pear\",A2:A4,D2:D4)", result: 11.25 };
  ws.getCell("E1").value = new Date(Date.UTC(2024, 0, 15));
  ws.getCell("E1").numFmt = "yyyy-mm-dd";
  ws.getCell("F1").value = { text: "Site", hyperlink: "https://example.com/" };
  ws.getCell("F2").value = { text: "Go to notes", hyperlink: "#'My Notes'!B3" };
  ws.getCell("G1").value = { richText: [{ text: "bold", font: { bold: true } }, { text: " plain" }] };
  ws.getCell("G2").value = true;
  ws.getCell("G3").value = { formula: "1/0", result: { error: "#DIV/0!" } };
  ws.getCell("A2").note = "first fruit";
  ws.getCell("H2").alignment = { textRotation: 45 };
  ws.getCell("H2").value = "tilted";
  ws.mergeCells("A7:C8");
  ws.getCell("A7").value = "merged";
  ws.getColumn(1).width = 20;
  ws.getColumn(8).hidden = true;
  ws.getRow(3).height = 30;
  ws.getCell("A6").value = "hidden row";
  ws.getRow(6).hidden = true;
  ws.autoFilter = "A1:D4";
  ws.getCell("B2").dataValidation = { type: "whole", operator: "between", formulae: [1, 100], showErrorMessage: true, error: "1-100 only" };
  ws.getCell("B3").dataValidation = { type: "whole", operator: "between", formulae: [1, 100], showErrorMessage: true, error: "1-100 only" };
  ws.getCell("A10").dataValidation = { type: "list", allowBlank: true, formulae: ['"Red,Green,Blue"'] };
  ws.addConditionalFormatting({
    ref: "B2:B4",
    rules: [
      { type: "cellIs", operator: "greaterThan", formulae: [2], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } } } },
      { type: "colorScale", priority: 2, cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: "FFF8696B" }, { argb: "FF63BE7B" }] },
    ],
  });
  ws.addConditionalFormatting({
    ref: "A2:A4",
    rules: [
      { type: "containsText", operator: "containsText", text: "P", priority: 3, style: { font: { bold: true, color: { argb: "FF9C0006" } } } } as any,
      { type: "expression", formulae: ["LEN(A2)>4"], priority: 4, style: { font: { italic: true } } },
    ],
  });
  ws.addConditionalFormatting({
    ref: "C2:C4",
    rules: [{ type: "dataBar", priority: 5, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF638EC6" } } as any],
  });
  wb.definedNames.add("Data!$B$2:$B$4", "Quantities");

  const notes = wb.addWorksheet("My Notes");
  notes.getCell("B3").value = "target";
  const hidden = wb.addWorksheet("Hidden", { state: "hidden" });
  hidden.getCell("A1").value = 42;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const sheetByName = (book: UniverWorkbook, name: string) => Object.values(book.sheets).find((s) => s.name === name)!;
const styleOf = (book: UniverWorkbook, cell: UniverCell | undefined): UniverStyle =>
  (typeof cell?.s === "string" ? book.styles[cell.s] : cell?.s) || {};
const resource = (book: UniverWorkbook, name: string) => JSON.parse(book.resources?.find((r) => r.name === name)?.data || "{}");

test("imports values, formulas, styles and sheet layout", async () => {
  const book = await xlsxToUniver(await fixture(), "Fruit");
  assert.equal(book.name, "Fruit");
  assert.deepEqual(book.sheetOrder.map((id) => book.sheets[id].name), ["Data", "My Notes", "Hidden"]);
  const s = sheetByName(book, "Data");
  const cd = s.cellData;

  assert.equal(cd[0][0].v, "Item");
  assert.equal(cd[1][1].v, 3);
  assert.equal(cd[1][3].f, "=B2*C2");
  assert.equal(cd[1][3].v, 4.5);
  assert.equal(cd[3][3].f, "=B4*C4", "shared formula children get their own translated formula");
  assert.equal(cd[4][3].f, '=XLOOKUP("Pear",A2:A4,D2:D4)', "_xlfn. prefix is stripped for the engine");
  assert.equal(cd[0][4].v, 45306, "dates become Excel serials");
  assert.equal(styleOf(book, cd[0][4]).n?.pattern, "yyyy-mm-dd");
  assert.equal(styleOf(book, cd[1][2]).n?.pattern, "$#,##0.00");
  assert.equal(cd[1][6].t, 3);
  assert.equal(cd[1][6].v, 1);
  assert.equal(cd[2][6].v, "#DIV/0!");

  const head = styleOf(book, cd[0][0]);
  assert.equal(head.bl, 1);
  assert.equal(head.cl?.rgb, "#4F81BD", "theme colors resolve through the workbook theme (ExcelJS writes the Office 2007 theme)");
  assert.equal(head.bg?.rgb, "#FFFF00");
  assert.deepEqual(head.bd?.b, { s: 8, cl: { rgb: "#0000FF" } });
  assert.equal(head.ht, 2);
  assert.equal(head.vt, 2);
  assert.equal(head.tb, 3);
  assert.deepEqual(styleOf(book, cd[1][7]).tr, { a: 45 });

  assert.equal(cd[0][5].p?.body.customRanges?.[0].properties?.url, "https://example.com/");
  const notesId = sheetByName(book, "My Notes").id;
  assert.equal(cd[1][5].p?.body.customRanges?.[0].properties?.url, `#gid=${notesId}&range=B3`);
  assert.equal(cd[0][6].v, "bold plain");
  assert.equal(cd[0][6].p?.body.textRuns?.[0].ts?.bl, 1);

  assert.deepEqual(s.mergeData, [{ startRow: 6, endRow: 7, startColumn: 0, endColumn: 2 }]);
  assert.equal(cd[6][0].v, "merged");
  assert.equal(s.columnData?.[0].w, 145);
  assert.equal(s.columnData?.[7].hd, 1);
  assert.equal(s.rowData?.[2].h, 40);
  assert.equal(s.rowData?.[5].hd, 1);
  assert.deepEqual(s.freeze, { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 });
  assert.equal(s.tabColor, "#00B050");
  assert.equal(s.showGridlines, 0);
  assert.equal(s.zoomRatio, 1.25);
  assert.equal(sheetByName(book, "Hidden").hidden, 1);
});

test("imports notes, validation, conditional formats, filter and names", async () => {
  const book = await xlsxToUniver(await fixture());
  const id = sheetByName(book, "Data").id;

  assert.equal(resource(book, RESOURCE.note)[id][1][0].note, "first fruit");

  const dv = resource(book, RESOURCE.dv)[id];
  const whole = dv.find((r: any) => r.type === "whole");
  assert.deepEqual(
    whole.ranges.map((g: any) => [g.startRow, g.endRow, g.startColumn, g.endColumn]),
    [[1, 2, 1, 1]],
    "per-cell validations are squeezed back into one range",
  );
  assert.equal(whole.operator, "between");
  assert.equal(whole.formula1, "1");
  assert.equal(whole.formula2, "100");
  assert.equal(whole.error, "1-100 only");
  const list = dv.find((r: any) => r.type === "list");
  assert.deepEqual(JSON.parse(list.formula1), ["Red", "Green", "Blue"]);

  const cf = resource(book, RESOURCE.cf)[id];
  assert.deepEqual(
    cf.map((r: any) => r.rule.subType || r.rule.type),
    ["number", "colorScale", "text", "formula", "dataBar"],
    "rules keep Excel's priority order",
  );
  assert.equal(cf[0].rule.operator, "greaterThan");
  assert.equal(cf[0].rule.value, 2);
  assert.equal(cf[0].rule.style.bg.rgb, "#FFC7CE");
  assert.equal(cf[1].rule.config[1].color, "#63BE7B");
  assert.equal(cf[2].rule.value, "P");
  assert.equal(cf[3].rule.value, "=LEN(A2)>4");
  assert.equal(cf[4].rule.config.positiveColor, "#638EC6");

  assert.deepEqual(resource(book, RESOURCE.filter)[id].ref, { startRow: 0, endRow: 3, startColumn: 0, endColumn: 3, rangeType: 0 });
  const names = Object.values(resource(book, RESOURCE.names)) as any[];
  assert.equal(names[0].name, "Quantities");
  assert.equal(names[0].formulaOrRefString, "Data!$B$2:$B$4");
});

test("xlsx -> Univer -> xlsx keeps what Excel shows", async () => {
  const book = await xlsxToUniver(await fixture());
  const out = new ExcelJS.Workbook();
  await out.xlsx.load((await univerToXlsx(book)) as any);
  assert.deepEqual(out.worksheets.map((w) => w.name), ["Data", "My Notes", "Hidden"]);
  assert.equal(out.getWorksheet("Hidden")!.state, "hidden");
  const ws = out.getWorksheet("Data")!;

  assert.equal(ws.getCell("B2").value, 3);
  assert.deepEqual(ws.getCell("D2").value, { formula: "B2*C2", result: 4.5 });
  assert.equal((ws.getCell("D4").value as any).formula, "B4*C4");
  assert.equal((ws.getCell("D5").value as any).formula, '_xlfn.XLOOKUP("Pear",A2:A4,D2:D4)');
  assert.equal(ws.getCell("C2").numFmt, "$#,##0.00");
  assert.equal(ws.getCell("E1").numFmt, "yyyy-mm-dd");
  assert.equal(ws.getCell("G2").value, true);
  assert.deepEqual((ws.getCell("G3").value as any).result, { error: "#DIV/0!" });

  const a1 = ws.getCell("A1");
  assert.equal(a1.font.bold, true);
  assert.equal(a1.font.color?.argb, "FF4F81BD");
  assert.equal((a1.fill as any).fgColor.argb, "FFFFFF00");
  assert.equal(a1.border.bottom?.style, "medium");
  assert.equal(a1.alignment.horizontal, "center");
  assert.equal(a1.alignment.wrapText, true);
  assert.equal(ws.getCell("H2").alignment.textRotation, 45);

  assert.deepEqual(ws.getCell("F1").value, { text: "Site", hyperlink: "https://example.com/" });
  assert.deepEqual(ws.getCell("F2").value, { text: "Go to notes", hyperlink: "#'My Notes'!B3" });
  assert.deepEqual((ws.getCell("G1").value as any).richText.map((r: any) => [r.text, !!r.font?.bold]), [
    ["bold", true],
    [" plain", false],
  ]);
  assert.equal(ws.getCell("A2").note, "first fruit");

  assert.deepEqual((ws as any).model.merges, ["A7:C8"]);
  assert.equal(ws.getColumn(1).width, 20);
  assert.equal(ws.getColumn(8).hidden, true);
  assert.equal(ws.getRow(3).height, 30);
  assert.equal(ws.getRow(6).hidden, true);
  const view: any = ws.views[0];
  assert.equal(view.state, "frozen");
  assert.equal(view.xSplit, 1);
  assert.equal(view.ySplit, 1);
  assert.equal(view.showGridLines, false);
  assert.equal(view.zoomScale, 125);
  assert.equal((ws.properties as any).tabColor.argb, "FF00B050");
  assert.equal(ws.autoFilter, "A1:D4");

  assert.equal(ws.getCell("B2").dataValidation?.type, "whole");
  assert.equal(ws.getCell("B3").dataValidation?.error, "1-100 only");
  assert.deepEqual(ws.getCell("A10").dataValidation?.formulae, ['"Red,Green,Blue"']);

  const rules = ((ws as any).conditionalFormattings as any[]).flatMap((b) => b.rules.map((r: any) => ({ ref: b.ref, ...r })));
  assert.equal(rules.length, 5);
  assert.deepEqual(
    rules.map((r) => [r.ref, r.type]),
    [
      ["B2:B4", "cellIs"],
      ["B2:B4", "colorScale"],
      ["A2:A4", "expression"],
      ["A2:A4", "expression"],
      ["C2:C4", "dataBar"],
    ],
  );
  assert.deepEqual(rules[0].formulae, ["2"]);
  assert.equal(rules[2].formulae[0], 'NOT(ISERROR(SEARCH("P",A2)))');
  assert.deepEqual(out.definedNames.model, [{ name: "Quantities", ranges: ["Data!$B$2:$B$4"] }]);
});

test("exports what the Univer editor produces", async () => {
  // Shaped like workbook.save(): style ids and inline styles, shared formulas
  // (`si` only), booleans as 1/0, rich-text links, plugin resources.
  const book: UniverWorkbook = {
    id: "wb",
    name: "Edited",
    appVersion: "0.25.1",
    locale: "enUS",
    sheetOrder: ["s1", "s2"],
    styles: { x1: { bl: 1, bg: { rgb: "rgb(255,0,0)" }, n: { pattern: "0.00%" } } },
    sheets: {
      s1: {
        id: "s1",
        name: "Main",
        rowCount: 1000,
        columnCount: 20,
        defaultColumnWidth: 88,
        defaultRowHeight: 24,
        cellData: {
          0: { 0: { v: 1, t: 2 }, 1: { v: 2, t: 2, s: "x1" }, 2: { f: "=A1+B1", si: "abc", v: 3, t: 2 } },
          1: { 0: { v: 10, t: 2 }, 1: { v: 20, t: 2 }, 2: { si: "abc", v: 30, t: 2 }, 3: { v: 1, t: 3 } },
          2: {
            0: {
              p: {
                id: "d",
                documentStyle: {},
                body: {
                  dataStream: "jump\r\n",
                  customRanges: [{ rangeId: "r", rangeType: 0, startIndex: 0, endIndex: 3, properties: { url: "#gid=s2&range=A1" } }],
                },
              },
            },
            1: { v: "italic", t: 1, s: { it: 1, cl: { rgb: "#00ff00" } } },
          },
        },
        mergeData: [
          { startRow: 4, endRow: 5, startColumn: 0, endColumn: 1 },
          { startRow: 4, endRow: 5, startColumn: 0, endColumn: 1 },
        ],
        columnData: { 0: { w: 145 } },
        rowData: { 1: { h: 40 } },
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      },
      s2: { id: "s2", name: "Other sheet", rowCount: 1000, columnCount: 20, cellData: { 0: { 0: { v: "here", t: 1 } } } },
    },
    resources: [
      { name: RESOURCE.note, data: JSON.stringify({ s1: { 9: { 9: { note: "on an empty cell", row: 9, col: 9 } } } }) },
      {
        name: RESOURCE.cf,
        data: JSON.stringify({
          s1: [
            {
              cfId: "a",
              stopIfTrue: false,
              ranges: [{ startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 }],
              rule: { type: "highlightCell", subType: "duplicateValues", style: { bg: { rgb: "#ffeb9c" } } },
            },
            {
              cfId: "b",
              stopIfTrue: false,
              ranges: [{ startRow: 0, endRow: 9, startColumn: 1, endColumn: 1 }],
              rule: {
                type: "iconSet",
                isShowValue: true,
                config: [
                  { operator: "greaterThanOrEqual", value: { type: "percent", value: 67 }, iconType: "3Arrows", iconId: "0" },
                  { operator: "greaterThanOrEqual", value: { type: "percent", value: 33 }, iconType: "3Arrows", iconId: "1" },
                  { operator: "lessThan", value: { type: "percent", value: 33 }, iconType: "3Arrows", iconId: "2" },
                ],
              },
            },
          ],
        }),
      },
      {
        name: RESOURCE.dv,
        data: JSON.stringify({
          s1: [{ uid: "v", type: "list", formula1: "=$A$1:$A$2", ranges: [{ startRow: 0, endRow: 4, startColumn: 4, endColumn: 4 }] }],
        }),
      },
    ],
  };
  const out = new ExcelJS.Workbook();
  await out.xlsx.load((await univerToXlsx(book)) as any);
  const ws = out.getWorksheet("Main")!;
  assert.deepEqual(ws.getCell("C1").value, { formula: "A1+B1", result: 3 });
  assert.deepEqual(ws.getCell("C2").value, { formula: "A2+B2", result: 30 }, "si-only cells are expanded");
  assert.equal(ws.getCell("D2").value, true);
  assert.equal(ws.getCell("B1").font.bold, true);
  assert.equal((ws.getCell("B1").fill as any).fgColor.argb, "FFFF0000");
  assert.equal(ws.getCell("B1").numFmt, "0.00%");
  assert.equal(ws.getCell("B3").font.italic, true);
  assert.equal(ws.getCell("B3").font.color?.argb, "FF00FF00");
  assert.deepEqual(ws.getCell("A3").value, { text: "jump", hyperlink: "#'Other sheet'!A1" });
  assert.deepEqual((ws as any).model.merges, ["A5:B6"]);
  assert.equal(ws.getColumn(1).width, 20);
  assert.equal(ws.getRow(2).height, 30);
  assert.equal((ws.views[0] as any).ySplit, 1);
  assert.equal(ws.getCell("J10").note, "on an empty cell");
  assert.deepEqual(ws.getCell("E3").dataValidation?.formulae, ["$A$1:$A$2"]);
  const rules = ((ws as any).conditionalFormattings as any[]).flatMap((b) => b.rules);
  assert.equal(rules[0].type, "expression");
  assert.equal(rules[0].formulae[0], "COUNTIF($A$1:$A$10,A1)>1");
  assert.equal(rules[1].type, "iconSet");
  assert.equal(rules[1].iconSet, "3Arrows");
  assert.deepEqual(rules[1].cfvo.map((c: any) => c.value), [0, 33, 67]);

  // ...and the exported file comes back into the same Univer shape.
  const again = await xlsxToUniver(await univerToXlsx(book));
  const main = sheetByName(again, "Main");
  assert.equal(main.cellData[1][2].f, "=A2+B2");
  const cf = resource(again, RESOURCE.cf)[main.id];
  assert.deepEqual(
    cf[1].rule.config.map((c: any) => [c.operator, c.value.value, c.iconId]),
    [
      ["greaterThanOrEqual", 67, "0"],
      ["greaterThanOrEqual", 33, "1"],
      ["lessThan", 33, "2"],
    ],
  );
});

test("reads files from another writer (SheetJS), incl. notes on empty cells", async () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["a", 1],
    ["b", 2],
  ]);
  ws["B3"] = { t: "n", f: "SUM(B1:B2)", v: 3 };
  ws["!ref"] = "A1:D3";
  ws["D1"] = { t: "z", c: [{ a: "me", t: "lonely note" }] } as any;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const book = await xlsxToUniver(new Uint8Array(bytes));
  const s = sheetByName(book, "S");
  assert.equal(s.cellData[2][1].f, "=SUM(B1:B2)");
  assert.equal(s.cellData[2][1].v, 3);
  assert.equal(resource(book, RESOURCE.note)[s.id][0][3].note, "lonely note");
});

test("legacy formats go through SheetJS", () => {
  const csv = new TextEncoder().encode("name,qty\nfoo,3\nbar,4\n");
  const book = legacyToUniver(csv, "list");
  const s = Object.values(book.sheets)[0];
  assert.equal(s.cellData[0][0].v, "name");
  assert.equal(s.cellData[2][1].v, 4);
});

test("formula helpers", () => {
  assert.equal(formulaFromExcel("_xlfn.CONCAT(A1,\"_xlfn.\")"), '=CONCAT(A1,"_xlfn.")');
  assert.equal(formulaFromExcel("_xlfn._xlws.SORT(A1:A9)"), "=SORT(A1:A9)");
  assert.equal(formulaToExcel("=SORT(UNIQUE(A1:A9))+STDEV.S(B:B)"), "_xlfn._xlws.SORT(_xlfn.UNIQUE(A1:A9))+_xlfn.STDEV.S(B:B)");
  assert.equal(formulaToExcel('=SUM(A1)&"XLOOKUP("'), 'SUM(A1)&"XLOOKUP("');
  assert.equal(shiftFormula("=A1+$B$2+B$3+$C4+'Q1 Data'!A1+LOG10(A2)", 2, 1), "=B3+$B$2+C$3+$C6+'Q1 Data'!B3+LOG10(B4)");
  assert.equal(toArgb("#abc"), "FFAABBCC");
  assert.equal(toArgb("rgb(255,0,16)"), "FFFF0010");
  assert.equal(toArgb("rgba(0,0,0,0.5)"), "80000000");
});

// Tables, images, page setup, filter conditions and formula names.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAQYGBgB6JgYBnxWv0AAAAABJRU5ErkJggg==", "base64");

async function extrasFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales");
  ws.addTable({
    name: "Orders",
    ref: "A1",
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [{ name: "Region", totalsRowLabel: "Sum" }, { name: "Units", totalsRowFunction: "sum" }],
    rows: [["West", 30], ["East", 10], ["North", 20]],
  });
  ws.getCell("D1").value = "Score";
  [5, 15, 25].forEach((v, i) => (ws.getCell(`D${i + 2}`).value = v));
  ws.autoFilter = "D1:D4";
  ws.getRow(2).hidden = true; // hidden by the filter below (5 is not > 10)
  const img = wb.addImage({ buffer: PNG as any, extension: "png" });
  ws.addImage(img, { tl: { nativeCol: 5, nativeColOff: 9525 * 10, nativeRow: 1, nativeRowOff: 0 }, br: { nativeCol: 7, nativeColOff: 0, nativeRow: 6, nativeRowOff: 9525 * 4 }, editAs: "oneCell" } as any);
  ws.addImage(img, { tl: { col: 8, row: 0 }, ext: { width: 100, height: 50 } });
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: "A1:D10", printTitlesRow: "1:1" } as any;
  ws.headerFooter = { oddHeader: "&CQuarterly", oddFooter: "&RPage &P of &N" } as any;
  wb.addWorksheet("Other").getCell("A1").value = 1;
  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  // ExcelJS can't write filter conditions or formula names: add them as Excel would.
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.file(
    "xl/worksheets/sheet1.xml",
    sheet.replace(/<autoFilter ref="D1:D4"\/>/, '<autoFilter ref="D1:D4"><filterColumn colId="0"><customFilters><customFilter operator="greaterThan" val="10"/></customFilters></filterColumn></autoFilter>'),
  );
  const book = await zip.file("xl/workbook.xml")!.async("string");
  zip.file(
    "xl/workbook.xml",
    book.replace(
      "</definedNames>",
      '<definedName name="TaxRate">0.2</definedName><definedName name="Doubled">_xlfn.CEILING.MATH(Sales!$B$2)*2</definedName><definedName name="Local" localSheetId="1">Other!$A$1</definedName></definedNames>',
    ),
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

test("imports tables, images, page setup, filter conditions and formula names", async () => {
  const book = await xlsxToUniver(await extrasFixture());
  const sales = sheetByName(book, "Sales");
  const other = sheetByName(book, "Other");

  const table = resource(book, RESOURCE.table)[sales.id].tables[0];
  assert.equal(table.name, "Orders");
  assert.deepEqual([table.range.startRow, table.range.endRow, table.range.startColumn, table.range.endColumn], [0, 3, 0, 1], "totals row stays outside");
  assert.deepEqual(table.columns.map((c: any) => c.displayName), ["Region", "Units"]);
  assert.equal(table.options.tableStyleId, "table-default-0", "Medium9 uses accent 1, the blue look");
  assert.equal(table.meta.xlsx.style.theme, "TableStyleMedium9");
  assert.equal(table.meta.xlsx.totalsRow, true);

  const drawings = resource(book, RESOURCE.drawing)[sales.id];
  assert.equal(drawings.order.length, 2);
  const [a, b] = drawings.order.map((id: string) => drawings.data[id]);
  assert.match(a.source, /^data:image\/png;base64,/);
  assert.deepEqual(a.sheetTransform.from, { column: 5, columnOffset: 10, row: 1, rowOffset: 0 });
  assert.deepEqual(a.sheetTransform.to, { column: 7, columnOffset: 0, row: 6, rowOffset: 4 });
  assert.equal(b.sheetTransform.from.column, 8);
  assert.equal(b.sheetTransform.to.column, 9, "100px from I spans into J (64px columns)");

  assert.equal((sales.custom?.xlsx?.pageSetup as any).orientation, "landscape");
  assert.equal((sales.custom?.xlsx?.pageSetup as any).printArea, "A1:D10");
  assert.equal((sales.custom?.xlsx?.headerFooter as any).oddFooter, "&RPage &P of &N");
  assert.equal(other.custom, undefined, "nothing stored for default page setup");

  const filter = resource(book, RESOURCE.filter)[sales.id];
  assert.deepEqual(filter.filterColumns, [{ colId: 3, customFilters: { customFilters: [{ operator: "greaterThan", val: 10 }] } }]);
  assert.deepEqual(filter.cachedFilteredOut, [1]);
  assert.equal(sales.rowData?.[1]?.hd, undefined, "the filter hides the row, not a manual hide");

  const names = Object.values(resource(book, RESOURCE.names)) as any[];
  const byName = (n: string) => names.find((x) => x.name === n);
  assert.equal(byName("TaxRate").formulaOrRefString, "=0.2");
  assert.equal(byName("Doubled").formulaOrRefString, "=CEILING.MATH(Sales!$B$2)*2");
  assert.equal(byName("Local").formulaOrRefString, "Other!$A$1");
  assert.equal(byName("Local").localSheetId, other.id);
});

test("exports tables, images, page setup, filter conditions and formula names", async () => {
  const book = await xlsxToUniver(await extrasFixture());
  const bytes = await univerToXlsx(book);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(bytes as any);
  const ws = out.getWorksheet("Sales")!;

  const t = (ws as any).getTables()[0].table;
  assert.equal(t.name, "Orders");
  assert.equal(t.tableRef, "A1:B5");
  assert.equal(t.totalsRow, true);
  assert.equal(t.style.theme, "TableStyleMedium9", "the Excel look survives when unchanged");
  assert.equal(t.columns[1].totalsRowFunction, "sum");
  assert.equal(ws.getCell("A3").value, "East");
  assert.equal((ws.getCell("B5").value as any).formula, "SUBTOTAL(109,Orders[Units])");

  const images = ws.getImages();
  assert.equal(images.length, 2);
  assert.equal(out.getImage(Number(images[0].imageId)).extension, "png");
  assert.equal((images[0].range.tl as any).nativeCol, 5);
  assert.equal((images[0].range.tl as any).nativeColOff, 9525 * 10);
  assert.equal((images[0].range.br as any).nativeRow, 6);

  assert.equal(ws.pageSetup.orientation, "landscape");
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.fitToHeight, 0);
  assert.equal(ws.pageSetup.printArea, "A1:D10");
  assert.equal(ws.pageSetup.printTitlesRow, "1:1");
  assert.equal(ws.headerFooter.oddHeader, "&CQuarterly");

  assert.equal(ws.getRow(2).hidden, true, "filtered-out rows are hidden for Excel");
  const zip = await JSZip.loadAsync(bytes);
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheetXml, /<autoFilter ref="D1:D4"><filterColumn colId="0"><customFilters><customFilter operator="greaterThan" val="10"\/><\/customFilters><\/filterColumn><\/autoFilter>/);
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  assert.match(wbXml, /<definedName name="TaxRate">0.2<\/definedName>/);
  assert.match(wbXml, /<definedName name="Doubled">_xlfn.CEILING.MATH\(Sales!\$B\$2\)\*2<\/definedName>/);
  assert.match(wbXml, /<definedName name="Local" localSheetId="1">Other!\$A\$1<\/definedName>/);
  assert.match(wbXml, /_xlnm.Print_Area/, "ExcelJS's print area name is kept next to ours");
  assert.equal((wbXml.match(/<definedNames>/g) || []).length, 1);
});

test("a table restyled in the editor gets the matching Excel style", async () => {
  const book = await xlsxToUniver(await extrasFixture());
  const res = book.resources!.find((r) => r.name === RESOURCE.table)!;
  const data = JSON.parse(res.data);
  const sales = sheetByName(book, "Sales").id;
  data[sales].tables[0].options.tableStyleId = "table-default-2";
  res.data = JSON.stringify(data);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load((await univerToXlsx(book)) as any);
  assert.equal((out.getWorksheet("Sales") as any).getTables()[0].table.style.theme, "TableStyleMedium7");
});

test("CSV export shows formatted values and quotes where needed", () => {
  const book: UniverWorkbook = {
    id: "w",
    name: "w",
    appVersion: "",
    locale: "enUS",
    sheetOrder: ["s1"],
    styles: { money: { n: { pattern: "$#,##0.00" } } },
    sheets: {
      s1: {
        id: "s1",
        name: "S",
        rowCount: 10,
        columnCount: 5,
        cellData: {
          0: { 0: { v: "Name" }, 1: { v: "Price" }, 2: { v: "Ok" } },
          1: { 0: { v: 'Widget, "large"' }, 1: { v: 1234.5, t: 2, s: "money" }, 2: { v: 1, t: 3 } },
          3: { 1: { v: 7, t: 2, f: "=3+4" } },
        },
      },
    },
  };
  assert.equal(univerSheetToCsv(book), 'Name,Price,Ok\r\n"Widget, ""large""","$1,234.50",TRUE\r\n,,\r\n,7,\r\n');
});
