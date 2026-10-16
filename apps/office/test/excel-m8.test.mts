// Milestone 8: the last partial items of the Excel checklist (see
// /mnt/project-files/office-parity/excel-checklist.md), each checked on a
// small workbook built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { chartFromSelection, chartResource, SHEET_CHART_RESOURCE, type SheetChartResource } from "../lib/sheet-charts.ts";
import { univerToXlsx, xlsxToUniver, type UniverWorkbook } from "../lib/xlsx.ts";
import { converged, expand3dRefs, has3dRef } from "../lib/sheet-calc.ts";

const res = (b: UniverWorkbook, n: string) => JSON.parse(b.resources?.find((r) => r.name === n)?.data || "null");
const zipText = async (bytes: Uint8Array, part: string) => (await JSZip.loadAsync(bytes)).file(part)?.async("string");

function salesBook(extra: Partial<UniverWorkbook> = {}): UniverWorkbook {
  const id = "sheet-1";
  return {
    id: "book", name: "Sales", appVersion: "", locale: "enUS", sheetOrder: [id], styles: {},
    sheets: { [id]: { id, name: "Data", rowCount: 100, columnCount: 26, cellData: {
      0: { 0: { v: "Month", t: 1 }, 1: { v: "North", t: 1 } },
      1: { 0: { v: "Jan", t: 1 }, 1: { v: 10, t: 2 } },
      2: { 0: { v: "Feb", t: 1 }, 1: { v: 12, t: 2 } },
    } } },
    resources: [],
    ...extra,
  };
}

test("a very hidden sheet stays very hidden", async () => {
  const book = salesBook();
  book.sheetOrder.push("sheet-2");
  book.sheets["sheet-2"] = { id: "sheet-2", name: "Secret", rowCount: 10, columnCount: 5, cellData: { 0: { 0: { v: "x", t: 1 } } }, hidden: 1, custom: { xlsx: { veryHidden: true } } } as any;
  const bytes = await univerToXlsx(book);
  assert.match((await zipText(bytes, "xl/workbook.xml"))!, /<sheet [^>]*name="Secret"[^>]*state="veryHidden"/);
  const back = await xlsxToUniver(bytes);
  const secret = Object.values(back.sheets).find((s) => s.name === "Secret")!;
  assert.equal(secret.hidden, 1);
  assert.equal((secret as any).custom?.xlsx?.veryHidden, true);
});

test("a chart sheet is written as Excel's chart sheet and comes back as one, in its place", async () => {
  const book = salesBook();
  book.sheetOrder.splice(0, 0, "sheet-c");
  book.sheets["sheet-c"] = { id: "sheet-c", name: "Sales chart", rowCount: 100, columnCount: 26, cellData: {} };
  const chart = { ...chartFromSelection("sheet-1", { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }, "column", "c1"), title: "North sales" };
  const state: SheetChartResource = { sheets: { "sheet-c": [chart] }, chartSheets: ["sheet-c"] };
  book.resources = [{ name: SHEET_CHART_RESOURCE, data: JSON.stringify(state) }];
  const bytes = await univerToXlsx(book);
  const zip = await JSZip.loadAsync(bytes);
  const wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  assert.match(wbRels, /relationships\/chartsheet" Target="chartsheets\/sheet1\.xml"/);
  assert.match(await zip.file("xl/chartsheets/sheet1.xml")!.async("string"), /<chartsheet [^>]*>[\s\S]*<drawing r:id="rId1"\/>/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /chartsheet\+xml/);
  const charts = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p));
  assert.equal(charts.length, 1);
  assert.match(await zip.file(charts[0])!.async("string"), /(&apos;)?Data(&apos;)?!\$B\$2:\$B\$3/);

  const back = await xlsxToUniver(bytes);
  assert.deepEqual(back.sheetOrder.map((id) => back.sheets[id].name), ["Sales chart", "Data"]);
  const model = chartResource(back.resources);
  const csId = back.sheetOrder[0];
  assert.deepEqual(model.chartSheets, [csId]);
  assert.equal(model.sheets[csId][0].title, "North sales");
  assert.equal(model.sheets[csId][0].series[0].values.sheetId, back.sheetOrder[1]);
  // Things that count sheets by position (cell values, names) still line up.
  assert.equal(back.sheets[back.sheetOrder[1]].cellData[1][1].v, 10);
});

test("iteration stops once no result moves more than the maximum change", () => {
  const a = new Map<string, unknown>([["x", 1], ["y", "a"]]);
  assert.equal(converged(a, new Map<string, unknown>([["x", 1.0005], ["y", "a"]]), 0.001), true);
  assert.equal(converged(a, new Map<string, unknown>([["x", 1.01], ["y", "a"]]), 0.001), false);
  assert.equal(converged(a, new Map<string, unknown>([["x", 1], ["y", "b"]]), 0.001), false);
});

/** Little-endian record writer (as in the slides metafile tests). */
function bytes(parts: [("u16" | "i16" | "u32" | "i32"), number][]): Uint8Array {
  const size = parts.reduce((n, [t]) => n + (t.endsWith("16") ? 2 : 4), 0);
  const dv = new DataView(new ArrayBuffer(size));
  let o = 0;
  for (const [t, v] of parts) {
    if (t === "u16") dv.setUint16(o, v, true);
    else if (t === "i16") dv.setInt16(o, v, true);
    else if (t === "u32") dv.setUint32(o, v, true);
    else dv.setInt32(o, v, true);
    o += t.endsWith("16") ? 2 : 4;
  }
  return new Uint8Array(dv.buffer);
}
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) (out.set(x, o), (o += x.length));
  return out;
};
/** A 100x50 EMF with one red rectangle. */
function emf(): Uint8Array {
  const header = bytes([
    ["u32", 1], ["u32", 88], ["i32", 0], ["i32", 0], ["i32", 100], ["i32", 50], ["i32", 0], ["i32", 0], ["i32", 2645], ["i32", 1323],
    ["u32", 0x464d4520], ["u32", 0x10000], ["u32", 0], ["u32", 4], ["u16", 2], ["u16", 0], ["u32", 0], ["u32", 0], ["u32", 0],
    ["i32", 1024], ["i32", 768], ["i32", 270], ["i32", 203],
  ]);
  const brush = bytes([["u32", 39], ["u32", 24], ["u32", 1], ["u32", 0], ["u32", 0x0000ff], ["u32", 0]]);
  const select = bytes([["u32", 37], ["u32", 12], ["u32", 1]]);
  const rect = bytes([["u32", 43], ["u32", 24], ["i32", 10], ["i32", 10], ["i32", 90], ["i32", 40]]);
  const eof = bytes([["u32", 14], ["u32", 20], ["u32", 0], ["u32", 16], ["u32", 20]]);
  return cat(header, brush, select, rect, eof);
}

test("an EMF picture is drawn as SVG and goes back into the .xlsx as the same EMF", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pictures");
  ws.getCell("A1").value = "logo";
  const original = emf();
  const id = wb.addImage({ buffer: Buffer.from(original), extension: "emf" as "png" });
  ws.addImage(id, { tl: { col: 1, row: 1 }, ext: { width: 100, height: 50 } } as any);
  const book = await xlsxToUniver(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  const drawings = res(book, "SHEET_DRAWING_PLUGIN");
  const pic = Object.values(drawings[book.sheetOrder[0]].data)[0] as any;
  assert.match(pic.source, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(pic.source.split(",")[1], "base64").toString("utf8"), /<svg[\s\S]*fill="#ff0000"|<svg[\s\S]*rgb\(255, ?0, ?0\)|<svg/);
  assert.equal(pic.metafile.ext, "emf");
  const out = await JSZip.loadAsync(await univerToXlsx(book));
  const media = Object.keys(out.files).filter((p) => /^xl\/media\/./.test(p));
  assert.deepEqual(media.map((p) => p.split(".").at(-1)), ["emf"]);
  assert.deepEqual(new Uint8Array(await out.file(media[0])!.async("uint8array")), original);
  assert.match(await out.file("[Content_Types].xml")!.async("string"), /Extension="emf" ContentType="image\/x-emf"/);
});

test("table slicers and pivot timelines are Excel's own in .xlsx, and Excel's come in", async () => {
  const { SLICER_COMPONENT } = await import("../lib/slicers.ts");
  const wbx = new ExcelJS.Workbook();
  const ws = wbx.addWorksheet("Data");
  ws.addTable({ name: "Sales", ref: "A1", columns: [{ name: "Region" }, { name: "Date" }, { name: "Amount" }], rows: [["West", 45366, 5], ["East", 45400, 3], ["West", 45500, 4]] });
  const book = await xlsxToUniver(new Uint8Array((await wbx.xlsx.writeBuffer()) as ArrayBuffer));
  const sid = book.sheetOrder[0];
  const pivot = { id: "p1", name: "Pivot 1", source: { sheetId: sid, range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 } }, target: { sheetId: sid, row: 6, column: 0 }, rows: ["Region"], columns: [], values: [{ field: "Amount", agg: "sum" }], filters: [], lastSize: { rows: 3, columns: 2 } };
  const dom = (id: string, data: unknown, left: number) => ({ drawingId: id, drawingType: 8, componentKey: SLICER_COMPONENT, unitId: "u", subUnitId: sid, transform: { left, top: 40, width: 200, height: 160 }, data, allowTransform: true });
  const slicer = { kind: "slicer", caption: "Region", source: { type: "table", tableId: "x", name: "Sales" }, field: "Region", selected: null, columns: 2 };
  const timeline = { kind: "timeline", caption: "When", source: { type: "pivot", pivotId: "p1", name: "Pivot 1" }, field: "Date", level: "quarters", period: null };
  book.resources = [
    ...(book.resources || []).filter((r) => r.name !== "SHEET_DRAWING_PLUGIN"),
    { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ [sid]: { data: { a: dom("a", slicer, 300), b: dom("b", timeline, 520) }, order: ["a", "b"] } }) },
    { name: "SHEET_SYNERGY_PIVOT_PLUGIN", data: JSON.stringify({ pivots: [pivot] }) },
  ];
  const bytes = await univerToXlsx(book);
  const zip = await JSZip.loadAsync(bytes);
  const text = (p: string) => zip.file(p)!.async("string");
  const tableId = /<table\b[^>]*\bid="(\d+)"/.exec(await text(Object.keys(zip.files).find((p) => /^xl\/tables\/[^/]+\.xml$/.test(p))!))![1];
  assert.match(await text("xl/slicerCaches/slicerCache1.xml"), new RegExp(`sourceName="Region"><extLst><x:ext uri="\\{2F2917AC-EB37-4324-AD4E-5DD8C200BD13\\}"[^>]*><x15:tableSlicerCache tableId="${tableId}" column="1"/>`));
  assert.match(await text("xl/slicers/slicer1.xml"), /<slicer name="Region" cache="Slicer_Region" caption="Region" columnCount="2"/);
  const tc = await text("xl/timelineCaches/timelineCache1.xml");
  assert.match(tc, /name="NativeTimeline_Date" sourceName="Date"><pivotTables><pivotTable tabId="1" name="Pivot 1"\/><\/pivotTables><state [^>]*pivotCacheId="1" filterType="unknown"><bounds startDate="2024-03-15T00:00:00" endDate="2024-07-27T00:00:00"\/><\/state>/);
  assert.match(await text("xl/timelines/timeline1.xml"), /<timeline name="When" cache="NativeTimeline_Date" caption="When" level="1"/);
  assert.match(await text("xl/pivotCache/pivotCacheDefinition1.xml"), /<cacheField name="Date" numFmtId="14"><sharedItems containsSemiMixedTypes="0" containsNonDate="0" containsDate="1" containsString="0" minDate="2024-03-15T00:00:00" maxDate="2024-07-27T00:00:00"\/>/);
  assert.match(await text("xl/pivotCache/pivotCacheRecords1.xml"), /<d v="2024-03-15T00:00:00"\/>/);
  const wb = await text("xl/workbook.xml");
  assert.match(wb, /<x15:slicerCaches xmlns:x14="[^"]+"><x14:slicerCache r:id="rId\d+"\/><\/x15:slicerCaches>/);
  assert.match(wb, /<x15:timelineCacheRefs><x15:timelineCacheRef r:id="rId\d+"\/><\/x15:timelineCacheRefs>/);
  assert.match(wb, /<definedName name="NativeTimeline_Date">#N\/A<\/definedName>/);
  const sheetXml = await text("xl/worksheets/sheet1.xml");
  assert.match(sheetXml, /<x15:timelineRefs><x15:timelineRef r:id="rId\d+"\/><\/x15:timelineRefs>/);
  assert.match(sheetXml, /\{3A4CF648-6AED-40f4-86FF-DC5316D8AED3\}/);
  const ct = await text("[Content_Types].xml");
  assert.match(ct, /PartName="\/xl\/timelines\/timeline1.xml" ContentType="application\/vnd.ms-excel.timeline\+xml"/);
  const drawingPath = Object.keys(zip.files).find((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p))!;
  assert.match(await text(drawingPath), /<tsle:timeslicer [^>]*name="When"\/>/);

  // As if made in Excel: without our hidden copy, Excel's own parts are read.
  zip.file("xl/workbook.xml", wb.replace(/<definedName name="_SynergySlicer[^>]*>[\s\S]*?<\/definedName>/g, ""));
  const back = await xlsxToUniver(new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
  const bsid = back.sheetOrder[0];
  const got = (Object.values(res(back, "SHEET_DRAWING_PLUGIN")[bsid].data) as any[]).filter((d) => d.componentKey === SLICER_COMPONENT);
  assert.deepEqual(got.map((d) => [d.data.kind, d.data.field, d.data.source.type, d.data.source.name]), [["slicer", "Region", "table", "Sales"], ["timeline", "Date", "pivot", "Pivot 1"]]);
  const tables = Object.values(res(back, "SHEET_TABLE_PLUGIN")).flatMap((s: any) => s.tables);
  assert.equal(got[0].data.source.tableId, (tables[0] as any).id);
  assert.equal(got[0].data.columns, 2);
  assert.equal(got[1].data.level, "quarters");
  assert.equal(got[1].data.source.pivotId, res(back, "SHEET_SYNERGY_PIVOT_PLUGIN").pivots[0].id);
  assert.ok(Math.abs(got[0].transform.left - 300) < 2 && Math.abs(got[1].transform.left - 520) < 2);
});

test("a pivot table over an external connection and the Data Model is kept through a round trip", async () => {
  const wbx = new ExcelJS.Workbook();
  const ws = wbx.addWorksheet("Report");
  ws.getCell("A3").value = "Row Labels";
  ws.getCell("B3").value = "Sum of Amount";
  ws.getCell("A4").value = "West";
  ws.getCell("B4").value = 9;
  const zip = await JSZip.loadAsync((await wbx.xlsx.writeBuffer()) as ArrayBuffer);
  const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const MODEL_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/powerPivotData";
  zip.file("xl/connections.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="${MAIN}"><connection id="1" keepAlive="1" name="ThisWorkbookDataModel" description="Data Model" type="5" refreshedVersion="8" minRefreshableVersion="5" background="1"><dbPr connection="Data Model Connection" command="Model" commandType="1"/></connection><connection id="2" name="Sales DB" type="1" refreshedVersion="8"><dbPr connection="DSN=Sales" command="SELECT * FROM sales"/></connection></connections>`);
  zip.file("xl/pivotCache/pivotCacheDefinition1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="${MAIN}" xmlns:r="${R}" r:id="rId1" refreshedVersion="8" recordCount="1"><cacheSource type="external" connectionId="2"/><cacheFields count="2"><cacheField name="Region" numFmtId="0"><sharedItems count="1"><s v="West"/></sharedItems></cacheField><cacheField name="Amount" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="9" maxValue="9"/></cacheField></cacheFields></pivotCacheDefinition>`);
  zip.file("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`);
  zip.file("xl/pivotCache/pivotCacheRecords1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="${MAIN}" count="1"><r><x v="0"/><n v="9"/></r></pivotCacheRecords>`);
  zip.file("xl/pivotTables/pivotTable1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="${MAIN}" name="SalesPivot" cacheId="7" dataCaption="Values"><location ref="A3:B4" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="2"><item x="0"/><item t="default"/></items></pivotField><pivotField dataField="1" showAll="0"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField name="Sum of Amount" fld="1"/></dataFields></pivotTableDefinition>`);
  zip.file("xl/pivotTables/_rels/pivotTable1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`);
  zip.file("xl/model/item.data", new Uint8Array([1, 2, 3, 4, 5]));
  const sheetRels = (await zip.file("xl/worksheets/_rels/sheet1.xml.rels")?.async("string")) || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", sheetRels.replace("</Relationships>", `<Relationship Id="rId99" Type="${R}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>`));
  const wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  zip.file("xl/_rels/workbook.xml.rels", wbRels.replace("</Relationships>", `<Relationship Id="rId90" Type="${R}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/><Relationship Id="rId91" Type="${R}/connections" Target="connections.xml"/><Relationship Id="rId92" Type="${MODEL_REL}" Target="model/item.data"/></Relationships>`));
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  zip.file("xl/workbook.xml", wbXml.replace("</workbook>", `<pivotCaches><pivotCache cacheId="7" r:id="rId90"/></pivotCaches><extLst><ext uri="{FCE6A71B-6B00-49CD-AB44-F6B1AE7CDE65}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:dataModel><x15:modelTables><x15:modelTable id="sales" name="sales" connection="Sales DB"/></x15:modelTables></x15:dataModel></ext></extLst></workbook>`));
  const types = await zip.file("[Content_Types].xml")!.async("string");
  zip.file("[Content_Types].xml", types.replace("</Types>", `<Default Extension="data" ContentType="application/vnd.openxmlformats-officedocument.model+data"/><Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>`));
  const book = await xlsxToUniver(new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
  assert.equal(res(book, "SHEET_SYNERGY_PIVOT_PLUGIN"), null, "not one of our refreshable pivots");
  assert.equal(book.sheets[book.sheetOrder[0]].cellData?.[3]?.[1]?.v, 9, "its last results stay in the cells");

  const out = await JSZip.loadAsync(await univerToXlsx(book));
  const text = (p: string) => out.file(p)!.async("string");
  const wb = await text("xl/workbook.xml");
  const cacheId = /<pivotCache cacheId="(\d+)" r:id="(rId\d+)"\/>/.exec(wb)!;
  const rels = await text("xl/_rels/workbook.xml.rels");
  const cacheTarget = new RegExp(`Id="${cacheId[2]}" Type="[^"]+/pivotCacheDefinition" Target="([^"]+)"`).exec(rels)![1];
  const cache = await text(`xl/${cacheTarget}`);
  assert.match(cache, /<cacheSource type="external" connectionId="(\d+)"\/>/);
  const connId = /connectionId="(\d+)"/.exec(cache)![1];
  const conns = await text("xl/connections.xml");
  assert.match(conns, new RegExp(`<connection id="${connId}" name="Sales DB" type="1"`));
  assert.match(conns, /name="ThisWorkbookDataModel"/);
  const tablePath = Object.keys(out.files).find((p) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(p))!;
  assert.match(await text(tablePath), new RegExp(`name="SalesPivot" cacheId="${cacheId[1]}"`));
  assert.match(await text("xl/worksheets/_rels/sheet1.xml.rels"), /Type="[^"]+\/pivotTable" Target="..\/pivotTables\/pivotTable\d+.xml"/);
  assert.match(await text(`xl/pivotCache/_rels/${cacheTarget.split("/").pop()}.rels`), /pivotCacheRecords\d+\.xml/);
  assert.deepEqual([...(await out.file("xl/model/item.data")!.async("uint8array"))], [1, 2, 3, 4, 5]);
  assert.match(rels, new RegExp(`Type="${MODEL_REL}" Target="model/item.data"`));
  assert.match(wb, /<x15:dataModel><x15:modelTables><x15:modelTable id="sales"/);
  assert.match(await text("[Content_Types].xml"), /PartName="\/xl\/model\/item.data" ContentType="application\/vnd.openxmlformats-officedocument.model\+data"/);
  // And again: kept a second time, not doubled.
  const again = await JSZip.loadAsync(await univerToXlsx(await xlsxToUniver(new Uint8Array(await out.generateAsync({ type: "uint8array" })))));
  assert.equal(Object.keys(again.files).filter((p) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(p)).length, 1);
  assert.equal(((await again.file("xl/connections.xml")!.async("string")).match(/<connection\b/g) || []).length, 2);
});

test("text beyond Western European goes into the PDF in an embedded font subset, searchable", async (t) => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { inflateSync } = await import("node:zlib");
  const { pagesToPdf, wrapText } = await import("../lib/print-pdf.ts");
  const { fontRuns, cjkOf } = await import("../lib/pdf-fonts.ts");
  assert.deepEqual(fontRuns("Total 销售 Ж"), [{ text: "Total ", font: null }, { text: "销售", font: "NotoSansSC.ttf" }, { text: " ", font: null }, { text: "Ж", font: "NotoSans-Regular.ttf" }]);
  assert.equal(cjkOf("売上の合計"), "JP");
  assert.equal(cjkOf("매출"), "KR");
  assert.deepEqual(wrapText("销售报告销售报告", 40, (s) => [...s].length * 10), ["销售报告", "销售报告"]);
  assert.deepEqual(wrapText("один два три", 70, (s) => s.length * 10), ["один", "два три"]);
  const ttf = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
  if (!existsSync(ttf)) return t.skip("no TrueType font with Cyrillic on this machine");
  const { printSheet } = await import("../lib/sheet-print.ts");
  const book = salesBook();
  book.sheets["sheet-1"].cellData![4] = { 0: { v: "Продажи", t: 1 }, 1: { v: "Ελλάδα", t: 1 } };
  const asked: string[] = [];
  const bytes = await pagesToPdf(printSheet(book, "sheet-1"), "Sales", {
    loadFont: async (file) => {
      asked.push(file);
      return file === "NotoSans-Regular.ttf" ? readFileSync(ttf).toString("base64") : null;
    },
  });
  assert.deepEqual(asked, ["NotoSans-Regular.ttf"]);
  const pdf = Buffer.from(bytes).toString("latin1");
  assert.match(pdf, /\/Subtype \/Type0/);
  assert.match(pdf, /\/Encoding \/Identity-H/);
  // The ToUnicode map lists the letters, so the text can be found.
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => {
    try {
      return inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      return m[1];
    }
  });
  const cmap = streams.find((x) => /begincmap/.test(x)) || "";
  for (const ch of "ПродажиΕλλάδα") assert.match(cmap.toLowerCase(), new RegExp(`<${ch.codePointAt(0)!.toString(16).padStart(4, "0")}>`), ch);
  // The embedded font is a subset, not the whole file.
  assert.ok(bytes.length < readFileSync(ttf).length / 2, `${bytes.length} bytes`);
});

test("shapes and charts print: outlines as pictures, shape text as text, a chart sheet on its own page", async () => {
  const { printSheet, printRenderers, usedRange } = await import("../lib/sheet-print.ts");
  const { pageHtml } = await import("../lib/print-html.ts");
  const shape = { kind: "rect", fill: "#ffcc00", line: "#000000", lineWidth: 1, text: "Note this", fontSize: 12, color: "#111111", align: "ctr", vAlign: "ctr" };
  const book = salesBook();
  const sid = "sheet-1";
  book.resources = [
    { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ [sid]: { data: { s1: { drawingId: "s1", drawingType: 8, componentKey: "SynergyShape", unitId: "book", subUnitId: sid, sheetTransform: { from: { row: 5, column: 4, rowOffset: 0, columnOffset: 0 } }, transform: { left: 0, top: 0, width: 150, height: 60 }, data: shape } }, order: ["s1"] } }) },
    { name: SHEET_CHART_RESOURCE, data: JSON.stringify({ sheets: { [sid]: [{ id: "c1", type: "column", title: "Sales", anchor: { row: 1, column: 3 }, series: [] }], "sheet-c": [{ id: "c2", type: "column", title: "Own sheet", anchor: { row: 0, column: 0 }, series: [] }] }, chartSheets: ["sheet-c"] }) },
  ];
  book.sheets["sheet-c"] = { id: "sheet-c", name: "Chart1", cellData: {} };
  book.sheetOrder.push("sheet-c");
  // The used range reaches the drawings' far corners (the chart is 540 x 300 pixels from D2).
  const used = usedRange(book, book.sheets[sid])!;
  assert.ok(used.endColumn >= 9 && used.endRow >= 15, JSON.stringify(used));
  printRenderers.chartSvg = (chart, _b, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}"><text>${chart.title}</text></svg>`;
  try {
    const [page] = printSheet(book, sid);
    const svgs = page.images.map((i) => decodeURIComponent(i.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, "")));
    assert.equal(svgs.length, 2);
    assert.match(svgs[0], /<path d="M0 0H148.67V58.67H0Z" fill="#ffcc00" stroke="none"\/><path d="M0 0H148.67V58.67H0Z" fill="none" stroke="#000000"/);
    assert.match(svgs[1], /<text>Sales<\/text>/);
    assert.deepEqual(page.overlay?.map((c) => [c.text, c.align, c.wrap]), [["Note this", "center", true]]);
    assert.match(pageHtml(page), /Note this/);
    const chartPages = printSheet(book, "sheet-c");
    assert.equal(chartPages.length, 1);
    assert.ok(chartPages[0].width > chartPages[0].height, "landscape");
    assert.match(decodeURIComponent(chartPages[0].images[0].src), /Own sheet/);
    assert.ok(chartPages[0].images[0].w > 600);
  } finally {
    printRenderers.chartSvg = null;
  }
});

test("a file from the Excel 2007 beta opens", async () => {
  const wbx = new ExcelJS.Workbook();
  const ws = wbx.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Lorem";
  ws.getCell("B1").value = 111;
  ws.getCell("B2").value = { formula: "B1*2", result: 222 };
  const zip = await JSZip.loadAsync((await wbx.xlsx.writeBuffer()) as ArrayBuffer);
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/.*\.xml$/.test(n))) {
    let xml = await zip.file(name)!.async("string");
    xml = xml.split("http://schemas.openxmlformats.org/spreadsheetml/2006/main").join("http://schemas.microsoft.com/office/excel/2006/2");
    if (name.endsWith("sharedStrings.xml")) xml = xml.replace(/<(\/?)si>/g, "<$1sstItem>");
    if (name.endsWith("styles.xml")) xml = xml.replace("</styleSheet>", '<colors><themeColors><rgbColor rgb="FFFFFFFF"/></themeColors></colors></styleSheet>');
    zip.file(name, xml);
  }
  const book = await xlsxToUniver(new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
  const cells = book.sheets[book.sheetOrder[0]].cellData!;
  assert.equal(cells[0][0].v, "Lorem");
  assert.equal(cells[0][1].v, 111);
  assert.equal(cells[1][1].f, "=B1*2");
});

test("3-D references are worked out as one reference per sheet, in tab order", () => {
  const sheets = ["Jan", "Feb", "Mar 2024", "Summary"];
  assert.equal(expand3dRefs("=SUM(Jan:Feb!B2)", sheets), "=SUM(Jan!B2,Feb!B2)");
  assert.equal(expand3dRefs("=AVERAGE('Feb:Mar 2024'!$A$1:B3)+1", sheets), "=AVERAGE(Feb!$A$1:B3,'Mar 2024'!$A$1:B3)+1");
  assert.equal(expand3dRefs("=MAX(Feb:Jan!A:A)", sheets), "=MAX(Jan!A:A,Feb!A:A)");
  assert.equal(expand3dRefs("=SUM(Jan:Nope!A1)", sheets), "=SUM(#REF!)");
  assert.equal(expand3dRefs('=SUM(Jan!A1:B2)&"Jan:Feb!A1"', sheets), '=SUM(Jan!A1:B2)&"Jan:Feb!A1"');
  assert.equal(expand3dRefs("=SUM(A1:B2)", sheets), "=SUM(A1:B2)");
  assert.ok(has3dRef("=SUM(Jan:Feb!B2)"));
  assert.ok(!has3dRef("=SUM(Jan!A1:B2)"));
});

test("Evaluate Formula works a formula out one part at a time, taking only the IF branch it needs", async () => {
  const { FormulaStepper, parseFormula, showValue } = await import("../lib/formula-eval.ts");
  const answers: Record<string, any> = {
    "=A1": { kind: "number", value: 3 },
    "=A1>2": { kind: "bool", value: true },
    "=A1:A3": { kind: "array", value: [[{ kind: "number", value: 3 }], [{ kind: "number", value: 4 }], [{ kind: "number", value: 5 }]] },
    "=SUM(A1:A3)": { kind: "number", value: 12 },
    "=12*2": { kind: "number", value: 24 },
    "=(12*2)": { kind: "number", value: 24 },
    "=IF(TRUE,(24),B9)": { kind: "number", value: 24 },
  };
  const asked: string[] = [];
  const s = new FormulaStepper("=IF(A1>2,(SUM(A1:A3)*2),B9)", async (f) => {
    asked.push(f);
    if (!answers[f]) throw new Error(`unexpected ${f}`);
    return answers[f];
  });
  const shown: string[] = [];
  let st = s.state();
  shown.push(`${st.text} [${st.text.slice(st.next!.start, st.next!.end)}]`);
  while (st.next) {
    st = await s.step();
    shown.push(st.next ? `${st.text} [${st.text.slice(st.next.start, st.next.end)}]` : st.text);
  }
  assert.deepEqual(shown, [
    "=IF(A1>2,(SUM(A1:A3)*2),B9) [A1]",
    "=IF(3>2,(SUM(A1:A3)*2),B9) [3>2]",
    "=IF(TRUE,(SUM(A1:A3)*2),B9) [A1:A3]",
    "=IF(TRUE,(SUM({3;4;5})*2),B9) [SUM({3;4;5})]",
    "=IF(TRUE,(12*2),B9) [12*2]",
    "=IF(TRUE,24,B9) [IF(TRUE,24,B9)]",
    "=24",
  ]);
  assert.ok(!asked.includes("=B9"), "the branch IF doesn't take is not worked out");
  assert.equal(showValue(st.result!), "24");
  // LET is worked out whole; text, errors, percentages and sheet references parse.
  assert.equal(parseFormula('=LET(x,2,x*3)').text, "LET");
  assert.equal(parseFormula("=-'My sheet'!B2%&\"a\"\"b\"").kind, "binary");
  assert.equal(parseFormula("=SUM(Jan:Feb!A1,Table1[Sales],A1#)").children.map((c) => c.kind).join(), "ref,ref,spill");
});

test("sheet and range passwords hash as Excel does, lock everyone until unlocked, and round-trip", async () => {
  const { hashPassword, legacyPasswordHash, verifyPassword } = await import("../lib/excel-password.ts");
  const { protectionViolation, PASSWORD_MESSAGE } = await import("../lib/sheet-protection.ts");
  assert.equal(legacyPasswordHash("secret"), "DAA7");
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
  const h = hashPassword("Synergy", 1000, salt);
  assert.equal(h.hashValue, "YJJVXhBeSdRiLaN3DkHZ55AX3sBElxuaUXa06F4y4oy3hHfW5h/wuMOoW3+2pqdHmqx34LQ81CHlDsPJsuOPaA==", "matches an independent SHA-512 spin");
  assert.ok(verifyPassword("Synergy", h));
  assert.ok(!verifyPassword("synergy", h));
  assert.ok(verifyPassword("secret", { password: "DAA7" }));

  const g = (r: number, c: number) => ({ startRow: r, startColumn: c, endRow: r, endColumn: c });
  const rangePw = hashPassword("open", 10);
  const p = { id: "p", sheetId: "s", range: null, editors: ["*"], except: [g(0, 0), g(5, 5)], exceptPasswords: [rangePw, null], xlsx: hashPassword("lock", 10) };
  const set = (r: number, c: number) => ({ id: "sheet.mutation.set-range-values", params: { unitId: "u", subUnitId: "s", cellValue: { [r]: { [c]: { v: 1 } } } } });
  const owner = { email: "o@x.com", role: "owner" };
  const editor = { email: "e@x.com", role: "editor" };
  const viewer = { email: "v@x.com", role: "viewer" };
  assert.equal(protectionViolation([p], set(2, 2), owner, new Set()), PASSWORD_MESSAGE, "the owner too, until unlocked");
  assert.equal(protectionViolation([p], set(5, 5), editor, new Set()), null, "a range without a password stays open");
  assert.equal(protectionViolation([p], set(0, 0), editor, new Set()), PASSWORD_MESSAGE, "the passworded range is shut");
  assert.equal(protectionViolation([p], set(0, 0), editor, new Set(["p#0"])), null, "until its password is given");
  assert.equal(protectionViolation([p], set(2, 2), editor, new Set(["p"])), null, "the sheet password opens it all");
  assert.ok(protectionViolation([p], set(2, 2), viewer, new Set(["p"])), "viewers still can't");

  // Round trip: the sheet hash, and each range's own.
  const book = salesBook();
  const { PROTECTION_RESOURCE } = await import("../lib/protection-rules.mjs");
  book.resources = [{ name: PROTECTION_RESOURCE, data: JSON.stringify({ protections: [{ ...p, sheetId: "sheet-1" }] }) }];
  const bytes = await univerToXlsx(book);
  const xml = (await zipText(bytes, "xl/worksheets/sheet1.xml"))!;
  assert.match(xml, /<sheetProtection[^>]*algorithmName="SHA-512"[^>]*hashValue="/);
  assert.match(xml, new RegExp(`<protectedRange[^>]*hashValue="${rangePw.hashValue.replace(/[+/]/g, "\\$&")}"[^>]*sqref="A1"`));
  const back = res(await xlsxToUniver(bytes), PROTECTION_RESOURCE).protections[0];
  assert.deepEqual(back.editors, ["*"]);
  assert.ok(verifyPassword("lock", back.xlsx));
  assert.ok(verifyPassword("open", back.exceptPasswords[0]));
  assert.equal(back.exceptPasswords[1], null);
});

test("Get data's applied steps shape the table as Power Query's editor does, and come back with the query", async () => {
  const { applyTransforms, checkExpression } = await import("../lib/query-transforms.ts");
  const { gridFor } = await import("../lib/data-import.ts");
  const csv = "Region,Rep,Q1,Q2\nNorth,ann smith,10,20\nSouth,bo lee,5,\nNorth,cy,7,3\n,dee,1,1\nNorth,ann smith,10,20\n";
  const grid = gridFor(csv, "csv", {
    headers: true,
    transforms: [
      { kind: "fill down", column: "Region" },
      { kind: "distinct" },
      { kind: "text", column: "Rep", op: "proper" },
      { kind: "custom", as: "Total", expression: "[Q1] + IF([Q2] = NULL, 0, [Q2])" },
      { kind: "filter", column: "Total", op: ">=", value: "5" },
      { kind: "sort", column: "Total", descending: true },
      { kind: "rename", column: "Rep", to: "Person" },
    ],
  });
  assert.deepEqual(grid, [
    ["Region", "Person", "Q1", "Q2", "Total"],
    ["North", "Ann Smith", 10, 20, 30],
    ["North", "Cy", 7, 3, 10],
    ["South", "Bo Lee", 5, null, 5],
  ]);
  // Group, unpivot, split, merge, type, replace, top.
  const t = [["Region", "Q1", "Q2"], ["North", 1, 2], ["South", 3, 4], ["North", 5, 6]];
  assert.deepEqual(applyTransforms(t, true, [{ kind: "group", by: ["Region"], column: "Q1", aggregate: "sum", as: "Q1 total" }]), [["Region", "Q1 total"], ["North", 6], ["South", 3]]);
  assert.deepEqual(applyTransforms(t, true, [{ kind: "unpivot", keep: ["Region"] }, { kind: "top", count: 2 }]), [["Region", "Attribute", "Value"], ["North", "Q1", 1], ["North", "Q2", 2]]);
  assert.deepEqual(applyTransforms([["a-1"], ["b-2"]], false, [{ kind: "split", column: "Column1", delimiter: "-" }, { kind: "merge", columns: ["Column1.2", "Column1.1"], separator: "/", as: "M" }]), [["1/a"], ["2/b"]]);
  assert.deepEqual(applyTransforms([["d"], ["2024-03-05"], [45500]], true, [{ kind: "type", column: "d", to: "date" }, { kind: "replace", column: "d", find: "2024", with: "1999" }]), [["d"], ["1999-03-05"], ["1999-07-27"]]);
  assert.throws(() => applyTransforms(t, true, [{ kind: "remove", column: "Nope" }]), /Step 1 \(Remove Nope\): There is no column "Nope"/);
  assert.equal(checkExpression("[Q1] * 2", ["Q1"]), null);
  assert.match(checkExpression("constructor.call()", ["Q1"])!, /isn't a function/);

  // The steps travel with the query in .xlsx.
  const { QUERY_RESOURCE } = await import("../lib/data-import.ts");
  const q = { id: "q1", name: "Sales", sheetId: "sheet-1", anchor: { row: 0, column: 5 }, source: { kind: "web", url: "https://example.com/s.csv", format: "csv" }, steps: { headers: true, transforms: [{ kind: "top", count: 3 }] } };
  const book = salesBook();
  book.resources = [{ name: QUERY_RESOURCE, data: JSON.stringify({ queries: [q] }) }];
  const back = res(await xlsxToUniver(await univerToXlsx(book)), QUERY_RESOURCE);
  assert.deepEqual(back.queries[0].steps.transforms, [{ kind: "top", count: 3 }]);
});

test("custom views are Excel's customWorkbookView and customSheetView, and Excel's come in", async () => {
  const { CUSTOM_VIEWS_RESOURCE, captureView, readCustomViews } = await import("../lib/custom-views.ts");
  const book = salesBook();
  const sheet = book.sheets["sheet-1"] as any;
  sheet.rowData = { 2: { hd: 1 }, 3: { hd: 1 } };
  sheet.freeze = { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 };
  sheet.zoomRatio = 1.5;
  const view = captureView("Summary", book.sheets as any, "sheet-1", { "sheet-1": { startRow: 4, endRow: 5, startColumn: 1, endColumn: 2 } }, "{11111111-2222-3333-4444-555555555555}");
  assert.deepEqual(view.sheets["sheet-1"], { hiddenRows: [2, 3], hiddenColumns: [], frozenRows: 1, frozenColumns: 1, zoom: 1.5, gridlines: true, selection: { startRow: 4, endRow: 5, startColumn: 1, endColumn: 2 } });
  book.resources = [{ name: CUSTOM_VIEWS_RESOURCE, data: JSON.stringify({ views: [view] }) }];
  const bytes = await univerToXlsx(book);
  const wbXml = (await zipText(bytes, "xl/workbook.xml"))!;
  const sheetXml = (await zipText(bytes, "xl/worksheets/sheet1.xml"))!;
  assert.match(wbXml, /<customWorkbookViews><customWorkbookView name="Summary" guid="\{11111111-2222-3333-4444-555555555555\}"[^>]*activeSheetId="1"/);
  assert.ok(wbXml.indexOf("<customWorkbookViews>") > wbXml.indexOf("</sheets>"), "after the sheets, as the schema orders it");
  assert.match(sheetXml, /<customSheetViews><customSheetView guid="\{11111111-2222-3333-4444-555555555555\}" scale="150" hiddenRows="1"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/><selection pane="bottomRight" activeCell="B5" sqref="B5:C6"\/>/);
  assert.ok(sheetXml.indexOf("<customSheetViews>") < sheetXml.indexOf("<pageMargins"), "before the page margins");
  const back = res(await xlsxToUniver(bytes), CUSTOM_VIEWS_RESOURCE).views;
  const id = (await xlsxToUniver(bytes)).sheetOrder[0];
  assert.equal(back[0].name, "Summary");
  assert.deepEqual(back[0].sheets[id].hiddenRows, [2, 3], "hidden rows from our extension");

  // A view made in Excel: no extension, so its panes, zoom, gridlines and selection.
  const excel = readCustomViews(
    '<workbook><sheets><sheet name="A" sheetId="7" r:id="rId1"/></sheets><customWorkbookViews><customWorkbookView name="Print" guid="{G}" windowWidth="1" windowHeight="1" activeSheetId="7"/></customWorkbookViews></workbook>',
    ['<worksheet><customSheetViews><customSheetView guid="{G}" scale="80" showGridLines="0" state="hidden"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="C4" sqref="C4"/></customSheetView></customSheetViews></worksheet>'],
    ["s1"],
  );
  assert.deepEqual(excel, [{ id: "{G}", name: "Print", activeSheetId: "s1", sheets: { s1: { hiddenRows: [], hiddenColumns: [], frozenRows: 2, frozenColumns: 0, zoom: 0.8, gridlines: false, hidden: true, selection: { startRow: 3, startColumn: 2, endRow: 3, endColumn: 2 } } } }]);
});

test("a sensitivity label is written as Office records it, other custom properties kept, and read back", async () => {
  const { DOC_PROPS_RESOURCE, labelOf, readCustomProps } = await import("../lib/sensitivity.ts");
  const book = salesBook();
  const label = { id: "c0d8b3e4-2f5a-4b7c-9d8e-3f4a5b6c7d82", name: "Confidential", method: "Privileged" as const, setDate: "2026-10-16T10:00:00Z" };
  book.resources = [{ name: DOC_PROPS_RESOURCE, data: JSON.stringify({ custom: [{ name: "Project", type: "lpwstr", value: "Apollo & Co" }], label }) }];
  const bytes = await univerToXlsx(book);
  const custom = (await zipText(bytes, "docProps/custom.xml"))!;
  const props = readCustomProps(custom);
  assert.deepEqual(props.map((p) => p.name), ["Project", ...["Enabled", "SetDate", "Method", "Name", "SiteId", "ActionId", "ContentBits"].map((k) => `MSIP_Label_${label.id}_${k}`)]);
  assert.equal(props[0].value, "Apollo & Co");
  assert.match((await zipText(bytes, "docMetadata/LabelInfo.xml"))!, /<clbl:label id="\{c0d8b3e4-[^"]+\}" enabled="1" method="Privileged"/);
  assert.match((await zipText(bytes, "_rels/.rels"))!, /custom-properties" Target="docProps\/custom.xml"/);
  assert.match((await zipText(bytes, "[Content_Types].xml"))!, /PartName="\/docMetadata\/LabelInfo.xml" ContentType="application\/vnd.ms-office.classificationlabels\+xml"/);
  const back = res(await xlsxToUniver(bytes), DOC_PROPS_RESOURCE);
  assert.deepEqual(back.custom, [{ name: "Project", type: "lpwstr", value: "Apollo & Co" }]);
  assert.deepEqual([back.label.id, back.label.name, back.label.method], [label.id, "Confidential", "Privileged"]);
  // A label from an older Office: only the MSIP properties.
  const old = labelOf([{ name: "MSIP_Label_11111111-2222-3333-4444-555555555555_Enabled", type: "lpwstr", value: "True" }, { name: "MSIP_Label_11111111-2222-3333-4444-555555555555_Name", type: "lpwstr", value: "Internal" }]);
  assert.equal(old?.name, "Internal");
  // Removing the label removes its parts.
  book.resources = [{ name: DOC_PROPS_RESOURCE, data: JSON.stringify({ custom: [], label: null }) }];
  const none = await univerToXlsx(book);
  assert.equal(await zipText(none, "docMetadata/LabelInfo.xml"), undefined);
});

test("the accessibility checker finds what Excel's does, and picture alt text goes through .xlsx", async () => {
  const { checkAccessibility, contrastRatio } = await import("../lib/sheet-a11y.ts");
  const { SHAPE_COMPONENT, DRAWING_DOM, newShape } = await import("../lib/sheet-shapes.ts");
  assert.equal(Math.round(contrastRatio("#777777", "#ffffff")! * 100) / 100, 4.48);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const from = { column: 3, columnOffset: 0, row: 2, rowOffset: 0 };
  const to = { column: 5, columnOffset: 0, row: 6, rowOffset: 0 };
  const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
  const pic = (id: string, extra: object) => ({ drawingId: id, drawingType: 0, imageSourceType: "BASE64", source: `data:image/png;base64,${png}`, unitId: "", subUnitId: "sheet-1", sheetTransform: { from, to, ...flips }, axisAlignSheetTransform: { from, to, ...flips }, transform: { left: 0, top: 0, width: 0, height: 0, ...flips }, ...extra });
  const book = salesBook();
  const s = book.sheets["sheet-1"] as any;
  s.name = "Sheet1";
  s.mergeData = [{ startRow: 10, endRow: 10, startColumn: 0, endColumn: 2 }];
  s.cellData[1][1] = { v: 5, s: { cl: { rgb: "#bbbbbb" } } };
  book.resources = [
    { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ "sheet-1": { data: { p1: pic("p1", {}), sh: { drawingId: "sh", drawingType: DRAWING_DOM, componentKey: SHAPE_COMPONENT, data: { ...newShape("rect"), name: "Box" }, subUnitId: "sheet-1" } }, order: ["p1", "sh"] } }) },
    { name: SHEET_CHART_RESOURCE, data: JSON.stringify({ sheets: { "sheet-1": [{ id: "c1", type: "bar", title: "Sales", anchor: { row: 0, column: 8 }, series: [] }] } }) },
    { name: "SHEET_TABLE_PLUGIN", data: JSON.stringify({ "sheet-1": { tables: [{ name: "T1", options: { showHeader: false }, columns: [{ displayName: "" }] }] } }) },
  ];
  const issues = checkAccessibility(book as any);
  assert.deepEqual(issues.map((i) => [i.severity, i.rule, i.target?.kind ?? i.ref ?? ""]), [
    ["error", "Missing alternative text", "image"],
    ["error", "Missing alternative text", "shape"],
    ["error", "Missing alternative text", "chart"],
    ["warning", "Merged cells", "A11:C11"],
    ["warning", "Hard-to-read text contrast", "B2"],
    ["warning", "No header row", ""],
    ["tip", "Default sheet name", ""],
    ["tip", "Blank table headers", ""],
  ]);

  // Alt text on a picture, a decorative one, a shape and a chart, through .xlsx.
  const drawings = { "sheet-1": { data: { p1: pic("p1", { description: "Sales by region, North leads" }), p2: { ...pic("p2", { decorative: true }), sheetTransform: { from: { ...from, row: 9 }, to: { ...to, row: 12 }, ...flips } }, sh: { drawingId: "sh", drawingType: DRAWING_DOM, componentKey: SHAPE_COMPONENT, data: { ...newShape("rect"), name: "Box", alt: "A note box" }, subUnitId: "sheet-1", sheetTransform: { from, to, ...flips }, transform: { left: 300, top: 40, width: 100, height: 50, ...flips } } }, order: ["p1", "p2", "sh"] } };
  book.resources[0] = { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify(drawings) };
  book.resources[1] = { name: SHEET_CHART_RESOURCE, data: JSON.stringify({ sheets: { "sheet-1": [{ ...chartFromSelection("sheet-1", { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }, "column", "c1"), title: "Sales", alt: "Bar chart of sales" }] } }) };
  const bytes = await univerToXlsx(book);
  const drawingXml = (await zipText(bytes, "xl/drawings/drawing1.xml"))!;
  assert.match(drawingXml, /descr="Sales by region, North leads"/);
  assert.match(drawingXml, /<adec:decorative [^>]*val="1"\/>/);
  assert.match(drawingXml, /descr="A note box"/);
  assert.match(drawingXml, /descr="Bar chart of sales"/);
  const back = await xlsxToUniver(bytes);
  const id = back.sheetOrder[0];
  const pics = Object.values(res(back, "SHEET_DRAWING_PLUGIN")[id].data as Record<string, any>);
  assert.deepEqual(pics.filter((d) => d.drawingType === 0).map((d) => [d.description, !!d.decorative]).sort(), [["Sales by region, North leads", false], [undefined, true]].sort());
  assert.equal(pics.find((d) => d.data?.name === "Box")?.data.alt, "A note box");
  assert.equal(res(back, SHEET_CHART_RESOURCE).sheets[id][0].alt, "Bar chart of sales");
});

test("Quick Analysis totals are Excel's formulas, below or to the right, past a header row", async () => {
  const { hasHeader, totalCells } = await import("../lib/quick-analysis.ts");
  const g = { startRow: 0, endRow: 3, startColumn: 1, endColumn: 2 };
  assert.ok(hasHeader([["North", "South"], [1, 2]]));
  assert.ok(!hasHeader([[1, 2], [3, 4]]));
  const f = (k: Parameters<typeof totalCells>[1], d: "rows" | "columns") => totalCells(g, k, d, true).map((c) => c.formula ?? c.value);
  assert.deepEqual(f("sum", "rows"), ["Sum", "=SUM(B2:B4)", "=SUM(C2:C4)"]);
  assert.deepEqual(f("percent", "rows"), ["% Total", "=SUM(B2:B4)/SUM(B2:C4)", "=SUM(C2:C4)/SUM(B2:C4)"]);
  assert.deepEqual(f("running", "rows"), ["Running Total", "=SUM(B2:B4)", "=SUM(B2:C4)"]);
  assert.deepEqual(f("average", "columns"), ["Average", "=AVERAGE(B2:C2)", "=AVERAGE(B3:C3)", "=AVERAGE(B4:C4)"]);
  assert.deepEqual(f("percent", "columns").slice(1, 2), ["=SUM(B2:C2)/SUM($B$2:$C$4)"]);
  assert.deepEqual(f("running", "columns").slice(1), ["=SUM(B$2:C2)", "=SUM(B$2:C3)", "=SUM(B$2:C4)"]);
});

test("form controls are Excel's VML controls, beside the notes, and Excel 2010's ctrlProp parts are read", async () => {
  const { FORM_CONTROL_COMPONENT, newFormControl, readVmlControls, splitRef, stepValue, withCtrlProp } = await import("../lib/form-controls.ts");
  const { DRAWING_DOM } = await import("../lib/sheet-shapes.ts");
  assert.deepEqual(splitRef("'My ''s'!$A$1:$A$5"), { sheet: "My 's", a1: "A1:A5" });
  assert.deepEqual(splitRef("$B$2"), { a1: "B2" });
  assert.equal(stepValue({ ...newFormControl("spin"), value: 99, max: 100 }, 5), 100);
  const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
  const ctl = (id: string, row: number, data: object) => ({ drawingId: id, drawingType: DRAWING_DOM, componentKey: FORM_CONTROL_COMPONENT, unitId: "", subUnitId: "sheet-1", sheetTransform: { from: { column: 4, columnOffset: 2, row, rowOffset: 3 }, to: { column: 6, columnOffset: 0, row: row + 1, rowOffset: 0 }, ...flips }, transform: { left: 0, top: 0, width: 100, height: 20, ...flips }, data, allowTransform: true });
  const book = salesBook();
  book.resources = [
    { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ "sheet-1": { data: {
      a: ctl("a", 1, { ...newFormControl("checkbox"), text: "Include tax", link: "$H$2", checked: true }),
      b: ctl("b", 3, { ...newFormControl("spin"), link: "$H$3", value: 4, min: 1, max: 10, step: 1 }),
      c: ctl("c", 5, { ...newFormControl("combo"), link: "$H$4", input: "$A$2:$A$3", value: 2 }),
      d: ctl("d", 7, { ...newFormControl("button"), text: "Run report", macro: "[0]!Report" }),
    }, order: ["a", "b", "c", "d"] } }) },
    { name: "SHEET_NOTE_PLUGIN", data: JSON.stringify({ "sheet-1": { 1: { 1: { id: "n1", row: 1, col: 1, note: "Checked by Ann", width: 160, height: 72, show: false } } } }) },
  ];
  const bytes = await univerToXlsx(book);
  const zip = await JSZip.loadAsync(bytes);
  const vmlPath = Object.keys(zip.files).find((p) => /vmlDrawing\d+\.vml$/.test(p))!;
  const vml = await zip.file(vmlPath)!.async("string");
  assert.match(vml, /ObjectType="Checkbox"><x:Anchor>4, 2, 1, 3, 6, 0, 2, 0<\/x:Anchor>[\s\S]*?<x:FmlaLink>\$H\$2<\/x:FmlaLink><x:Checked>1<\/x:Checked>/);
  assert.match(vml, /ObjectType="Spin">[\s\S]*?<x:Val>4<\/x:Val><x:Min>1<\/x:Min><x:Max>10<\/x:Max>/);
  assert.match(vml, /ObjectType="Drop">[\s\S]*?<x:FmlaRange>\$A\$2:\$A\$3<\/x:FmlaRange><x:Sel>2<\/x:Sel>/);
  assert.match(vml, /<x:FmlaMacro>\[0\]!Report<\/x:FmlaMacro>/);
  assert.equal((vml.match(/ObjectType="Note"/g) || []).length, 1, "the note's shape is still there");
  assert.equal(new Set([...vml.matchAll(/id="(_x0000_s\d+)"/g)].map((m) => m[1])).size, 5, "every shape has its own id");
  const back = await xlsxToUniver(bytes);
  const id = back.sheetOrder[0];
  const controls = Object.values(res(back, "SHEET_DRAWING_PLUGIN")[id].data as Record<string, any>).filter((d) => d.componentKey === FORM_CONTROL_COMPONENT).map((d) => d.data);
  assert.deepEqual(controls.map((c) => [c.kind, c.text, c.link ?? null, c.checked ?? c.value ?? null]), [["checkbox", "Include tax", "$H$2", true], ["spin", "", "$H$3", 4], ["combo", "", "$H$4", 2], ["button", "Run report", null, null]]);
  assert.equal(Object.keys(res(back, "SHEET_NOTE_PLUGIN")?.[id] || {}).length, 1, "the note comes back as a note, not a control");
  // Excel 2010's ctrlProp wins over the VML.
  const [first] = readVmlControls('<xml><v:shape id="_x0000_s1025"><x:ClientData ObjectType="Checkbox"><x:Anchor>1, 0, 1, 0, 2, 0, 2, 0</x:Anchor></x:ClientData></v:shape></xml>');
  assert.equal(first.shapeId, 1025);
  assert.deepEqual(withCtrlProp(first.data, '<formControlPr xmlns="x" objectType="CheckBox" fmlaLink="$C$1" checked="Checked" lockText="1"/>'), { kind: "checkbox", text: "", checked: true, link: "$C$1" });
});

test("Protect Workbook locks the sheets' structure and is Excel's workbookProtection in .xlsx", async () => {
  const { structureViolation, readWorkbookProtection } = await import("../lib/sheet-doc-props.ts");
  const { DOC_PROPS_RESOURCE } = await import("../lib/sensitivity.ts");
  const { hashPassword, verifyPassword } = await import("../lib/excel-password.ts");
  const lock = { lockStructure: true, password: hashPassword("book", 10) };
  assert.match(structureViolation(lock, { id: "sheet.mutation.remove-sheet" })!, /structure is protected/);
  assert.equal(structureViolation(lock, { id: "sheet.mutation.set-range-values" }), null);
  assert.equal(structureViolation(null, { id: "sheet.mutation.insert-sheet" }), null);
  const book = salesBook();
  book.resources = [{ name: DOC_PROPS_RESOURCE, data: JSON.stringify({ custom: [], workbook: lock }) }];
  const bytes = await univerToXlsx(book);
  const wbXml = (await zipText(bytes, "xl/workbook.xml"))!;
  assert.match(wbXml, /<workbookProtection workbookAlgorithmName="SHA-512" workbookHashValue="[^"]+" workbookSaltValue="[^"]+" workbookSpinCount="10" lockStructure="1"\/><(?:bookViews|sheets)/);
  const back = res(await xlsxToUniver(bytes), DOC_PROPS_RESOURCE).workbook;
  assert.equal(back.lockStructure, true);
  assert.ok(verifyPassword("book", back.password));
  assert.deepEqual(readWorkbookProtection('<workbook><workbookProtection workbookPassword="DAA7" lockStructure="1"/></workbook>'), { lockStructure: true, password: { password: "DAA7" } });
  assert.equal(readWorkbookProtection('<workbook><workbookProtection lockWindows="1"/></workbook>'), null);
});

test("a note's formatting (a bold author line, coloured runs) goes through a round trip while its text is unchanged", async () => {
  const wbx = new ExcelJS.Workbook();
  const ws = wbx.addWorksheet("Sheet1");
  ws.getCell("A1").value = 1;
  ws.getCell("A1").note = { texts: [{ font: { bold: true, size: 9, name: "Tahoma" }, text: "Ana:" }, { font: { size: 9, color: { argb: "FFFF0000" }, name: "Tahoma" }, text: " check this" }] } as any;
  const book = await xlsxToUniver(new Uint8Array((await wbx.xlsx.writeBuffer()) as ArrayBuffer));
  const notes = res(book, "SHEET_NOTE_PLUGIN");
  const n = notes[book.sheetOrder[0]][0][0];
  assert.equal(n.note, "Ana: check this");
  const xml = await zipText(await univerToXlsx(book), "xl/comments1.xml");
  assert.match(xml!, /<r><rPr><b\/>[\s\S]*?<t[^>]*>Ana:<\/t><\/r>/);
  assert.match(xml!, /<color rgb="FFFF0000"\/>[\s\S]*?check this/);
  // Edited in the app (plain text now), it's written as the new text.
  n.note = "Changed";
  book.resources = book.resources!.map((r) => (r.name === "SHEET_NOTE_PLUGIN" ? { ...r, data: JSON.stringify(notes) } : r));
  const xml2 = await zipText(await univerToXlsx(book), "xl/comments1.xml");
  assert.match(xml2!, /Changed/);
  assert.doesNotMatch(xml2!, /check this/);
});
