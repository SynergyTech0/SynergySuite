// Fixes from the round-trip run over real-world files (see README, "Fidelity
// with real .xlsx files"), each checked on a small file built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { univerToXlsx, xlsxToUniver, type UniverWorkbook } from "../lib/xlsx.ts";
import { PIVOT_RESOURCE, type PivotDef } from "../lib/pivot.ts";

const res = (b: UniverWorkbook, n: string) => JSON.parse(b.resources?.find((r) => r.name === n)?.data || "null");
async function patch(bytes: Uint8Array, edits: Record<string, (xml: string) => string>): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  for (const [part, edit] of Object.entries(edits)) zip.file(part, edit(await zip.file(part)!.async("string")));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
async function tableBook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addTable({ name: "People", ref: "A1", headerRow: true, columns: [{ name: "Name" }, { name: "Age" }], rows: [["Ann", 30], ["Bo", 41], ["Cy", 25]] } as any);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

test("a table whose header row is implied (no headerRowCount, as Excel writes it) is kept", async () => {
  const bytes = await patch(await tableBook(), { "xl/tables/table1.xml": (x) => x.replace(/\s*headerRowCount="1"/, "") });
  const book = await xlsxToUniver(bytes);
  const tables = Object.values(res(book, "SHEET_TABLE_PLUGIN") || {}).flatMap((s: any) => s.tables);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, "People");
  const zip = await JSZip.loadAsync(await univerToXlsx(book));
  assert.match(await zip.file("xl/tables/table1.xml")!.async("string"), /name="People"/);
});

test("filters ExcelJS can't read (by icon, colour, top 10, dynamic) don't stop the file opening", async () => {
  const bytes = await patch(await tableBook(), {
    "xl/worksheets/sheet1.xml": (x) => x.replace(/<\/sheetData>/, '</sheetData><autoFilter ref="D1:E4"><filterColumn colId="0"><iconFilter iconSet="3TrafficLights1" iconId="1"/></filterColumn><filterColumn colId="1"><top10 val="2"/></filterColumn></autoFilter>'),
  });
  const book = await xlsxToUniver(bytes);
  assert.equal(book.sheets[book.sheetOrder[0]].cellData[1][0].v, "Ann");
});

test("charts without categories, area and scatter charts, and 3-D kinds come in; area and scatter go back out", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRows([[1, 10], [2, 12], [3, 9]]);
  ws.addImage(wb.addImage({ base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", extension: "png" }), "D2:E3");
  const base = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const chart = (plot: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout/>${plot}</c:plotArea></c:chart></c:chartSpace>`;
  const zip = await JSZip.loadAsync(base);
  const anchors = [0, 1, 2].map((i) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${4 + i * 6}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="100" cy="100"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${10 + i}" name="C${i}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdC${i}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`);
  const drawing = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  zip.file("xl/drawings/drawing1.xml", drawing.replace(/<\/xdr:wsDr>/, `${anchors.join("")}</xdr:wsDr>`));
  const rels = await zip.file("xl/drawings/_rels/drawing1.xml.rels")!.async("string");
  zip.file("xl/drawings/_rels/drawing1.xml.rels", rels.replace("</Relationships>", [0, 1, 2].map((i) => `<Relationship Id="rIdC${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("") + "</Relationships>"));
  zip.file("xl/charts/chart1.xml", chart(`<c:line3DChart><c:grouping val="standard"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Plain</c:v></c:tx><c:val><c:numRef><c:f>Sheet1!$B$1:$B$3</c:f></c:numRef></c:val></c:ser></c:line3DChart>`));
  zip.file("xl/charts/chart2.xml", chart(`<c:areaChart><c:grouping val="standard"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:numRef><c:f>Sheet1!$A$1:$A$3</c:f></c:numRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$1:$B$3</c:f></c:numRef></c:val></c:ser></c:areaChart>`));
  zip.file("xl/charts/chart3.xml", chart(`<c:scatterChart><c:scatterStyle val="lineMarker"/><c:ser><c:idx val="0"/><c:order val="0"/><c:xVal><c:numRef><c:f>Sheet1!$A$1:$A$3</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>Sheet1!$B$1:$B$3</c:f></c:numRef></c:yVal></c:ser></c:scatterChart>`));
  const book = await xlsxToUniver(new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
  const charts = res(book, "SHEET_SYNERGY_CHARTS_PLUGIN").sheets[book.sheetOrder[0]];
  assert.deepEqual(charts.map((c: any) => [c.type, !!c.series[0].categories]), [["line", false], ["area", true], ["scatter", true]]);
  const out = await JSZip.loadAsync(await univerToXlsx(book));
  const parts = await Promise.all(Object.keys(out.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)).sort().map((n) => out.file(n)!.async("string")));
  assert.match(parts[0], /<c:lineChart>.*<c:ser>(?:(?!<c:cat>).)*<c:val>/);
  assert.match(parts[1], /<c:areaChart>.*<c:cat><c:strRef><c:f>(?:&apos;)?Sheet1(?:&apos;)?!\$A\$1:\$A\$3<\/c:f>/);
  assert.match(parts[2], /<c:scatterChart><c:scatterStyle val="lineMarker"\/>.*<c:xVal><c:numRef><c:f>(?:&apos;)?Sheet1(?:&apos;)?!\$A\$1:\$A\$3<\/c:f>.*<c:yVal>/);
  assert.match(parts[2], /<c:valAx><c:axId val="10"\/>.*<c:valAx><c:axId val="20"\/>/);
});

test("a pivot table over an Excel table (source given by name) comes in", async () => {
  const cellData: Record<number, Record<number, { v: string | number }>> = {};
  [["Region", "Amount"], ["East", 5], ["West", 7], ["East", 1]].forEach((r, i) => r.forEach((v, j) => ((cellData[i] ||= {})[j] = { v })));
  const def: PivotDef = { id: "p", name: "Pivot 1", source: { sheetId: "s1", range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 } }, target: { sheetId: "s2", row: 0, column: 0 }, rows: ["Region"], columns: [], values: [{ field: "Amount", agg: "sum" }], filters: [], lastSize: { rows: 4, columns: 2 } };
  const book: UniverWorkbook = { id: "u", name: "P", appVersion: "", locale: "enUS", styles: {}, sheetOrder: ["s1", "s2"], sheets: { s1: { id: "s1", name: "Data", cellData } as any, s2: { id: "s2", name: "Pivot", cellData: {} } as any }, resources: [{ name: PIVOT_RESOURCE, data: JSON.stringify({ pivots: [def] }) }] };
  const bytes = await patch(await univerToXlsx(book), {
    "xl/pivotCache/pivotCacheDefinition1.xml": (x) => x.replace(/<worksheetSource [^>]*\/>/, '<worksheetSource name="Sales"/>'),
    "xl/workbook.xml": (x) => (/<definedNames>/.test(x) ? x.replace("<definedNames>", "<definedNames><definedName name=\"Sales\">Data!$A$1:$B$4</definedName>") : x.replace("</sheets>", '</sheets><definedNames><definedName name="Sales">Data!$A$1:$B$4</definedName></definedNames>')),
  });
  const back = await xlsxToUniver(bytes);
  const pivots = res(back, PIVOT_RESOURCE).pivots;
  assert.equal(pivots.length, 1);
  assert.equal(pivots[0].source.sheetId, back.sheetOrder[0]);
  assert.deepEqual(pivots[0].source.range, { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 });
});
