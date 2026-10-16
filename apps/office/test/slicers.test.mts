// Slicers, timelines and pivot charts: picking values and periods, what a
// pick filters, pivot chart series, and slicers in .xlsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asDate, periodOf, pickPeriod, pivotExclude, slicerItems, tableFilter, timelinePeriods, timelineRange, toggleItem, toSerial, TABLE_EMPTY, type SlicerData } from "../lib/slicers.ts";
import { pivotChartSeries } from "../lib/sheet-charts.ts";
import { computePivot } from "../lib/pivot.ts";

const slicer = (selected: string[] | null): SlicerData => ({ kind: "slicer", caption: "Region", source: { type: "table", tableId: "t", name: "Sales" }, field: "Region", selected });

test("slicer buttons: one click picks one, Ctrl-click adds and removes, all again clears", () => {
  const items = slicerItems(["West", "East", null, "East", 10, 9], null);
  assert.deepEqual(items.map((i) => i.key), ["9", "10", "East", "West", "(blank)"]);
  assert.ok(items.every((i) => i.selected));
  assert.deepEqual(toggleItem(items, "East", false), ["East"]);
  const east = slicerItems(["West", "East"], ["East"]);
  assert.equal(toggleItem(east, "East", false), null, "clicking the only pick shows all again");
  assert.equal(toggleItem(east, "West", true), null, "adding the last one is all");
  assert.deepEqual(toggleItem(slicerItems(["a", "b", "c"], null), "b", true), ["a", "c"]);
  assert.deepEqual(toggleItem(slicerItems(["a", "b"], ["a"]), "a", true), ["a"], "something stays picked");
});

test("what a slicer pick filters, in a table and in a pivot table", () => {
  const values = ["West", 3, null, "East", 3];
  assert.equal(tableFilter(slicer(null), values), undefined);
  assert.deepEqual(tableFilter(slicer(["3", "(blank)"]), values), { filterType: "manual", values: [3, TABLE_EMPTY] });
  assert.deepEqual(pivotExclude(slicer(["West"]), values), ["3", "East", "(blank)"]);
});

test("timelines: dates, periods and the picked range", () => {
  const d = asDate(45366)!; // 2024-03-15
  assert.equal(d.toISOString().slice(0, 10), "2024-03-15");
  assert.equal(toSerial(d), 45366);
  assert.equal(asDate("2024-02-29T10:00")!.toISOString().slice(0, 10), "2024-02-29");
  assert.equal(asDate("hello"), null);
  assert.deepEqual([periodOf(d, "quarters").key, periodOf(d, "months").label, periodOf(d, "days").group], ["2024-Q1", "Mar", "Mar 2024"]);
  const values = [45300, 45366, "2024-06-02", "x"];
  assert.deepEqual(timelinePeriods(values, "months").map((p) => p.key), ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06"]);
  assert.deepEqual(timelinePeriods(values, "years").map((p) => p.key), ["2024"]);
  const t: SlicerData = { kind: "timeline", caption: "Date", source: { type: "pivot", pivotId: "p", name: "P" }, field: "Date", level: "months", period: pickPeriod(pickPeriod(null, "2024-05", false), "2024-03", true) };
  const r = timelineRange(t)!;
  assert.deepEqual([r.start.toISOString(), r.end.toISOString()], ["2024-03-01T00:00:00.000Z", "2024-05-31T23:59:59.999Z"]);
  assert.deepEqual(tableFilter(t, values), { filterType: "condition", filterInfo: { conditionType: "date", compareType: "between", expectedValue: ["2024-03-01T00:00:00.000Z", "2024-05-31T23:59:59.999Z"] } });
  assert.deepEqual(pivotExclude(t, values).sort(), ["2024-06-02", "45300", "x"]);
});

test("a pivot chart charts the pivot's rows, without the grand totals", () => {
  const table = [["Region", "Year", "Sales"], ["West", 2023, 5], ["East", 2023, 3], ["West", 2024, 7]];
  const def = { rows: ["Region"], columns: ["Year"], values: [{ field: "Sales", agg: "sum" as const }], filters: [] };
  const grid = computePivot(table, def);
  // Title, Year labels, then East, West, Grand Total; columns: Region, 2023, 2024, Grand Total.
  assert.equal(grid.cells.length, 5);
  const series = pivotChartSeries({ ...def, target: { sheetId: "p", row: 0, column: 0 }, lastSize: { rows: grid.cells.length, columns: grid.cells[0].length } });
  assert.equal(series.length, 2);
  assert.deepEqual(series[0].categories, { sheetId: "p", startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 });
  assert.deepEqual(series.map((s) => [s.nameCell, s.values.startColumn]), [[{ sheetId: "p", row: 1, column: 1 }, 1], [{ sheetId: "p", row: 1, column: 2 }, 2]]);
  assert.deepEqual([grid.cells[1][1], grid.cells[2][0], grid.cells[3][2]], [2023, "East", 7]);
  assert.throws(() => pivotChartSeries({ ...def, rows: [], target: { sheetId: "p", row: 0, column: 0 }, lastSize: { rows: 2, columns: 2 } }), /row field/);
});

test("slicers, timelines and pivot charts come back from .xlsx", async () => {
  const { univerToXlsx, xlsxToUniver } = await import("../lib/xlsx.ts");
  const { SLICER_COMPONENT } = await import("../lib/slicers.ts");
  const JSZip = (await import("jszip")).default;
  const timeline: SlicerData = { kind: "timeline", caption: "When", source: { type: "pivot", pivotId: "p1", name: "Pivot 1" }, field: "Date", level: "quarters", period: { from: "2024-Q1", to: "2024-Q2" } };
  const s1: SlicerData = { ...slicer(["West"]), caption: "A very long caption ".repeat(20) };
  const dom = (id: string, data: SlicerData, left: number) => ({ drawingId: id, drawingType: 8, componentKey: SLICER_COMPONENT, unitId: "u", subUnitId: "s", transform: { left, top: 30, width: 160, height: 200 }, data, allowTransform: true });
  const pivot = { id: "p1", name: "Pivot 1", source: { sheetId: "s", range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 } }, target: { sheetId: "s", row: 5, column: 0 }, rows: ["Region"], columns: [], values: [{ field: "Sales", agg: "sum" }], filters: [{ field: "Region", exclude: ["East"] }], lastSize: { rows: 3, columns: 2 } };
  const book = {
    id: "u",
    name: "W",
    appVersion: "",
    locale: "enUS",
    styles: {},
    sheetOrder: ["s"],
    sheets: { s: { id: "s", name: "Data", cellData: { 0: { 0: { v: "Region" }, 1: { v: "Date" }, 2: { v: "Sales" } }, 1: { 0: { v: "West" }, 1: { v: 45366 }, 2: { v: 5 } }, 2: { 0: { v: "East" }, 1: { v: 45400 }, 2: { v: 3 } }, 5: { 0: { v: "Region" }, 1: { v: "Sum of Sales" } }, 6: { 0: { v: "West" }, 1: { v: 5 } }, 7: { 0: { v: "Grand Total" }, 1: { v: 5 } } } } },
    resources: [
      { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ s: { data: { a: dom("a", s1, 300), b: dom("b", timeline, 480) }, order: ["a", "b"] } }) },
      { name: "SHEET_SYNERGY_PIVOT_PLUGIN", data: JSON.stringify({ pivots: [pivot] }) },
      { name: "SHEET_SYNERGY_CHARTS_PLUGIN", data: JSON.stringify({ sheets: { s: [{ id: "c", type: "column", title: "Pivot 1", anchor: { row: 5, column: 4 }, pivotId: "p1", series: pivotChartSeries(pivot) }] } }) },
    ],
  };
  const bytes = await univerToXlsx(book as any);
  const zip = await JSZip.loadAsync(bytes);
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  assert.match(wb, /<definedName name="_SynergySlicer1_2" localSheetId="0" hidden="1"/);
  assert.match(await zip.file("xl/charts/chart1.xml")!.async("string"), /<sq:pivotChart pivot="Pivot 1"\/><\/c:ext><\/c:extLst><\/c:chartSpace>/);
  const back = await xlsxToUniver(bytes);
  const res = (n: string) => JSON.parse(back.resources!.find((r) => r.name === n)!.data);
  const sid = back.sheetOrder[0];
  const drawings = Object.values(res("SHEET_DRAWING_PLUGIN")[sid].data) as any[];
  const pivots = res("SHEET_SYNERGY_PIVOT_PLUGIN").pivots;
  assert.deepEqual(drawings.map((d) => [d.componentKey, d.data.kind, d.transform.left]), [[SLICER_COMPONENT, "slicer", 300], [SLICER_COMPONENT, "timeline", 480]]);
  assert.equal(drawings[0].data.caption, s1.caption);
  assert.equal(drawings[1].data.source.pivotId, pivots[0].id, "linked to the imported pivot table by name");
  assert.deepEqual(pivots[0].filters, [{ field: "Region", exclude: ["East"] }], "a filter on a row field comes back as hidden items");
  assert.equal(res("SHEET_SYNERGY_CHARTS_PLUGIN").sheets[sid][0].pivotId, pivots[0].id);
});

test("pivot slicers and pivot charts are Excel's own in .xlsx, and Excel's slicers come in", async () => {
  const { univerToXlsx, xlsxToUniver } = await import("../lib/xlsx.ts");
  const { SLICER_COMPONENT } = await import("../lib/slicers.ts");
  const JSZip = (await import("jszip")).default;
  const pivot = { id: "p1", name: "Pivot 1", source: { sheetId: "s", range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 } }, target: { sheetId: "s", row: 6, column: 0 }, rows: ["Region"], columns: [], values: [{ field: "Sales", agg: "sum" }], filters: [{ field: "Region", exclude: ["East"] }], lastSize: { rows: 4, columns: 2 } };
  const data: SlicerData = { kind: "slicer", caption: "Region", source: { type: "pivot", pivotId: "p1", name: "Pivot 1" }, field: "Region", selected: ["North", "West"], columns: 2 };
  const book = {
    id: "u",
    name: "Sales book",
    appVersion: "",
    locale: "enUS",
    styles: {},
    sheetOrder: ["s"],
    sheets: { s: { id: "s", name: "Data", cellData: { 0: { 0: { v: "Region" }, 1: { v: "Sales" } }, 1: { 0: { v: "West" }, 1: { v: 5 } }, 2: { 0: { v: "East" }, 1: { v: 3 } }, 3: { 0: { v: "North" }, 1: { v: 4 } } } } },
    resources: [
      { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ s: { data: { a: { drawingId: "a", drawingType: 8, componentKey: SLICER_COMPONENT, unitId: "u", subUnitId: "s", transform: { left: 300, top: 40, width: 180, height: 200 }, data, allowTransform: true } }, order: ["a"] } }) },
      { name: "SHEET_SYNERGY_PIVOT_PLUGIN", data: JSON.stringify({ pivots: [pivot] }) },
      { name: "SHEET_SYNERGY_CHARTS_PLUGIN", data: JSON.stringify({ sheets: { s: [{ id: "c", type: "column", title: "Pivot 1", anchor: { row: 6, column: 4 }, pivotId: "p1", series: pivotChartSeries(pivot) }] } }) },
    ],
  };
  const bytes = await univerToXlsx(book as any);
  const zip = await JSZip.loadAsync(bytes);
  const text = (p: string) => zip.file(p)!.async("string");
  // The pivot chart names its pivot table.
  assert.match(await text("xl/charts/chart1.xml"), /<c:pivotSource><c:name>\[Sales book\.xlsx\]Data!Pivot 1<\/c:name><c:fmtId val="0"\/><\/c:pivotSource><c:chart>/);
  // The slicer cache: tied to the pivot table and the pivot cache, items in order, the picked ones selected.
  const cache = await text("xl/slicerCaches/slicerCache1.xml");
  assert.match(cache, /name="Slicer_Region" sourceName="Region"><pivotTables><pivotTable tabId="1" name="Pivot 1"\/><\/pivotTables><data><tabular pivotCacheId="1"><items count="3"><i x="1"\/><i x="2" s="1"\/><i x="0" s="1"\/><\/items>/);
  assert.match(await text("xl/pivotCache/pivotCacheDefinition1.xml"), /<extLst><ext uri="\{725AE2AE-9491-48be-B2B4-4EB974FC3084\}"[^>]*><x14:pivotCacheDefinition pivotCacheId="1"\/><\/ext><\/extLst><\/pivotCacheDefinition>$/);
  assert.match(await text("xl/slicers/slicer1.xml"), /<slicer name="Region" cache="Slicer_Region" caption="Region" columnCount="2" rowHeight="241300"\/>/);
  const wb = await text("xl/workbook.xml");
  assert.match(wb, /<definedName name="Slicer_Region">#N\/A<\/definedName>/);
  assert.match(wb, /<x14:slicerCaches><x14:slicerCache r:id="rId\d+"\/><\/x14:slicerCaches>/);
  assert.match(await text("xl/_rels/workbook.xml.rels"), /Type="http:\/\/schemas.microsoft.com\/office\/2007\/relationships\/slicerCache" Target="slicerCaches\/slicerCache1.xml"/);
  assert.match(await text("xl/worksheets/sheet1.xml"), /<x14:slicerList><x14:slicer r:id="rId\d+"\/><\/x14:slicerList><\/ext><\/extLst><\/worksheet>/);
  assert.match(await text("[Content_Types].xml"), /PartName="\/xl\/slicers\/slicer1.xml" ContentType="application\/vnd.ms-excel.slicer\+xml"/);
  const drawingPath = Object.keys(zip.files).find((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p))!;
  assert.match(await text(drawingPath), /<a:graphicData uri="http:\/\/schemas.microsoft.com\/office\/drawing\/2010\/slicer"><sle:slicer [^>]*name="Region"\/>/);

  // As if made in Excel: without our hidden copy, the native slicer is read.
  zip.file("xl/workbook.xml", wb.replace(/<definedName name="_SynergySlicer[^>]*>[\s\S]*?<\/definedName>/g, ""));
  const back = await xlsxToUniver(new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
  const res = (n: string) => JSON.parse(back.resources!.find((r) => r.name === n)!.data);
  const sid = back.sheetOrder[0];
  const slicers = (Object.values(res("SHEET_DRAWING_PLUGIN")[sid].data) as any[]).filter((d) => d.componentKey === SLICER_COMPONENT);
  assert.equal(slicers.length, 1);
  assert.deepEqual({ ...slicers[0].data, source: { ...slicers[0].data.source, pivotId: "-" } }, { ...data, source: { type: "pivot", pivotId: "-", name: "Pivot 1" } });
  assert.equal(slicers[0].data.source.pivotId, res("SHEET_SYNERGY_PIVOT_PLUGIN").pivots[0].id);
  // Where Excel's anchor put it.
  const anchorCol = Number(/<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>(\d+)<\/xdr:col>[\s\S]*?<sle:slicer/.exec(await text(drawingPath))?.[1]);
  assert.equal(slicers[0].sheetTransform.from.column, anchorCol);
  assert.ok(slicers[0].transform.width > 100);
  assert.equal(res("SHEET_SYNERGY_CHARTS_PLUGIN").sheets[sid][0].pivotId, res("SHEET_SYNERGY_PIVOT_PLUGIN").pivots[0].id);
});
