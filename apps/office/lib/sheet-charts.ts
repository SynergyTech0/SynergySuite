import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { UniverWorkbook } from "./xlsx";
import { altOf, cNvPrXml, placeInWorksheet } from "./sheet-shapes.ts";

export const SHEET_CHART_RESOURCE = "SHEET_SYNERGY_CHARTS_PLUGIN";
export type ChartType = "column" | "bar" | "line" | "pie" | "area" | "scatter";
export type ChartRange = { sheetId: string; startRow: number; endRow: number; startColumn: number; endColumn: number };
export type ChartCell = { sheetId: string; row: number; column: number };
/** A series; without categories the points are numbered. In a scatter chart the categories are the x values. */
export type ChartSeries = { name: string; nameCell?: ChartCell; categories?: ChartRange; values: ChartRange };
export type SheetChart = {
  id: string;
  type: ChartType;
  title: string;
  anchor: { row: number; column: number };
  series: ChartSeries[];
  /** A pivot chart: its series follow this pivot table's output. */
  pivotId?: string;
  /** Alternative text for screen readers (Excel's Alt Text), or marked decorative. */
  alt?: string;
  decorative?: boolean;
};
/** Charts by sheet; `chartSheets` are sheets that are only a chart (Excel's chart sheets), the chart filling the sheet. */
export type SheetChartResource = { sheets: Record<string, SheetChart[]>; chartSheets?: string[] };

export function chartResource(resources?: { name: string; data: string }[]): SheetChartResource {
  const data = resources?.find((resource) => resource.name === SHEET_CHART_RESOURCE)?.data;
  if (!data) return { sheets: {} };
  try {
    const parsed = JSON.parse(data) as SheetChartResource;
    return parsed?.sheets && typeof parsed.sheets === "object" ? parsed : { sheets: {} };
  } catch {
    return { sheets: {} };
  }
}

export function chartFromSelection(
  sheetId: string,
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  type: ChartType,
  id: string,
): SheetChart {
  const { startRow, endRow, startColumn, endColumn } = range;
  if (startRow < 0 || startColumn < 0 || endRow - startRow < 2 || endColumn <= startColumn) {
    throw new Error("Select a header row and at least two data rows, with labels in the first column.");
  }
  if (endRow - startRow > 1000 || endColumn - startColumn > 12) throw new Error("Select at most 1,000 data rows and 12 series.");
  const categories: ChartRange = { sheetId, startRow: startRow + 1, endRow, startColumn, endColumn: startColumn };
  const series: ChartSeries[] = [];
  for (let column = startColumn + 1; column <= endColumn; column++) {
    series.push({
      name: `Series ${column - startColumn}`,
      nameCell: { sheetId, row: startRow, column },
      categories,
      values: { sheetId, startRow: startRow + 1, endRow, startColumn: column, endColumn: column },
    });
  }
  return { id, type, title: "Chart", anchor: { row: startRow, column: endColumn + 2 }, series };
}

/**
 * The series of a pivot chart, from the pivot table's last output: the
 * innermost row field gives the categories (subtotal rows included when there
 * are outer fields), each value column (grand totals left out) is a series
 * named by its header.
 */
export function pivotChartSeries(def: { target: { sheetId: string; row: number; column: number }; rows: string[]; columns: string[]; values: unknown[]; grandTotals?: boolean; lastSize?: { rows: number; columns: number } }): ChartSeries[] {
  const size = def.lastSize;
  if (!size?.rows || !size.columns || !def.rows.length || !def.values.length) throw new Error("A pivot chart needs a pivot table with a row field and a value.");
  const grand = def.grandTotals !== false;
  const multi = def.values.length > 1;
  const headerRows = def.columns.length ? 1 + def.columns.length + (multi ? 1 : 0) : 1;
  const lead = Math.max(1, def.rows.length);
  const totalColumns = def.columns.length && grand ? def.values.length : 0;
  const lastBody = size.rows - 1 - (grand ? 1 : 0);
  const valueColumns = size.columns - lead - totalColumns;
  if (lastBody < headerRows || valueColumns < 1) throw new Error("The pivot table has no data to chart.");
  const { sheetId, row, column } = def.target;
  const categories: ChartRange = { sheetId, startRow: row + headerRows, endRow: row + lastBody, startColumn: column + lead - 1, endColumn: column + lead - 1 };
  return Array.from({ length: Math.min(12, valueColumns) }, (_, k) => ({
    name: `Series ${k + 1}`,
    nameCell: { sheetId, row: row + headerRows - 1, column: column + lead + k },
    categories,
    values: { sheetId, startRow: row + headerRows, endRow: row + lastBody, startColumn: column + lead + k, endColumn: column + lead + k },
  }));
}

function valuesIn(book: UniverWorkbook, range: ChartRange): (string | number | null)[] {
  const sheet = book.sheets[range.sheetId];
  if (!sheet) return [];
  const values: (string | number | null)[] = [];
  for (let row = range.startRow; row <= range.endRow && values.length < 1000; row++) {
    for (let col = range.startColumn; col <= range.endColumn && values.length < 1000; col++) {
      const value = sheet.cellData?.[row]?.[col]?.v;
      values.push(typeof value === "string" || typeof value === "number" ? value : value == null ? null : String(value));
    }
  }
  return values;
}

export function chartData(book: UniverWorkbook, chart: SheetChart) {
  return chart.series.map((series) => {
    const nameValue = series.nameCell && book.sheets[series.nameCell.sheetId]?.cellData?.[series.nameCell.row]?.[series.nameCell.column]?.v;
    const numbers = valuesIn(book, series.values).map((value) => value == null || value === "" ? null : Number(value));
    const categories = series.categories ? valuesIn(book, series.categories).map((value, index) => value == null ? `${index + 1}` : String(value)) : numbers.map((_, index) => `${index + 1}`);
    return {
      name: nameValue == null || nameValue === "" ? series.name : String(nameValue),
      categories,
      values: numbers.map((value) => value != null && Number.isFinite(value) ? value : null),
    };
  });
}

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unesc = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_match, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => new RegExp(`<(?:[A-Za-z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${name}>`).exec(xml)?.[1] || "";
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:[A-Za-z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${name}>`, "g"))].map((match) => match[1]);
const xmlText = (xml: string) => unesc([...xml.matchAll(/<(?:[A-Za-z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?t>/g)].map((match) => match[1]).join(""));
const attr = (xml: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] || "";
const resolvePart = (base: string, target: string) => target.startsWith("/") ? target.slice(1) : new URL(target, `http://parts/${base}`).pathname.slice(1);
const relPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const relationships = (xml: string) => {
  const byId = new Map<string, { type: string; target: string }>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const id = attr(match[0], "Id");
    if (id) byId.set(id, { type: attr(match[0], "Type"), target: attr(match[0], "Target") });
  }
  return byId;
};
const nextRel = (xml: string) => Math.max(0, ...[...xml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))) + 1;
const addRel = (xml: string, id: string, type: string, target: string) => {
  const body = `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  return xml ? xml.replace("</Relationships>", `${body}</Relationships>`) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
};
const sheetName = (book: UniverWorkbook, id: string) => book.sheets[id]?.name || "Sheet1";
const rangeFormula = (book: UniverWorkbook, range: ChartRange) => {
  const name = sheetName(book, range.sheetId).replace(/'/g, "''");
  const start = XLSX.utils.encode_cell({ r: range.startRow, c: range.startColumn }).replace(/([A-Z]+)(\d+)/, "$$$1$$$2");
  const end = XLSX.utils.encode_cell({ r: range.endRow, c: range.endColumn }).replace(/([A-Z]+)(\d+)/, "$$$1$$$2");
  return `'${name}'!${start}${start === end ? "" : `:${end}`}`;
};
const cellFormula = (book: UniverWorkbook, cell: ChartCell) => rangeFormula(book, { sheetId: cell.sheetId, startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column });
const cache = (kind: "str" | "num", values: (string | number | null)[]) => {
  const points = values.map((value, index) => value == null || value === "" ? "" : `<c:pt idx="${index}"><c:v>${esc(value)}</c:v></c:pt>`).join("");
  return `<c:${kind}Cache>${kind === "num" ? "<c:formatCode>General</c:formatCode>" : ""}<c:ptCount val="${values.length}"/>${points}</c:${kind}Cache>`;
};
const titleXml = (title: string) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

// A pivot chart is Excel's own pivot chart: <c:pivotSource> names the pivot
// table ([file]Sheet!PivotTable1), and Excel ties the chart to it. The link
// is also kept by name in an extension of ours, read first on the way back.
const PIVOT_EXT = "{9F3C4E1A-2B7D-4C58-8E6A-1D0F5B3A7C21}";
function chartPivot(book: UniverWorkbook, chart: SheetChart): { name: string; sheet: string } | null {
  if (!chart.pivotId) return null;
  try {
    const p = (JSON.parse(book.resources?.find((r) => r.name === "SHEET_SYNERGY_PIVOT_PLUGIN")?.data || "{}").pivots || []).find((x: { id: string }) => x.id === chart.pivotId);
    const sheet = p && book.sheets[p.target?.sheetId]?.name;
    return p?.name && sheet ? { name: p.name, sheet: sheet.slice(0, 31) } : null;
  } catch {
    return null;
  }
}
function pivotExt(book: UniverWorkbook, chart: SheetChart): string {
  const p = chartPivot(book, chart);
  return p ? `<c:extLst><c:ext uri="${PIVOT_EXT}" xmlns:sq="urn:synergy:chart"><sq:pivotChart pivot="${esc(p.name)}"/></c:ext></c:extLst>` : "";
}
/** Excel's pivot chart source: "[Book.xlsx]Sheet!PivotTable1". */
export function pivotSourceXml(book: UniverWorkbook, chart: SheetChart): string {
  const p = chartPivot(book, chart);
  if (!p) return "";
  const file = `${String((book as { name?: string }).name || "Workbook").replace(/[[\]]/g, "")}.xlsx`;
  const sheet = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(p.sheet) ? p.sheet : `'${p.sheet.replace(/'/g, "''")}'`;
  return `<c:pivotSource><c:name>${esc(`[${file}]${sheet}!${p.name}`)}</c:name><c:fmtId val="0"/></c:pivotSource>`;
}

function chartXml(book: UniverWorkbook, chart: SheetChart): string {
  const data = chartData(book, chart);
  const series = chart.series.slice(0, chart.type === "pie" ? 1 : undefined).map((item, index) => {
    const points = data[index];
    const tx = item.nameCell
      ? `<c:tx><c:strRef><c:f>${esc(cellFormula(book, item.nameCell))}</c:f>${cache("str", [points.name])}</c:strRef></c:tx>`
      : `<c:tx><c:v>${esc(points.name)}</c:v></c:tx>`;
    const vals = `<c:numRef><c:f>${esc(rangeFormula(book, item.values))}</c:f>${cache("num", points.values)}</c:numRef>`;
    if (chart.type === "scatter") {
      // Markers only, as Excel's default scatter chart.
      const xs = item.categories ? `<c:xVal><c:numRef><c:f>${esc(rangeFormula(book, item.categories))}</c:f>${cache("num", points.categories)}</c:numRef></c:xVal>` : "";
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>${xs}<c:yVal>${vals}</c:yVal><c:smooth val="0"/></c:ser>`;
    }
    const cat = item.categories ? `<c:cat><c:strRef><c:f>${esc(rangeFormula(book, item.categories))}</c:f>${cache("str", points.categories)}</c:strRef></c:cat>` : "";
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${cat}<c:val>${vals}</c:val></c:ser>`;
  }).join("");
  const axis = `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/></c:valAx>`;
  const valAxes = `<c:valAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/></c:valAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/></c:valAx>`;
  const plot = chart.type === "pie"
    ? `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
    : chart.type === "scatter"
      ? `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:axId val="10"/><c:axId val="20"/></c:scatterChart>${valAxes}`
    : chart.type === "area"
      ? `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:axId val="10"/><c:axId val="20"/></c:areaChart>${axis}`
    : chart.type === "line"
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>${axis}`
      : `<c:barChart><c:barDir val="${chart.type === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/><c:axId val="10"/><c:axId val="20"/></c:barChart>${axis}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pivotSourceXml(book, chart)}<c:chart>${titleXml(chart.title)}${chart.pivotId && chartPivot(book, chart) ? '<c:autoTitleDeleted val="0"/><c:pivotFmts/>' : ""}<c:plotArea><c:layout/>${plot}</c:plotArea>${chart.type !== "pie" && chart.series.length > 1 ? "<c:legend><c:legendPos val=\"r\"/></c:legend>" : ""}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${pivotExt(book, chart)}</c:chartSpace>`;
}

function chartAnchorXml(chart: SheetChart, relId: string, frameId: number) {
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${chart.anchor.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.anchor.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="5143500" cy="2857500"/>${chartFrameXml(chart, relId, frameId)}<xdr:clientData/></xdr:oneCellAnchor>`;
}

function chartFrameXml(chart: SheetChart, relId: string, frameId: number) {
  return `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr>${cNvPrXml(frameId, chart.title || "Chart", chart)}<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
}

export async function addChartsToXlsx(bytes: Uint8Array, book: UniverWorkbook): Promise<Uint8Array> {
  const model = chartResource(book.resources);
  if (!Object.values(model.sheets).some((charts) => charts.length)) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const read = async (path: string) => zip.file(path) ? zip.file(path)!.async("string") : "";
  let contentTypes = await read("[Content_Types].xml");
  let nextDrawing = Math.max(0, ...Object.keys(zip.files).map((path) => Number(/^xl\/drawings\/drawing(\d+)\.xml$/.exec(path)?.[1] || 0))) + 1;
  let nextChart = Math.max(0, ...Object.keys(zip.files).map((path) => Number(/^xl\/charts\/chart(\d+)\.xml$/.exec(path)?.[1] || 0))) + 1;
  const wbRels = relationships(await read("xl/_rels/workbook.xml.rels"));
  const workbookSheets = [...(await read("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)];
  let wbRelsXml = await read("xl/_rels/workbook.xml.rels");
  let nextChartSheet = 1;
  for (const [index, sheetId] of book.sheetOrder.entries()) {
    const charts = model.sheets[sheetId] || [];
    if (!charts.length) continue;
    const sheetTag = workbookSheets[index]?.[0] || "";
    if (model.chartSheets?.includes(sheetId)) {
      // A chart sheet: the worksheet written for it becomes a chartsheet part holding the chart.
      const relId = attr(sheetTag, "r:id");
      const target = wbRels.get(relId)?.target;
      if (!target) continue;
      const oldPath = resolvePart("xl/workbook.xml", target);
      while (zip.file(`xl/chartsheets/sheet${nextChartSheet}.xml`)) nextChartSheet++;
      const csPath = `xl/chartsheets/sheet${nextChartSheet++}.xml`;
      const drawingPath = `xl/drawings/drawing${nextDrawing++}.xml`;
      const chartPath = `xl/charts/chart${nextChart++}.xml`;
      zip.remove(oldPath);
      zip.remove(relPath(oldPath));
      const codeName = /<sheetPr\b[^>]*\bcodeName="([^"]*)"/.exec(await read(oldPath))?.[1];
      zip.file(csPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr${codeName ? ` codeName="${esc(codeName)}"` : ""}/><sheetViews><sheetView zoomToFit="1" workbookViewId="0"/></sheetViews><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><drawing r:id="rId1"/></chartsheet>`);
      zip.file(relPath(csPath), addRel("", "rId1", "drawing", `../drawings/${drawingPath.split("/").at(-1)}`));
      zip.file(drawingPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="8666667" cy="6300000"/>${chartFrameXml(charts[0], "rId1", 2)}<xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`);
      zip.file(relPath(drawingPath), addRel("", "rId1", "chart", `../charts/${chartPath.split("/").at(-1)}`));
      zip.file(chartPath, chartXml(book, charts[0]));
      wbRelsXml = wbRelsXml.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${relId}"[^>]*/>`), `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/${csPath.split("/").at(-1)}"/>`);
      contentTypes = contentTypes
        .replace(new RegExp(`<Override PartName="/${oldPath.replace(/[.]/g, "\\.")}"[^>]*/>`), "")
        .replace("</Types>", `<Override PartName="/${csPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/><Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
      continue;
    }
    const target = wbRels.get(attr(sheetTag, "r:id"))?.target;
    if (!target) continue;
    const sheetPath = resolvePart("xl/workbook.xml", target);
    let sheetXml = await read(sheetPath);
    let sheetRels = await read(relPath(sheetPath));
    const drawingId = attr(/<drawing\b[^>]*\/?\s*>/.exec(sheetXml)?.[0] || "", "r:id");
    const drawingTarget = relationships(sheetRels).get(drawingId)?.target;
    const drawingPath = drawingTarget ? resolvePart(sheetPath, drawingTarget) : `xl/drawings/drawing${nextDrawing++}.xml`;
    let drawingXml = await read(drawingPath);
    let drawingRels = await read(relPath(drawingPath));
    if (!drawingXml) {
      drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>`;
      const id = `rId${nextRel(sheetRels)}`;
      sheetRels = addRel(sheetRels, id, "drawing", `../drawings/${drawingPath.split("/").at(-1)}`);
      sheetXml = placeInWorksheet(sheetXml, `<drawing r:id="${id}"/>`);
      contentTypes = contentTypes.replace("</Types>", `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    let frameId = Math.max(0, ...[...drawingXml.matchAll(/cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))) + 1;
    for (const chart of charts) {
      const chartPath = `xl/charts/chart${nextChart++}.xml`;
      const relId = `rId${nextRel(drawingRels)}`;
      drawingRels = addRel(drawingRels, relId, "chart", `../charts/${chartPath.split("/").at(-1)}`);
      const anchor = chartAnchorXml(chart, relId, frameId++);
      drawingXml = drawingXml.replace(/<\/(?:xdr:)?wsDr>/, `${anchor}$&`);
      zip.file(chartPath, chartXml(book, chart));
      contentTypes = contentTypes.replace("</Types>", `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
    }
    zip.file(sheetPath, sheetXml);
    zip.file(relPath(sheetPath), sheetRels);
    zip.file(drawingPath, drawingXml);
    zip.file(relPath(drawingPath), drawingRels);
  }
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("xl/_rels/workbook.xml.rels", wbRelsXml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function parseFormula(book: UniverWorkbook, formula: string, defaultSheetId: string): ChartRange | null {
  const match = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/i.exec(unesc(formula.trim()));
  if (!match) return null;
  const name = (match[1] || match[2] || "").replace(/''/g, "'");
  const sheetId = name ? book.sheetOrder.find((id) => book.sheets[id]?.name.toLowerCase() === name.toLowerCase()) : defaultSheetId;
  if (!sheetId) return null;
  const decoded = XLSX.utils.decode_range(match[3].replace(/\$/g, ""));
  return { sheetId, startRow: decoded.s.r, endRow: decoded.e.r, startColumn: decoded.s.c, endColumn: decoded.e.c };
}

function parseChartXml(xml: string, book: UniverWorkbook, hostSheetId: string, id: string, anchor: SheetChart["anchor"]): SheetChart | null {
  // The first plot in the chart; 3-D and doughnut kinds come in as their flat cousins.
  const KINDS: [string, ChartType][] = [["pieChart", "pie"], ["pie3DChart", "pie"], ["doughnutChart", "pie"], ["ofPieChart", "pie"], ["lineChart", "line"], ["line3DChart", "line"], ["stockChart", "line"], ["radarChart", "line"], ["barChart", "column"], ["bar3DChart", "column"], ["areaChart", "area"], ["area3DChart", "area"], ["scatterChart", "scatter"], ["bubbleChart", "scatter"]];
  const plotArea = tag(xml, "plotArea");
  const found = KINDS.map(([el, kind]) => ({ el, kind, at: plotArea.search(new RegExp(`<(?:[A-Za-z0-9]+:)?${el}\\b`)) })).filter((k) => k.at >= 0).sort((a, b) => a.at - b.at)[0];
  if (!found) return null;
  const plot = tag(plotArea, found.el);
  const type: ChartType = found.kind === "column" && /<(?:c:)?barDir\b[^>]*val="bar"/.test(plot) ? "bar" : found.kind;
  const xy = type === "scatter";
  const series: ChartSeries[] = [];
  for (const body of tags(plot, "ser")) {
    const categories = parseFormula(book, tag(tag(body, xy ? "xVal" : "cat"), "f"), hostSheetId) || undefined;
    const values = parseFormula(book, tag(tag(body, xy ? "yVal" : "val"), "f"), hostSheetId);
    if (!values) continue;
    const tx = tag(body, "tx");
    const nameRange = parseFormula(book, tag(tx, "f"), hostSheetId);
    const nameCell = nameRange ? { sheetId: nameRange.sheetId, row: nameRange.startRow, column: nameRange.startColumn } : undefined;
    const name = unesc(tag(tx, "v")) || xmlText(tx) || `Series ${series.length + 1}`;
    series.push({ name, nameCell, categories, values });
  }
  if (!series.length) return null;
  const titleBody = tag(xml, "title");
  const titleRange = parseFormula(book, tag(titleBody, "f"), hostSheetId);
  const titleValue = titleRange && book.sheets[titleRange.sheetId]?.cellData?.[titleRange.startRow]?.[titleRange.startColumn]?.v;
  return { id, type, title: xmlText(titleBody) || (titleValue == null ? "" : String(titleValue)) || "Chart", anchor, series };
}

export async function chartsFromXlsx(bytes: Uint8Array, book: UniverWorkbook): Promise<SheetChartResource> {
  const out: SheetChartResource = { sheets: {} };
  const zip = await JSZip.loadAsync(bytes);
  const read = async (path: string) => zip.file(path) ? zip.file(path)!.async("string") : "";
  const wbRels = relationships(await read("xl/_rels/workbook.xml.rels"));
  for (const sheetTag of (await read("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(attr(sheetTag[0], "name"));
    const sheetId = book.sheetOrder.find((id) => book.sheets[id]?.name === name);
    const target = wbRels.get(attr(sheetTag[0], "r:id"))?.target;
    if (!sheetId || !target) continue;
    const sheetPath = resolvePart("xl/workbook.xml", target);
    const sheetXml = await read(sheetPath);
    const drawingRelId = attr(/<drawing\b[^>]*\/?\s*>/.exec(sheetXml)?.[0] || "", "r:id");
    const drawingTarget = relationships(await read(relPath(sheetPath))).get(drawingRelId)?.target;
    if (!drawingTarget) continue;
    const drawingPath = resolvePart(sheetPath, drawingTarget);
    const drawingRels = relationships(await read(relPath(drawingPath)));
    const drawingXml = await read(drawingPath);
    const anchors = [...tags(drawingXml, "oneCellAnchor"), ...tags(drawingXml, "twoCellAnchor"), ...tags(drawingXml, "absoluteAnchor")];
    const isChartSheet = /^xl\/chartsheets\//.test(sheetPath);
    for (const [index, body] of anchors.entries()) {
      const chartRelId = attr(/<(?:c:)?chart\b[^>]*\/?\s*>/.exec(body)?.[0] || "", "r:id");
      const chartTarget = drawingRels.get(chartRelId)?.target;
      if (!chartTarget) continue;
      const marker = tag(body, "from");
      const anchor = { row: Number(tag(marker, "row")) || 0, column: Number(tag(marker, "col")) || 0 };
      const chartPath = resolvePart(drawingPath, chartTarget);
      const chartXmlText = await read(chartPath);
      const chart = parseChartXml(chartXmlText, book, sheetId, `chart-${sheetId}-${index}`, anchor);
      // A pivot chart: linked again to its pivot table, by name.
      // Ours first, then Excel's own pivot source ([file]Sheet!PivotTable1).
      const pivotName = /<sq:pivotChart\b[^>]*\bpivot="([^"]*)"/.exec(chartXmlText)?.[1] ?? /<c:pivotSource>\s*<c:name>[^<]*!([^<!]+)<\/c:name>/.exec(chartXmlText)?.[1];
      if (chart && pivotName) {
        try {
          const pivot = (JSON.parse(book.resources?.find((r) => r.name === "SHEET_SYNERGY_PIVOT_PLUGIN")?.data || "{}").pivots || []).find((p: { name: string }) => p.name === unesc(pivotName));
          if (pivot) chart.pivotId = pivot.id;
        } catch {
          /* stays an ordinary chart */
        }
      }
      if (chart) Object.assign(chart, altOf(body));
      if (chart) (out.sheets[sheetId] ||= []).push(chart);
      if (chart && isChartSheet && !out.chartSheets?.includes(sheetId)) (out.chartSheets ||= []).push(sheetId);
    }
  }
  return out;
}

/** The cell reader does not understand chart frames in some third-party drawings.
 *  Remove those frames only from its input; chart import reads the original ZIP. */
export async function withoutChartFrames(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (path: string) => zip.file(path) ? zip.file(path)!.async("string") : "";
  for (const sheetPath of Object.keys(zip.files).filter((path) => /^xl\/worksheets\/[^/]+\.xml$/.test(path))) {
    let sheetXml = await read(sheetPath);
    let sheetRels = await read(relPath(sheetPath));
    const drawingTag = /<drawing\b[^>]*\/?\s*>/.exec(sheetXml)?.[0];
    const drawingRelId = attr(drawingTag || "", "r:id");
    const drawingTarget = relationships(sheetRels).get(drawingRelId)?.target;
    if (!drawingTag || !drawingTarget) continue;
    const drawingPath = resolvePart(sheetPath, drawingTarget);
    const drawingXml = await read(drawingPath);
    if (!/<(?:[A-Za-z0-9]+:)?chart\b/.test(drawingXml)) continue;
    const framePattern = /<(?:xdr:)?(oneCellAnchor|twoCellAnchor)\b[^>]*>[\s\S]*?<\/(?:xdr:)?\1>/g;
    const cleaned = drawingXml.replace(framePattern, (frame) => /<(?:[A-Za-z0-9]+:)?chart\b/.test(frame) ? "" : frame);
    if (/<(?:xdr:)?(oneCellAnchor|twoCellAnchor)\b/.test(cleaned)) {
      zip.file(drawingPath, cleaned);
      const drawingRelsPath = relPath(drawingPath);
      const drawingRels = await read(drawingRelsPath);
      zip.file(drawingRelsPath, drawingRels.replace(/<Relationship\b[^>]*\/?\s*>/g, (entry) => /\/chart"/.test(entry) ? "" : entry));
    } else {
      sheetXml = sheetXml.replace(drawingTag, "");
      sheetRels = sheetRels.replace(/<Relationship\b[^>]*\/?\s*>/g, (entry) => attr(entry, "Id") === drawingRelId ? "" : entry);
      zip.file(sheetPath, sheetXml);
      zip.file(relPath(sheetPath), sheetRels);
      zip.remove(drawingPath);
      zip.remove(relPath(drawingPath));
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
