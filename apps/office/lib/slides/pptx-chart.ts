// Chart parts after PptxGenJS: minor gridlines and units (which it cannot
// write) and trendlines go into each chart's XML; the importer reads axis
// formatting and trendlines back with readAxes/readTrend.
import type JSZip from "jszip";
import { CHART_COLORS, isCombo, seriesType, type ChartAxis, type ChartEl, type Trendline } from "./model";
import { attr, child, descendants, kids, type XEl } from "./xml";
import { isTrendType } from "./chart";

const relTarget = (rels: string, rid: string) => new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] || new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];

/** ppt/charts/chartN.xml for the chart graphic frame named `syn-el-<id>` on a slide. */
export async function chartPartFor(zip: JSZip, slidePath: string, slideXml: string, id: string): Promise<string | undefined> {
  const at = slideXml.indexOf(`name="syn-el-${id}"`);
  if (at < 0) return undefined;
  const end = slideXml.indexOf("</p:graphicFrame>", at);
  const rid = /<c:chart [^>]*r:id="([^"]+)"/.exec(slideXml.slice(at, end))?.[1];
  if (!rid) return undefined;
  const relsPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
  const rels = await zip.file(relsPath)?.async("string");
  const target = rels && relTarget(rels, rid);
  if (!target) return undefined;
  return target.startsWith("/") ? target.slice(1) : `ppt/${target.replace(/^\.\.\//, "")}`;
}

export function trendlineXml(t: Trendline, color: string): string {
  const type = t.type;
  return [
    "<c:trendline>",
    t.name ? `<c:name>${t.name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:name>` : "",
    `<c:spPr><a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="sysDash"/></a:ln></c:spPr>`,
    `<c:trendlineType val="${type}"/>`,
    type === "poly" ? `<c:order val="${Math.max(2, Math.min(6, Math.round(t.order || 2)))}"/>` : "",
    type === "movingAvg" ? `<c:period val="${Math.max(2, Math.min(255, Math.round(t.period || 2)))}"/>` : "",
    `<c:dispRSqr val="${t.r2 && type !== "movingAvg" ? 1 : 0}"/><c:dispEq val="${t.eq && type !== "movingAvg" ? 1 : 0}"/>`,
    t.r2 || t.eq ? '<c:trendlineLbl><c:numFmt formatCode="General" sourceLinked="0"/></c:trendlineLbl>' : "",
    "</c:trendline>",
  ].join("");
}

/** The value axis element of a chart: the Y axis of a scatter chart (the valAx not along the bottom), else the first valAx. */
function valAxisRange(xml: string, scatter: boolean): [number, number] | undefined {
  const all = [...xml.matchAll(/<c:valAx>[\s\S]*?<\/c:valAx>/g)];
  const pick = scatter ? all.find((m) => !/<c:axPos val="[bt]"\/>/.test(m[0])) || all[all.length - 1] : all[0];
  return pick ? [pick.index!, pick.index! + pick[0].length] : undefined;
}

/** Add minor gridlines/units and trendlines to a chart part PptxGenJS wrote. */
/** A combo chart's groups: each chart type (and axis) with its series, in the order they first appear. */
export function comboGroups(el: ChartEl): { type: "bar" | "line" | "area"; y2: boolean; idx: number[] }[] {
  const out: { type: "bar" | "line" | "area"; y2: boolean; idx: number[] }[] = [];
  el.series.forEach((s, i) => {
    const type = seriesType(el, s) as "bar" | "line" | "area";
    const y2 = !!s.y2;
    const g = out.find((x) => x.type === type && x.y2 === y2);
    if (g) g.idx.push(i);
    else out.push({ type, y2, idx: [i] });
  });
  // the primary axis's groups first
  return [...out.filter((g) => !g.y2), ...out.filter((g) => g.y2)];
}

/** Our series index of each <c:ser> in the chart part, in document order. */
export function serOrder(el: ChartEl): number[] {
  return el.chartType !== "scatter" && el.chartType !== "pie" && el.chartType !== "doughnut" && isCombo(el) ? comboGroups(el).flatMap((g) => g.idx) : el.series.map((_, i) => i);
}

/**
 * Stacking as the chart says: line and area groups get the c:grouping that
 * PptxGenJS leaves out (stacked or percentStacked), bars stacked to 100%
 * overlap fully.
 */
export function patchGrouping(xml: string, el: ChartEl): string {
  if (!el.stacked) return xml;
  const want = el.percent ? "percentStacked" : "stacked";
  const combo = isCombo(el);
  return xml.replace(/<c:(lineChart|areaChart|barChart)>([\s\S]*?)<\/c:\1>/g, (all, tag: string, body: string) => {
    const type = tag === "barChart" ? "bar" : tag === "lineChart" ? "line" : "area";
    // in a combo, the stacking belongs to the chart's own type
    if (combo && type !== el.chartType) return all;
    let b = body.replace(/<c:grouping val="[^"]*"\/>/, "");
    b = tag === "barChart" ? b.replace(/(<c:barDir [^>]*\/>)/, `$1<c:grouping val="${want}"/>`) : `<c:grouping val="${want}"/>${b}`;
    if (tag === "barChart") b = b.replace(/<c:overlap val="[^"]*"\/>/, '<c:overlap val="100"/>');
    return `<c:${tag}>${b}</c:${tag}>`;
  });
}

export function patchChartXml(xml: string, el: ChartEl): string {
  xml = patchGrouping(xml, el);
  const scatter = el.chartType === "scatter";
  const val = el.valAx || {};
  const r = valAxisRange(xml, scatter);
  if (r && (val.minorGrid || val.minor)) {
    let ax = xml.slice(r[0], r[1]);
    if (val.minorGrid) {
      const minor = '<c:minorGridlines><c:spPr><a:ln w="3175"><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></a:ln></c:spPr></c:minorGridlines>';
      ax = ax.includes("</c:majorGridlines>") ? ax.replace("</c:majorGridlines>", `</c:majorGridlines>${minor}`) : ax.replace(/(<c:axPos [^>]*\/>)/, `$1${minor}`);
    }
    if (val.minor && val.minor > 0) {
      const mu = `<c:minorUnit val="${val.minor}"/>`;
      ax = /<c:majorUnit [^>]*\/>/.test(ax) ? ax.replace(/(<c:majorUnit [^>]*\/>)/, `$1${mu}`) : ax.replace(/(<c:dispUnits>|<c:extLst>|<\/c:valAx>)/, `${mu}$1`);
    }
    xml = xml.slice(0, r[0]) + ax + xml.slice(r[1]);
  }
  if (scatter && (el.catAx?.fmt || el.valAx?.fmt)) {
    // PptxGenJS gives a scatter chart's X axis the value axis's format, marked as linked to the source
    const code = (el.catAx?.fmt || "General").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    xml = xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, (ax) => (/<c:axPos val="[bt]"\/>/.test(ax) ? ax.replace(/<c:numFmt [^>]*\/>/, `<c:numFmt formatCode="${code}" sourceLinked="0"/>`) : ax));
  }
  if (el.chartType !== "pie" && el.chartType !== "doughnut" && el.series.some((s) => s.trend)) {
    let n = -1;
    const order = serOrder(el);
    // scatter: PptxGenJS writes the X values as series 0 of its data, so <c:ser> k is our series k
    xml = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
      const k = order[++n] ?? n;
      const s = el.series[k];
      if (!s?.trend || ser.includes("<c:trendline>")) return ser;
      const color = /^[0-9a-f]{6}$/i.test(s.color || "") ? s.color!.toUpperCase() : CHART_COLORS[k % CHART_COLORS.length];
      const at = ser.search(/<c:errBars>|<c:cat>|<c:val>|<c:xVal>|<c:yVal>|<c:smooth |<\/c:ser>/);
      return ser.slice(0, at) + trendlineXml(s.trend, color) + ser.slice(at);
    });
  }
  return xml;
}

/** Patch every chart on a slide (charts without axis extras or trendlines are left alone). */
export async function patchSlideCharts(zip: JSZip, slidePath: string, slideXml: string, charts: ChartEl[]) {
  for (const el of charts) {
    if (!el.valAx?.minorGrid && !el.valAx?.minor && !el.series.some((s) => s.trend) && !(el.chartType === "scatter" && (el.catAx?.fmt || el.valAx?.fmt)) && !el.stacked) continue;
    const part = await chartPartFor(zip, slidePath, slideXml, el.id);
    const xml = part && (await zip.file(part)?.async("string"));
    if (part && xml) zip.file(part, patchChartXml(xml, el));
  }
}

/** PptxGenJS options for the axes. */
export function axisOptions(el: ChartEl, font: string | undefined): Record<string, unknown> {
  const v = el.valAx || {};
  const c = el.catAx || {};
  const o: Record<string, unknown> = {};
  if (v.min !== undefined) o.valAxisMinVal = v.min;
  if (v.max !== undefined) o.valAxisMaxVal = v.max;
  if (v.major) o.valAxisMajorUnit = v.major;
  if (v.fmt) o.valAxisLabelFormatCode = v.fmt;
  if (v.grid === false) o.valGridLine = { style: "none" };
  if (v.title) Object.assign(o, { showValAxisTitle: true, valAxisTitle: v.title, valAxisTitleFontSize: 12, ...(font ? { valAxisTitleFontFace: font } : {}) });
  o.catGridLine = c.grid ? { color: "D9D9D9", size: 1 } : { style: "none" };
  if (c.title) Object.assign(o, { showCatAxisTitle: true, catAxisTitle: c.title, catAxisTitleFontSize: 12, ...(font ? { catAxisTitleFontFace: font } : {}) });
  if (el.chartType === "scatter") {
    if (c.min !== undefined) o.catAxisMinVal = c.min;
    if (c.max !== undefined) o.catAxisMaxVal = c.max;
    if (c.major) o.catAxisMajorUnit = c.major;
    if (c.fmt) o.catAxisLabelFormatCode = c.fmt;
  }
  return o;
}

// ---- import ----

const numVal = (el: XEl | undefined) => {
  const v = Number(attr(el, "val"));
  return el && Number.isFinite(v) ? v : undefined;
};
const titleText = (t: XEl | undefined) => (t ? descendants(t, "t").map((x) => x.text).join("") || undefined : undefined);

function readAxis(ax: XEl | undefined, value: boolean): ChartAxis | undefined {
  if (!ax) return undefined;
  const sc = child(ax, "scaling");
  const fmtEl = child(ax, "numFmt");
  const code = attr(fmtEl, "formatCode");
  const out: ChartAxis = {
    min: numVal(child(sc, "min")),
    max: numVal(child(sc, "max")),
    major: numVal(child(ax, "majorUnit")),
    minor: numVal(child(ax, "minorUnit")),
    fmt: code && attr(fmtEl, "sourceLinked") !== "1" && !/^general$/i.test(code) ? code : undefined,
    // a value axis shows major gridlines unless they are off; a category axis only when on
    grid: value ? (child(ax, "majorGridlines") ? undefined : false) : child(ax, "majorGridlines") ? true : undefined,
    minorGrid: child(ax, "minorGridlines") ? true : undefined,
    title: titleText(child(ax, "title")),
  };
  const tidy = Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined)) as ChartAxis;
  return Object.keys(tidy).length ? tidy : undefined;
}

/** Axis formatting of an imported chart's plot area. */
export function readAxes(plot: XEl | undefined, scatter: boolean): { valAx?: ChartAxis; catAx?: ChartAxis } {
  const vals = kids(plot, "valAx");
  const horiz = (a: XEl) => /^[bt]$/.test(attr(child(a, "axPos"), "val") || "");
  let valEl: XEl | undefined, catEl: XEl | undefined;
  if (scatter) {
    catEl = vals.find(horiz) || vals[0];
    valEl = vals.find((a) => a !== catEl);
  } else {
    valEl = vals[0];
    catEl = kids(plot, "catAx")[0] || kids(plot, "dateAx")[0];
  }
  const valAx = readAxis(valEl, true);
  const catAx = readAxis(catEl, false);
  if (catAx && !scatter) {
    // bounds, units and formats of a category axis do not apply to our charts
    delete catAx.min; delete catAx.max; delete catAx.major; delete catAx.minor; delete catAx.fmt; delete catAx.minorGrid;
  }
  return { ...(valAx ? { valAx } : {}), ...(catAx && Object.keys(catAx).length ? { catAx } : {}) };
}

/** A series' first trendline. */
export function readTrend(ser: XEl): Trendline | undefined {
  const t = child(ser, "trendline");
  if (!t) return undefined;
  const type = attr(child(t, "trendlineType"), "val") || "linear";
  if (!isTrendType(type)) return undefined;
  const out: Trendline = { type };
  if (type === "poly") out.order = numVal(child(t, "order")) ?? 2;
  if (type === "movingAvg") out.period = numVal(child(t, "period")) ?? 2;
  if (attr(child(t, "dispEq"), "val") === "1") out.eq = true;
  if (attr(child(t, "dispRSqr"), "val") === "1") out.r2 = true;
  const name = child(t, "name")?.text;
  if (name) out.name = name;
  return out;
}
