// Chart axis formatting (bounds, units, number formats, gridlines, titles) and
// trendlines: the maths, and the .pptx round trip.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { axisScale, fitTrend, formatNumber } from "../lib/slides/chart";
import type { ChartEl, Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

test("Excel number formats", () => {
  const cases: [number, string | undefined, string][] = [
    [1234.567, undefined, "1234.57"],
    [1234.567, "General", "1234.57"],
    [1234.567, "0", "1235"],
    [1234.5, "#,##0.00", "1,234.50"],
    [-1234.5, "#,##0", "-1,235"],
    [0.125, "0%", "13%"],
    [0.125, "0.0%", "12.5%"],
    [1234, "$#,##0", "$1,234"],
    [1234, "[$€-407]#,##0.00", "€1,234.00"],
    [1234, '0.0"k"', "1234.0k"],
    [12500, "#,##0,", "13"],
    [12345, "0.00E+00", "1.23E+04"],
    [0.5, "#.##", ".5"],
    [-5, '0;"("0")"', "(5)"],
    [3, "0.0#", "3.0"],
  ];
  for (const [v, code, want] of cases) assert.equal(formatNumber(v, code), want, `${v} ${code}`);
});

test("axis scales: automatic nice steps, fixed bounds and units, minor ticks", () => {
  assert.deepEqual(axisScale(0, 23).ticks, [0, 5, 10, 15, 20, 25]);
  const fixed = axisScale(0, 23, { min: 10, max: 40, major: 10 });
  assert.deepEqual([fixed.lo, fixed.hi, fixed.ticks], [10, 40, [10, 20, 30, 40]]);
  const m = axisScale(0, 10, { major: 5, minorGrid: true, minor: 1 });
  assert.equal(m.minor.length, 11);
  assert.ok(axisScale(0, 1e6, { major: 1 }).ticks.length <= 201, "a tiny unit is capped");
});

test("trendlines fit the data", () => {
  const xs = [1, 2, 3, 4, 5];
  const lin = fitTrend(xs, xs.map((x) => 2 * x + 1), { type: "linear" })!;
  assert.equal(lin.eq, "y = 2x + 1");
  assert.ok(Math.abs(lin.r2! - 1) < 1e-9);
  const poly = fitTrend(xs, xs.map((x) => x * x - 3), { type: "poly", order: 2 })!;
  assert.equal(poly.eq, "y = 1x² − 3");
  assert.ok(Math.abs(poly.f!(6) - 33) < 1e-6);
  const ex = fitTrend(xs, xs.map((x) => 3 * Math.exp(0.5 * x)), { type: "exp" })!;
  assert.equal(ex.eq, "y = 3e^(0.5x)");
  assert.ok(Math.abs(fitTrend(xs, xs.map((x) => 2 * x ** 1.5), { type: "power" })!.f!(9) - 54) < 1e-6);
  assert.ok(Math.abs(fitTrend(xs, xs.map((x) => 1 + 2 * Math.log(x)), { type: "log" })!.f!(10) - (1 + 2 * Math.log(10))) < 1e-9);
  assert.deepEqual(fitTrend(xs, [2, 4, 6, 8, 10], { type: "movingAvg", period: 3 })!.points, [[3, 4], [4, 6], [5, 8]]);
  assert.equal(fitTrend(xs, [1, -1, 2, 3, 4], { type: "exp" }), null, "exponential needs positive values");
});

test("axis formatting and trendlines round-trip through .pptx", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const bar: ChartEl = {
    id: "c1", z: 1, type: "chart", chartType: "bar", x: 40, y: 40, w: 560, h: 400,
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [{ name: "North", values: [10, 25, 35, 52], trend: { type: "poly", order: 2, eq: true, r2: true } }, { name: "South", values: [5, 8, 9, 12] }],
    valAx: { min: 0, max: 60, major: 20, minor: 5, fmt: "$#,##0", minorGrid: true, title: "Revenue" },
    catAx: { grid: true, title: "Quarter" },
  };
  const sc: ChartEl = {
    id: "c2", z: 2, type: "chart", chartType: "scatter", x: 640, y: 40, w: 560, h: 400,
    categories: ["1", "2", "4", "8"],
    series: [{ name: "Y", values: [3, 5, 9, 17], trend: { type: "linear", r2: true } }],
    valAx: { grid: false, fmt: "0.0" },
    catAx: { min: 0, max: 10, major: 2, fmt: "0", title: "Dose" },
  };
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [bar, sc] };
  const out = await buildPptx([s], { name: "c", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(out);
  const parts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort();
  const xmls = await Promise.all(parts.map((f) => zip.file(f)!.async("string")));
  const barXml = xmls.find((x) => x.includes("<c:barChart>"))!;
  assert.match(barXml, /<c:trendline><c:spPr>[\s\S]*<c:trendlineType val="poly"\/><c:order val="2"\/><c:dispRSqr val="1"\/><c:dispEq val="1"\/>/);
  assert.match(barXml, /<\/c:majorGridlines><c:minorGridlines>/);
  assert.match(barXml, /<c:majorUnit val="20"\/><c:minorUnit val="5"\/>/);
  assert.match(barXml, /<c:catAx>[\s\S]*<c:majorGridlines>[\s\S]*<\/c:catAx>/);
  const deck = await importPptx(out);
  const [b2, s2] = deck.slides[0].elements as ChartEl[];
  assert.deepEqual(b2.valAx, bar.valAx);
  assert.deepEqual(b2.catAx, bar.catAx);
  assert.deepEqual(b2.series.map((x) => x.trend), [bar.series[0].trend, undefined]);
  assert.deepEqual(s2.valAx, sc.valAx);
  assert.deepEqual(s2.catAx, sc.catAx);
  assert.deepEqual(s2.series[0].trend, { type: "linear", r2: true });
});

test("combo charts keep every series' type and axis; 100% stacked charts round-trip (.pptx and .odp)", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const combo: ChartEl = {
    id: "c1", z: 1, type: "chart", x: 40, y: 40, w: 600, h: 400, chartType: "bar", categories: ["Q1", "Q2", "Q3"],
    series: [
      { name: "Sales", values: [10, 20, 30] },
      { name: "Costs", values: [5, 8, 12] },
      { name: "Margin %", values: [0.5, 0.6, 0.6], type: "line", y2: true, trend: { type: "linear" } },
    ],
  };
  const pct: ChartEl = { id: "c2", z: 2, type: "chart", x: 40, y: 460, w: 600, h: 200, chartType: "area", stacked: true, percent: true, categories: ["a", "b"], series: [{ name: "x", values: [1, 3] }, { name: "y", values: [3, 1] }] };
  const pctBar: ChartEl = { ...pct, id: "c3", chartType: "bar" };
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [combo, pct, pctBar] };
  const out = await buildPptx([s], { name: "c", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(out);
  const parts = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort().map((f) => zip.file(f)!.async("string")));
  const comboXml = parts.find((x) => x.includes("<c:lineChart>") && x.includes("<c:barChart>"))!;
  assert.ok(comboXml, "the combo chart has a bar group and a line group");
  assert.equal((comboXml.match(/<c:valAx>/g) || []).length, 2); // the secondary value axis
  assert.match(comboXml, /<c:lineChart>[\s\S]*<c:trendline>/); // the trendline lands on its series
  const areaXml = parts.find((x) => x.includes("<c:areaChart>"))!;
  assert.match(areaXml, /<c:areaChart><c:grouping val="percentStacked"\/>/);
  const barXml = parts.find((x) => x.includes("<c:barChart>") && !x.includes("<c:lineChart>"))!;
  assert.match(barXml, /<c:grouping val="percentStacked"\/>/);
  assert.match(barXml, /<c:overlap val="100"\/>/);
  const back = (await importPptx(out)).slides[0].elements as ChartEl[];
  const c = back.find((e) => e.series.length === 3)!;
  assert.equal(c.chartType, "bar");
  assert.deepEqual(c.series.map((x) => [x.name, x.type, x.y2, x.trend?.type]), [["Sales", undefined, undefined, undefined], ["Costs", undefined, undefined, undefined], ["Margin %", "line", true, "linear"]]);
  const area = back.find((e) => e.chartType === "area")!;
  assert.equal(area.stacked, true);
  assert.equal(area.percent, true);
  assert.equal(back.find((e) => e.chartType === "bar" && e.series.length === 2)!.percent, true);
  // .odp
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const odp = await importOdp((await buildOdp([s], { name: "c", w: 1280, h: 720, theme: "plain" })).data);
  const oc = odp.slides[0].elements.filter((e): e is ChartEl => e.type === "chart");
  assert.deepEqual(oc[0].series.map((x) => [x.type, x.y2]), [[undefined, undefined], [undefined, undefined], ["line", true]]);
  assert.equal(oc[1].percent, true);
});
