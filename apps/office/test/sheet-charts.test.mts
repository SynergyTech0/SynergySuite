import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addChartsToXlsx, chartData, chartFromSelection, chartResource, SHEET_CHART_RESOURCE, withoutChartFrames, type ChartType, type SheetChartResource } from "../lib/sheet-charts.ts";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";

function bookWithCharts(types: ChartType[]): UniverWorkbook {
  const id = "sheet-1";
  const charts = types.map((type, index) => ({ ...chartFromSelection(id, { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 }, type, `chart-${index}`), title: `${type} sales` }));
  const chartState: SheetChartResource = { sheets: { [id]: charts } };
  return {
    id: "book", name: "Sales", appVersion: "", locale: "enUS", sheetOrder: [id], styles: {},
    sheets: { [id]: { id, name: "Data", rowCount: 100, columnCount: 26, cellData: {
      0: { 0: { v: "Month", t: 1 }, 1: { v: "North", t: 1 }, 2: { v: "South", t: 1 } },
      1: { 0: { v: "Jan", t: 1 }, 1: { v: 10, t: 2 }, 2: { v: 8, t: 2 } },
      2: { 0: { v: "Feb", t: 1 }, 1: { v: 12, t: 2 }, 2: { v: 9, t: 2 } },
      3: { 0: { v: "Mar", t: 1 }, 1: { v: 15, t: 2 }, 2: { v: 13, t: 2 } },
    } } },
    resources: [{ name: SHEET_CHART_RESOURCE, data: JSON.stringify(chartState) }],
  };
}

test("chart selection maps headers, labels, live values and chart type", () => {
  const book = bookWithCharts(["column"]);
  const chart = chartResource(book.resources).sheets["sheet-1"][0];
  assert.deepEqual(chartData(book, chart), [
    { name: "North", categories: ["Jan", "Feb", "Mar"], values: [10, 12, 15] },
    { name: "South", categories: ["Jan", "Feb", "Mar"], values: [8, 9, 13] },
  ]);
  book.sheets["sheet-1"].cellData[2][1].v = 42;
  assert.equal(chartData(book, chart)[0].values[1], 42);
  assert.throws(() => chartFromSelection("sheet-1", { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }, "line", "invalid"), /two data rows/);
});

test("imports column, line and pie charts written by a separate spreadsheet library", async () => {
  const bytes = new Uint8Array(await readFile(new URL("./fixtures/openpyxl-charts.xlsx", import.meta.url)));
  const book = await xlsxToUniver(bytes, "Foreign charts");
  const id = book.sheetOrder[0];
  const charts = chartResource(book.resources).sheets[id];
  assert.deepEqual(charts.map((chart) => [chart.type, chart.title, chart.anchor.row, chart.anchor.column]), [
    ["column", "Sales columns", 1, 4], ["line", "Sales line", 17, 4], ["pie", "North share", 33, 4],
  ]);
  assert.deepEqual(chartData(book, charts[0])[0], { name: "North", categories: ["Jan", "Feb", "Mar"], values: [10, 12, 15] });
  assert.deepEqual(chartData(book, charts[2])[0].values, [10, 12, 15]);
});

test("exports native editable chart parts with workbook relationships and data caches", async () => {
  const source = bookWithCharts(["column", "bar", "line", "pie"]);
  const bytes = await univerToXlsx(source);
  const zip = await JSZip.loadAsync(bytes);
  const chartPaths = Object.keys(zip.files).filter((path) => /^xl\/charts\/chart\d+\.xml$/.test(path));
  assert.equal(chartPaths.length, 4);
  const drawing = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  const drawingRels = await zip.file("xl/drawings/_rels/drawing1.xml.rels")!.async("string");
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 4);
  assert.equal((drawingRels.match(/relationships\/chart"/g) || []).length, 4);
  assert.match(sheet, /<drawing r:id="rId\d+"\/>/);
  const chartXml = await zip.file(chartPaths[0])!.async("string");
  assert.match(chartXml, /<c:f>&apos;Data&apos;!\$A\$2:\$A\$4<\/c:f>/);
  assert.match(chartXml, /<c:pt idx="1"><c:v>12<\/c:v><\/c:pt>/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.getWorksheet("Data")!.getCell("B3").value, 12);
  const imported = await xlsxToUniver(bytes, "Reloaded");
  const charts = chartResource(imported.resources).sheets[imported.sheetOrder[0]];
  assert.deepEqual(charts.map((chart) => chart.type), ["column", "bar", "line", "pie"]);
  assert.deepEqual(chartData(imported, charts[0])[0].values, [10, 12, 15]);
});

test("adding a chart to a sheet with an image preserves both drawing objects", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.getCell("A1").value = "Month";
  const imageId = workbook.addImage({ base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9R5ZkAAAAASUVORK5CYII=", extension: "png" });
  sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 10, height: 10 } });
  const bytes = await addChartsToXlsx(new Uint8Array(await workbook.xlsx.writeBuffer()), bookWithCharts(["line"]));
  const zip = await JSZip.loadAsync(bytes);
  const drawing = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  const rels = await zip.file("xl/drawings/_rels/drawing1.xml.rels")!.async("string");
  assert.match(drawing, /<xdr:pic>/);
  assert.match(drawing, /<xdr:graphicFrame/);
  assert.match(rels, /relationships\/image"/);
  assert.match(rels, /relationships\/chart"/);
  const clean = new ExcelJS.Workbook();
  await clean.xlsx.load(await withoutChartFrames(bytes));
  assert.equal(clean.getWorksheet("Data")!.getImages().length, 1);
});
