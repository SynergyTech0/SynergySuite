// Charts and SmartArt in Word documents, built on the Slides code (the chart
// model and its SVG view, the SmartArt layouts) and saved the way Word saves
// them: a chart is a c:chartSpace part with its data in an embedded workbook,
// a SmartArt graphic is the diagram data model, layout, style and colour parts
// plus the drawing Word shows (dsp:drawing).
import JSZip from "jszip";
import { CHART_COLORS, isCombo, type ChartEl } from "../slides/model";
import { buildDiagram, parseOutline, type DiagramKind, type OutlineItem } from "../slides/smartart";
import { trendlineXml, readAxes, readTrend, comboGroups } from "../slides/pptx-chart";
import { LAYOUT_ID, layoutDefXml, styleDefXml, colorsDefXml } from "../slides/pptx-smartart";
import { attr, child, descendants, kids, parseXml, type XEl } from "../slides/xml";

export type ChartData = Pick<ChartEl, "chartType" | "barDir" | "stacked" | "dataLabels" | "legendPos" | "title" | "categories" | "series" | "showLegend" | "valAx" | "catAx">;
export type DiagramData = { kind: DiagramKind; items: OutlineItem[]; accent: string };

export const CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const DIAGRAM_NS = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DSP_NS = "http://schemas.microsoft.com/office/drawing/2008/diagram";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EMU_PX = 9525;

// ------------------------------------------------------------------ charts

export function sampleChart(): ChartData {
  return {
    chartType: "bar",
    title: "Sales",
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "2024", values: [12, 18, 15, 22] },
      { name: "2025", values: [14, 21, 19, 26] },
    ],
  };
}

/** A1-style column letters. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** The chart's data as rows: header (blank, series names), then a category and its values per row. */
export function chartTable(c: ChartData): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [["", ...c.series.map((s) => s.name)]];
  const n = Math.max(c.categories.length, ...c.series.map((s) => s.values.length), 0);
  for (let i = 0; i < n; i++) rows.push([c.categories[i] ?? "", ...c.series.map((s) => (Number.isFinite(s.values[i]) ? s.values[i] : null))]);
  return rows;
}

/** Tab- or comma-separated text (as typed in the chart dialog) to categories and series. */
export function parseChartTable(text: string): Pick<ChartData, "categories" | "series"> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { categories: [], series: [] };
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(",")).map((x) => x.trim());
  const head = split(lines[0]);
  const series = head.slice(1).map((name, i) => ({ name: name || `Series ${i + 1}`, values: [] as number[] }));
  const categories: string[] = [];
  for (const l of lines.slice(1)) {
    const cells = split(l);
    categories.push(cells[0] || "");
    series.forEach((s, i) => s.values.push(Number(String(cells[i + 1] ?? "").replace(/[, ]/g, "")) || 0));
  }
  return { categories, series };
}
export const chartTableText = (c: ChartData) => chartTable(c).map((r) => r.map((v) => (v === null ? "" : String(v))).join("\t")).join("\n");

function strCache(values: string[]): string {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
}
function numCache(values: number[], fmt = "General"): string {
  return `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : "")).join("")}</c:numCache>`;
}
const fill = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
function richTitle(text: string, size = 1400): string {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="0"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="0"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}
const GRID = `<c:majorGridlines><c:spPr><a:ln w="9525">${fill("D9D9D9")}</a:ln></c:spPr></c:majorGridlines>`;
const MINOR = `<c:minorGridlines><c:spPr><a:ln w="3175">${fill("F2F2F2")}</a:ln></c:spPr></c:minorGridlines>`;

function axisXml(kind: "cat" | "val", id: number, cross: number, pos: string, ax: ChartData["valAx"] = {}, valueAxis: boolean, betweenCats = true): string {
  const scaling = `<c:scaling><c:orientation val="minMax"/>${ax.max !== undefined ? `<c:max val="${ax.max}"/>` : ""}${ax.min !== undefined ? `<c:min val="${ax.min}"/>` : ""}</c:scaling>`;
  const grid = (valueAxis ? ax.grid !== false : !!ax.grid) ? GRID : "";
  const tail = kind === "cat" ? `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>` : `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="${betweenCats ? "between" : "midCat"}"/>${ax.major ? `<c:majorUnit val="${ax.major}"/>` : ""}${ax.minor ? `<c:minorUnit val="${ax.minor}"/>` : ""}`;
  return (
    `<c:${kind}Ax><c:axId val="${id}"/>${scaling}<c:delete val="0"/><c:axPos val="${pos}"/>${grid}${ax.minorGrid ? MINOR : ""}${ax.title ? richTitle(ax.title, 1000) : ""}` +
    `<c:numFmt formatCode="${esc(ax.fmt || "General")}" sourceLinked="${ax.fmt ? 0 : 1}"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln w="9525">${fill("BFBFBF")}</a:ln></c:spPr>${tail}</c:${kind}Ax>`
  );
}

/** A Word chart part (c:chartSpace) for the chart, its data cached in the part and kept in Sheet1 of the embedded workbook (rId1). */
export function chartSpaceXml(c: ChartData, opts: { embedded?: boolean } = {}): string {
  const type = c.chartType;
  const round = type === "pie" || type === "doughnut";
  const scatter = type === "scatter";
  const n = Math.max(c.categories.length, ...c.series.map((s) => s.values.length), 0);
  const last = n + 1;
  const cats = Array.from({ length: n }, (_, i) => c.categories[i] ?? "");
  const color = (s: { color?: string }, i: number) => (s.color && /^[0-9a-f]{6}$/i.test(s.color) ? s.color.toUpperCase() : CHART_COLORS[i % CHART_COLORS.length]);
  const dLbls = c.dataLabels ? `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : "";
  const serXml = (s: ChartData["series"][number], i: number, type: ChartData["chartType"]) => {
    const col = colName(i + 1);
    const tx = `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
    const vals = Array.from({ length: n }, (_, k) => s.values[k]);
    const valRef = (tag: string) => `<c:${tag}><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${last}</c:f>${numCache(vals as number[], c.valAx?.fmt)}</c:numRef></c:${tag}>`;
    const catRef = (tag: string) =>
      scatter
        ? `<c:${tag}><c:numRef><c:f>Sheet1!$A$2:$A$${last}</c:f>${numCache(cats.map((x) => Number(x)))}</c:numRef></c:${tag}>`
        : `<c:${tag}><c:strRef><c:f>Sheet1!$A$2:$A$${last}</c:f>${strCache(cats)}</c:strRef></c:${tag}>`;
    const hex = color(s, i);
    const spPr =
      type === "line" || scatter
        ? `<c:spPr><a:ln w="28575" cap="rnd">${scatter ? "<a:noFill/>" : fill(hex)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="${scatter ? "circle" : "none"}"/>${scatter ? `<c:size val="7"/><c:spPr>${fill(hex)}<a:ln><a:noFill/></a:ln></c:spPr>` : ""}</c:marker>`
        : round
          ? ""
          : `<c:spPr>${fill(hex)}<a:ln><a:noFill/></a:ln></c:spPr>${type === "bar" ? '<c:invertIfNegative val="0"/>' : ""}`;
    const points = round ? cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${fill(CHART_COLORS[k % CHART_COLORS.length])}<a:ln w="19050">${fill("FFFFFF")}</a:ln></c:spPr></c:dPt>`).join("") : "";
    const trend = s.trend && !round ? trendlineXml(s.trend, hex) : "";
    const body = scatter ? `${catRef("xVal")}${valRef("yVal")}<c:smooth val="0"/>` : `${catRef("cat")}${valRef("val")}${type === "line" ? '<c:smooth val="0"/>' : ""}`;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr}${points}${dLbls}${trend}${body}</c:ser>`;
  };
  const axIds = round ? "" : '<c:axId val="500000001"/><c:axId val="500000002"/>';
  // a combo chart: one plot per chart type (and axis), each series keeping its own type
  const combo = (type === "bar" || type === "line" || type === "area") && isCombo(c);
  const groups = combo ? comboGroups(c as ChartEl) : [{ type: type as "bar" | "line" | "area", y2: false, idx: c.series.map((_, i) => i) }];
  const groupXml = (g: { type: string; y2: boolean; idx: number[] }) => {
    const t = g.type as ChartData["chartType"];
    const sers = g.idx.map((i) => serXml(c.series[i], i, t)).join("");
    const ids = g.y2 ? '<c:axId val="500000003"/><c:axId val="500000004"/>' : axIds;
    // stacking belongs to the chart's own type
    const stacked = c.stacked && t === type;
    const grouping = stacked ? "stacked" : t === "bar" ? "clustered" : "standard";
    if (t === "bar") return `<c:barChart><c:barDir val="${c.barDir || "col"}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="150"/>${stacked ? '<c:overlap val="100"/>' : ""}${ids}</c:barChart>`;
    if (t === "line") return `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ids}</c:lineChart>`;
    return `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:areaChart>`;
  };
  const sers = c.series.map((s, i) => serXml(s, i, type)).join("");
  let plot: string;
  if (type === "bar" || type === "line" || type === "area") plot = groups.map(groupXml).join("");
  else if (type === "pie") plot = `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`;
  else if (type === "doughnut") plot = `<c:doughnutChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`;
  else plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}${axIds}</c:scatterChart>`;
  const horizontal = type === "bar" && c.barDir === "bar";
  const axes = round
    ? ""
    : scatter
      ? axisXml("val", 500000001, 500000002, "b", c.catAx, false, false) + axisXml("val", 500000002, 500000001, "l", c.valAx, true, false)
      : axisXml("cat", 500000001, 500000002, horizontal ? "l" : "b", c.catAx, false) +
        axisXml("val", 500000002, 500000001, horizontal ? "b" : "l", c.valAx, true) +
        // the secondary value axis on the far side, with a hidden category axis of its own
        (groups.some((g) => g.y2)
          ? axisXml("cat", 500000003, 500000004, horizontal ? "r" : "b", {}, false).replace('<c:delete val="0"/>', '<c:delete val="1"/>') +
            axisXml("val", 500000004, 500000003, horizontal ? "t" : "r", { grid: false }, true).replace('<c:crosses val="autoZero"/>', '<c:crosses val="max"/>')
          : "");
  const legend = c.showLegend === false ? "" : `<c:legend><c:legendPos val="${c.legendPos || "b"}"/><c:overlay val="0"/></c:legend>`;
  return (
    HEAD +
    `<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<c:chart>${c.title ? richTitle(c.title) + '<c:autoTitleDeleted val="0"/>' : '<c:autoTitleDeleted val="1"/>'}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${fill("FFFFFF")}<a:ln><a:noFill/></a:ln></c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    (opts.embedded ? `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>` : "") +
    `</c:chartSpace>`
  );
}

/** A small workbook holding the chart's data (Sheet1), embedded so Word's Edit Data opens it. */
export async function chartWorkbook(c: ChartData): Promise<Uint8Array> {
  const rows = chartTable(c);
  const zip = new JSZip();
  const cell = (v: string | number | null, r: number, k: number) => {
    const ref = `${colName(k)}${r + 1}`;
    if (v === null || v === "") return "";
    return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, k) => cell(v, r, k)).join("")}</row>`).join("");
  zip.file("[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file("_rels/.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `${HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function cachePoints(el: XEl | undefined): string[] {
  const cache = descendants(el, "strCache")[0] || descendants(el, "numCache")[0] || descendants(el, "strLit")[0] || descendants(el, "numLit")[0];
  if (!cache) return [];
  const count = Number(attr(child(cache, "ptCount"), "val")) || 0;
  const out: string[] = Array.from({ length: count }, () => "");
  for (const p of kids(cache, "pt")) {
    const i = Number(attr(p, "idx"));
    if (Number.isInteger(i) && i >= 0 && i < 10000) out[i] = child(p, "v")?.text ?? "";
  }
  // multi-level categories: the innermost level
  if (!count) {
    const lvl = descendants(el, "lvl")[0];
    if (lvl) return kids(lvl, "pt").map((p) => child(p, "v")?.text ?? "");
  }
  return out;
}

const PLOTS: Record<string, ChartData["chartType"]> = {
  barChart: "bar", bar3DChart: "bar", lineChart: "line", line3DChart: "line", stockChart: "line", radarChart: "line",
  areaChart: "area", area3DChart: "area", pieChart: "pie", pie3DChart: "pie", ofPieChart: "pie",
  doughnutChart: "doughnut", scatterChart: "scatter", bubbleChart: "scatter",
};

/** A chart part's chart, or null when it has no plot we draw. `warnings` collects what was simplified. */
export function readChartSpace(xml: string, warnings?: Set<string>): ChartData | null {
  let root: XEl;
  try {
    root = parseXml(xml);
  } catch {
    return null;
  }
  const chart = child(root, "chart");
  const plotArea = child(chart, "plotArea");
  const plots = kids(plotArea).filter((k) => PLOTS[k.local]);
  const plot = plots[0];
  if (!plot) return null;
  const chartType = PLOTS[plot.local];
  const scatter = chartType === "scatter";
  // a combo chart (bar, line and area plots): every series keeps its own type, and the plots on a second pair of axes are on the secondary axis
  const comboable = (t: string) => t === "bar" || t === "line" || t === "area";
  const combo = plots.length > 1 && plots.every((p) => comboable(PLOTS[p.local]));
  if (plots.length > 1 && !combo) warnings?.add("Combination charts with pie or scatter parts were opened with their first chart type only.");
  const primaryAxes = kids(plot, "axId").map((a) => attr(a, "val")).join(",");
  const owned = (combo ? plots : [plot]).flatMap((p) => kids(p, "ser").map((ser) => ({ ser, type: PLOTS[p.local], y2: kids(p, "axId").map((a) => attr(a, "val")).join(",") !== primaryAxes })));
  // in the order the chart gives its series
  const ord = (x: XEl) => Number(attr(child(x, "order"), "val") ?? attr(child(x, "idx"), "val") ?? 0);
  if (combo) owned.sort((x, y) => ord(x.ser) - ord(y.ser));
  const sers = owned.map((o) => o.ser);
  const categories = sers.map((s) => cachePoints(child(s, scatter ? "xVal" : "cat"))).find((v) => v.length) || [];
  const series = sers.map((s, i) => {
    const raw = cachePoints(child(s, scatter ? "yVal" : "val"));
    const tx = child(s, "tx");
    const name = child(tx, "v")?.text || cachePoints(tx)[0] || `Series ${i + 1}`;
    const clr = attr(descendants(child(s, "spPr"), "srgbClr")[0], "val");
    const trend = readTrend(s);
    const own = owned[i];
    return {
      name,
      values: raw.map((v) => Number(v) || 0),
      ...(clr && chartType !== "pie" && chartType !== "doughnut" ? { color: clr.toUpperCase() } : {}),
      ...(trend ? { trend } : {}),
      ...(combo && own.type !== chartType ? { type: own.type as "bar" | "line" | "area" } : {}),
      ...(combo && own.y2 ? { y2: true } : {}),
    };
  });
  const titleEl = child(chart, "title");
  const title = descendants(titleEl, "t").map((t) => t.text).join("") || cachePoints(titleEl)[0] || undefined;
  const legend = child(chart, "legend");
  const pos = attr(child(legend, "legendPos"), "val") || "r";
  const grouping = attr(child(plot, "grouping"), "val") || "";
  const labels = child(plot, "dLbls") || descendants(plot, "dLbls")[0];
  const round = chartType === "pie" || chartType === "doughnut";
  return {
    chartType,
    ...(title ? { title } : {}),
    categories: categories.length ? categories : (series[0]?.values || []).map((_, i) => String(i + 1)),
    series,
    showLegend: !!legend,
    ...(legend ? { legendPos: (pos === "tr" ? "r" : ["b", "t", "r", "l"].includes(pos) ? pos : "r") as ChartData["legendPos"] } : {}),
    ...(chartType === "bar" && attr(child(plot, "barDir"), "val") === "bar" ? { barDir: "bar" as const } : {}),
    ...(/stacked/i.test(grouping) ? { stacked: true } : {}),
    ...(labels && attr(child(labels, "showVal"), "val") === "1" ? { dataLabels: true } : {}),
    ...(round ? {} : readAxes(plotArea, scatter)),
  };
}

// ------------------------------------------------------------------ SmartArt

// the layout definitions Slides writes (full layout nodes, algorithms and constraints, so Word can lay the graphic out again when it is edited)
const LAYOUT_CAT: Record<DiagramKind, string> = { process: "process", cycle: "cycle", hierarchy: "hierarchy", list: "list", pyramid: "pyramid" };
const OA = "urn:microsoft.com/office/officeart/2005/8";

/** The SmartArt family of a layout definition id (".../layout/process1", "cycle2", "orgChart1"...). */
export function diagramKindOf(uniqueId: string): DiagramKind {
  const id = uniqueId.toLowerCase().split("/").pop() || "";
  if (/cycle|radial|gear|circle/.test(id)) return "cycle";
  if (/hierarchy|orgchart|tree/.test(id)) return "hierarchy";
  if (/pyramid|funnel/.test(id)) return "pyramid";
  if (/process|chevron|arrow|timeline|step/.test(id)) return "process";
  return "list";
}

let guidN = 0;
function guid(seed: number): string {
  const h = (n: number, len: number) => ((n >>> 0) % 16 ** len).toString(16).toUpperCase().padStart(len, "0");
  const a = (seed * 2654435761) >>> 0;
  const b = ((guidN++ + 1) * 40503) >>> 0;
  return `{${h(a, 8)}-${h(b, 4)}-4${h(a ^ b, 3)}-A${h(seed, 3)}-${h(a, 6)}${h(b, 6)}}`;
}

type Shape = { shape: string; x: number; y: number; w: number; h: number; fill?: string | null; line?: string | null; lineW?: number; rot?: number; html?: string; valign?: string; geom?: { w: number; h: number; d: string } };
type TextRun = { text: string; color: string; pt: number; level: number; align: "ctr" | "l" };

/** The text of a laid-out shape: one paragraph per item, sub-items as bullets one level down. */
export function shapeParagraphs(html: string | undefined): TextRun[] {
  if (!html) return [];
  const out: TextRun[] = [];
  let depth = 0;
  const re = /<(\/?)(ul|li|p)([^>]*)>|<span style="color: #([0-9a-f]{6}); font-size: (\d+)pt">([^<]*)<\/span>/gi;
  let align: "ctr" | "l" = "ctr";
  for (const m of html.matchAll(re)) {
    if (m[2]) {
      if (m[2].toLowerCase() === "ul") depth += m[1] ? -1 : 1;
      if (m[2].toLowerCase() === "p" && !m[1]) align = /text-align: left/.test(m[3]) ? "l" : "ctr";
      continue;
    }
    const text = m[6].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    if (text) out.push({ text, color: m[4].toUpperCase(), pt: Number(m[5]), level: depth, align: depth ? "l" : align });
  }
  return out;
}

/** The shapes of a diagram laid out in a w × h box (px). */
export function diagramShapes(d: DiagramData, w: number, h: number): Shape[] {
  return buildDiagram(d.kind, d.items, { x: 0, y: 0, w, h }, d.accent || "4472C4", "g") as unknown as Shape[];
}

/** SVG path commands (M, L, Z with absolute numbers) to DrawingML path elements. */
function pathXml(d: string, sx: number, sy: number): string {
  const out: string[] = [];
  for (const m of d.matchAll(/([MLZ])\s*([-\d.]+)?[\s,]*([-\d.]+)?/gi)) {
    const c = m[1].toUpperCase();
    if (c === "Z") out.push("<a:close/>");
    else out.push(`<a:${c === "M" ? "moveTo" : "lnTo"}><a:pt x="${Math.round(Number(m[2]) * sx)}" y="${Math.round(Number(m[3]) * sy)}"/></a:${c === "M" ? "moveTo" : "lnTo"}>`);
  }
  return out.join("");
}

/** The parts of a SmartArt graphic: data model, layout, quick style, colours and the drawing Word shows. `drawingRel` is the document's relationship id for the drawing. */
export function diagramParts(d: DiagramData, wPx: number, hPx: number, drawingRel: string): { data: string; layout: string; style: string; colors: string; drawing: string } {
  guidN = 0;
  const items = d.items.length ? d.items : [{ text: "Text", level: 0 }];
  const docId = guid(1);
  const pts: string[] = [];
  const cxns: string[] = [];
  const text = (t: string) => `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(t)}</a:t></a:r></a:p></dgm:t>`;
  const emptyT = `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></dgm:t>`;
  pts.push(`<dgm:pt modelId="${docId}" type="doc"><dgm:prSet loTypeId="${LAYOUT_ID[d.kind]}" loCatId="${LAYOUT_CAT[d.kind]}" qsTypeId="${OA}/quickstyle/simple1" qsCatId="simple" csTypeId="${OA}/colors/accent1_2" csCatId="accent1" phldr="0"/><dgm:spPr/>${emptyT}</dgm:pt>`);
  const stack: { id: string; level: number; kids: number }[] = [{ id: docId, level: -1, kids: 0 }];
  items.forEach((it, i) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
    const parent = stack[stack.length - 1];
    const id = guid(100 + i);
    const cx = guid(1000 + i);
    const par = guid(2000 + i);
    const sib = guid(3000 + i);
    pts.push(`<dgm:pt modelId="${id}"><dgm:prSet phldrT="[Text]"/><dgm:spPr/>${text(it.text)}</dgm:pt>`);
    pts.push(`<dgm:pt modelId="${par}" type="parTrans" cxnId="${cx}"><dgm:prSet/><dgm:spPr/>${emptyT}</dgm:pt>`);
    pts.push(`<dgm:pt modelId="${sib}" type="sibTrans" cxnId="${cx}"><dgm:prSet/><dgm:spPr/>${emptyT}</dgm:pt>`);
    cxns.push(`<dgm:cxn modelId="${cx}" srcId="${parent.id}" destId="${id}" srcOrd="${parent.kids++}" destOrd="0" parTransId="${par}" sibTransId="${sib}"/>`);
    stack.push({ id, level: it.level, kids: 0 });
  });
  const data =
    HEAD +
    `<dgm:dataModel xmlns:dgm="${DIAGRAM_NS}" xmlns:a="${A_NS}"><dgm:ptLst>${pts.join("")}</dgm:ptLst><dgm:cxnLst>${cxns.join("")}</dgm:cxnLst><dgm:bg/><dgm:whole/>` +
    `<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${DSP_NS}" relId="${drawingRel}" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext>` +
    `<a:ext uri="urn:synergy:smartart"><syn:accent xmlns:syn="urn:synergy:smartart" val="${esc(d.accent || "4472C4")}"/></a:ext></dgm:extLst></dgm:dataModel>`;
  const layout = layoutDefXml(d.kind);
  const style = styleDefXml();
  const colors = colorsDefXml();
  // the drawing: the laid-out shapes in EMUs
  const shapes = diagramShapes({ ...d, items }, wPx, hPx);
  const E = (v: number) => Math.round(v * EMU_PX);
  const sps = shapes
    .map((s, i) => {
      const xfrm = `<a:xfrm${s.rot ? ` rot="${Math.round(s.rot * 60000)}"` : ""}><a:off x="${E(s.x)}" y="${E(s.y)}"/><a:ext cx="${E(s.w)}" cy="${E(s.h)}"/></a:xfrm>`;
      const geom =
        s.shape === "freeform" && s.geom
          ? `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${E(s.w)}" h="${E(s.h)}">${pathXml(s.geom.d, E(s.w) / Math.max(1, s.geom.w), E(s.h) / Math.max(1, s.geom.h))}</a:path></a:pathLst></a:custGeom>`
          : `<a:prstGeom prst="${s.shape}"><a:avLst/></a:prstGeom>`;
      const fillXml = s.fill ? fill(s.fill.toUpperCase()) : "<a:noFill/>";
      const ln = s.line ? `<a:ln w="${Math.round((s.lineW || 1) * 12700)}">${fill(s.line.toUpperCase())}</a:ln>` : "<a:ln><a:noFill/></a:ln>";
      const paras = shapeParagraphs(s.html);
      const anchor = s.valign === "bottom" ? "b" : s.valign === "top" ? "t" : "ctr";
      const body = paras.length
        ? `<dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="45720" tIns="45720" rIns="45720" bIns="45720" numCol="1" spcCol="1270" anchor="${anchor}" anchorCtr="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras
            .map((p) => `<a:p><a:pPr marL="${p.level ? p.level * 114300 : 0}" lvl="${p.level}" indent="${p.level ? -114300 : 0}" algn="${p.align}" defTabSz="711200">${p.level ? '<a:buChar char="•"/>' : '<a:buNone/>'}</a:pPr><a:r><a:rPr lang="en-US" sz="${p.pt * 100}" kern="1200"><a:solidFill><a:srgbClr val="${p.color}"/></a:solidFill></a:rPr><a:t>${esc(p.text)}</a:t></a:r></a:p>`)
            .join("")}</dsp:txBody><dsp:txXfrm><a:off x="${E(s.x)}" y="${E(s.y)}"/><a:ext cx="${E(s.w)}" cy="${E(s.h)}"/></dsp:txXfrm>`
        : "";
      return `<dsp:sp modelId="${guid(5000 + i)}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>${xfrm}${geom}${fillXml}${ln}</dsp:spPr><dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style>${body}</dsp:sp>`;
    })
    .join("");
  const drawing = `${HEAD}<dsp:drawing xmlns:dgm="${DIAGRAM_NS}" xmlns:dsp="${DSP_NS}" xmlns:a="${A_NS}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${sps}</dsp:spTree></dsp:drawing>`;
  return { data, layout, style, colors, drawing };
}

/** A SmartArt graphic's kind, outline and colour from its data model and layout definition. */
export function readDiagram(dataXml: string, layoutXml?: string): DiagramData | null {
  let dm: XEl;
  try {
    dm = parseXml(dataXml);
  } catch {
    return null;
  }
  const pts = descendants(dm, "pt");
  const text = new Map<string, string>();
  let doc: string | undefined;
  let layoutId = "";
  for (const p of pts) {
    const id = attr(p, "modelId") || "";
    const type = attr(p, "type") || "node";
    if (type === "doc") {
      doc = id;
      layoutId = attr(child(p, "prSet"), "loTypeId") || "";
    }
    if (type !== "node" && type !== "doc") continue;
    text.set(id, kids(child(p, "t"), "p").map((pp) => descendants(pp, "t").map((x) => x.text).join("")).filter(Boolean).join(" "));
  }
  if (layoutXml) {
    try {
      layoutId = attr(parseXml(layoutXml), "uniqueId") || layoutId;
    } catch {
      /* keep the data model's id */
    }
  }
  const kidsOf = new Map<string, { id: string; ord: number }[]>();
  for (const c of descendants(dm, "cxn")) {
    if ((attr(c, "type") || "parOf") !== "parOf") continue;
    const src = attr(c, "srcId") || "";
    const dst = attr(c, "destId") || "";
    if (!text.has(dst)) continue;
    kidsOf.set(src, [...(kidsOf.get(src) || []), { id: dst, ord: Number(attr(c, "srcOrd")) || 0 }]);
  }
  const items: OutlineItem[] = [];
  const seen = new Set<string>();
  const walk = (id: string, level: number) => {
    for (const k of (kidsOf.get(id) || []).sort((a, b) => a.ord - b.ord)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const t = text.get(k.id) || "";
      if (t) items.push({ text: t, level });
      walk(k.id, t ? level + 1 : level);
    }
  };
  if (doc) walk(doc, 0);
  const accent = attr(descendants(dm, "accent")[0], "val") || "4472C4";
  return { kind: diagramKindOf(layoutId), items, accent };
}

/** Outline text (one item a line, two spaces a level) and back. */
export const outlineText = (items: OutlineItem[]) => items.map((i) => `${"  ".repeat(i.level)}${i.text}`).join("\n");
export { parseOutline };

// ------------------------------------------------------------------ drawing on screen

const svgEsc = esc;
/** SVG of a diagram at w × h px (for the editor, print and PDF). */
export function diagramSvg(d: DiagramData, w: number, h: number): string {
  const shapes = diagramShapes(d, w, h);
  const els = shapes.map((s) => {
    const fillA = s.fill ? `#${s.fill}` : "none";
    const stroke = s.line ? `stroke="#${s.line}" stroke-width="${s.lineW || 1}"` : "";
    const rot = s.rot ? ` transform="rotate(${s.rot} ${s.x + s.w / 2} ${s.y + s.h / 2})"` : "";
    let shape: string;
    if (s.shape === "ellipse") shape = `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" fill="${fillA}" ${stroke}/>`;
    else if (s.shape === "roundRect" || s.shape === "rect") {
      const r = s.shape === "roundRect" ? Math.min(s.w, s.h) * 0.16667 : 0;
      shape = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${r}" fill="${fillA}" ${stroke}/>`;
    } else if (s.shape === "rightArrow") {
      const { x, y, w: aw, h: ah } = s;
      const head = Math.min(aw, ah) * 0.5;
      shape = `<polygon points="${x},${y + ah * 0.25} ${x + aw - head},${y + ah * 0.25} ${x + aw - head},${y} ${x + aw},${y + ah / 2} ${x + aw - head},${y + ah} ${x + aw - head},${y + ah * 0.75} ${x},${y + ah * 0.75}" fill="${fillA}" ${stroke}/>`;
    } else if (s.shape === "freeform" && s.geom) shape = `<path d="${s.geom.d}" transform="translate(${s.x} ${s.y}) scale(${s.w / Math.max(1, s.geom.w)} ${s.h / Math.max(1, s.geom.h)})" fill="${fillA}" ${stroke} vector-effect="non-scaling-stroke"/>`;
    else shape = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fillA}" ${stroke}/>`;
    const paras = shapeParagraphs(s.html);
    let text = "";
    if (paras.length) {
      const lh = (p: TextRun) => p.pt * 1.25 * (4 / 3);
      const total = paras.reduce((sum, p) => sum + lh(p), 0);
      let y = s.valign === "bottom" ? s.y + s.h - total - 6 : s.y + (s.h - total) / 2;
      text = paras
        .map((p) => {
          y += lh(p);
          const left = p.align === "l";
          const x = left ? s.x + 8 + p.level * 12 : s.x + s.w / 2;
          return `<text x="${x}" y="${y - lh(p) * 0.25}" font-size="${p.pt}pt" fill="#${p.color}" text-anchor="${left ? "start" : "middle"}">${p.level ? "• " : ""}${svgEsc(p.text)}</text>`;
        })
        .join("");
    }
    return `<g${rot}>${shape}${text}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Calibri, Carlito, sans-serif">${els.join("")}</svg>`;
}
