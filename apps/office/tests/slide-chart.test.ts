import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartView } from "../components/slides/ChartView";
import type { ChartEl } from "../lib/slides/model";

const chart: ChartEl = {
  id: "chart1", z: 1, type: "chart", chartType: "bar", x: 0, y: 0, w: 500, h: 300,
  title: "Revenue", categories: ["Q1", "Q2"], series: [{ name: "North", values: [-5, 12] }], showLegend: true,
};

test("bar, line, and pie charts render data as accessible SVG", () => {
  const bar = renderToStaticMarkup(createElement(ChartView, { el: chart, font: "Arial" }));
  assert.match(bar, /role="img" aria-label="bar chart: Revenue"/);
  assert.match(bar, /North · Q1: -5/);
  assert.match(bar, /<rect[^>]+height="[1-9]/);

  const line = renderToStaticMarkup(createElement(ChartView, { el: { ...chart, chartType: "line" }, font: "Arial" }));
  assert.match(line, /<polyline[^>]+points="/);
  assert.match(line, /North · Q2: 12/);

  const pie = renderToStaticMarkup(createElement(ChartView, { el: { ...chart, chartType: "pie", series: [{ name: "Share", values: [25, 75] }] }, font: "Arial" }));
  assert.match(pie, /<path[^>]+fill="#4472C4"/);
  assert.match(pie, /Q2: 75/);
});

test("columns, stacked/horizontal bars, areas, doughnuts and scatter plots render", () => {
  const two = { ...chart, series: [{ name: "North", values: [5, 12] }, { name: "South", values: [3, 4] }] };
  const html = (el: ChartEl) => renderToStaticMarkup(createElement(ChartView, { el, font: "Arial" }));
  // stacked: the second series sits on top of the first, so one rect starts where the other ends
  const stacked = html({ ...two, stacked: true, dataLabels: true });
  assert.match(stacked, /South · Q2: 4/);
  assert.match(stacked, />12</);
  const horiz = html({ ...two, barDir: "bar" });
  const rect = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" fill="#4472C4"/.exec(horiz)!;
  assert.ok(Number(rect[2]) > Number(rect[3]), "horizontal bars are wider than tall");
  assert.match(html({ ...two, chartType: "area" }), /<polygon[^>]+points=/);
  const dough = html({ ...chart, chartType: "doughnut", series: [{ name: "Share", values: [25, 75] }] });
  assert.match(dough, /A [\d.]+ [\d.]+ 0 [01] 0 /); // inner arc drawn back
  const sc = html({ ...chart, chartType: "scatter", categories: ["1", "2.5", "4"], series: [{ name: "Y", values: [2, 3, 1] }], legendPos: "r" });
  assert.equal((sc.match(/<circle/g) || []).length, 3);
  assert.match(sc, /Y · 2.5: 3/);
});

test("chart kinds and options survive .pptx export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const base = { type: "chart" as const, x: 40, y: 40, w: 500, h: 300, categories: ["A", "B", "C"], series: [{ name: "S1", values: [1, 2, 3] }, { name: "S2", values: [4, 5, 6] }] };
  const charts: ChartEl[] = [
    { ...base, id: "c1", z: 1, chartType: "bar", barDir: "bar", stacked: true, dataLabels: true, legendPos: "r", title: "Bars" },
    { ...base, id: "c2", z: 2, chartType: "area", stacked: true, legendPos: "t" },
    { ...base, id: "c3", z: 3, chartType: "doughnut", series: [base.series[0]], showLegend: false },
    { ...base, id: "c4", z: 4, chartType: "scatter", categories: ["0.5", "1.5", "3"], series: [{ name: "Y", values: [2, 4, 1] }] },
    { ...base, id: "c5", z: 5, chartType: "line" },
  ];
  const slides = charts.map((c, i) => ({ id: `s${i}`, title: "", body: "", notes: "", layout: "blank" as const, bg: "", bgImg: "", elements: [c] }));
  const deck = await importPptx(await buildPptx(slides, { name: "t", w: 1280, h: 720, theme: "plain" }));
  const got = deck.slides.map((s) => s.elements[0] as ChartEl);
  assert.deepEqual(got.map((c) => c.id), charts.map((c) => c.id), "element ids ride on the chart names");
  assert.deepEqual(got.map((c) => c.chartType), ["bar", "area", "doughnut", "scatter", "line"]);
  assert.equal(got[0].barDir, "bar");
  assert.equal(got[0].stacked, true);
  assert.equal(got[0].dataLabels, true);
  assert.equal(got[0].legendPos, "r");
  assert.equal(got[0].title, "Bars");
  assert.equal(got[1].stacked, true);
  assert.equal(got[1].legendPos, "t");
  assert.equal(got[2].showLegend, false);
  assert.deepEqual(got[2].series.map((s) => s.values), [[1, 2, 3]]);
  assert.deepEqual(got[3].categories, ["0.5", "1.5", "3"]);
  assert.deepEqual(got[3].series.map((s) => [s.name, s.values]), [["Y", [2, 4, 1]]]);
  assert.deepEqual(got[4].series.map((s) => s.values), [[1, 2, 3], [4, 5, 6]]);
});

test("combo charts draw each series as its own type, on its own axis; 100% stacked shows shares", () => {
  const html = (el: ChartEl) => renderToStaticMarkup(createElement(ChartView, { el, font: "Arial" }));
  const combo = html({ ...chart, series: [{ name: "Sales", values: [5, 12] }, { name: "Margin", values: [0.2, 0.4], type: "line", y2: true }] });
  assert.match(combo, /<rect[^>]+fill="#4472C4"/);
  assert.match(combo, /data-series-type="line"/);
  assert.match(combo, /data-axis="y2"/);
  const pct = html({ ...chart, stacked: true, percent: true, series: [{ name: "A", values: [1, 3] }, { name: "B", values: [3, 1] }] });
  assert.match(pct, />100%</);
});
