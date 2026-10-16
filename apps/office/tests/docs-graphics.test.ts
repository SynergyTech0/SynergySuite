// Charts and SmartArt in Word documents: their parts, and a round trip
// through .docx.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { chartSpaceXml, chartWorkbook, readChartSpace, parseChartTable, chartTableText, diagramParts, readDiagram, diagramSvg, shapeParagraphs, diagramKindOf, colName, type ChartData, type DiagramData } from "../lib/docs/word-graphics";
import { parseXml } from "../lib/slides/xml";
import type { PMNode } from "../lib/docs/model";

const chart: ChartData = {
  chartType: "bar",
  title: "Revenue & costs",
  categories: ["Q1", "Q2", "Q3"],
  series: [
    { name: "Revenue", values: [10, 20.5, 30] },
    { name: "Costs", values: [8, 9, 12], color: "C00000", trend: { type: "linear" } },
  ],
  stacked: true,
  dataLabels: true,
  legendPos: "r",
  valAx: { min: 0, max: 50, major: 10, fmt: "0.0", title: "EUR" },
};

test("chart data typed as a table", () => {
  const t = parseChartTable("\tA\tB\nx\t1\t2\ny\t3,000\t4");
  assert.deepEqual(t, { categories: ["x", "y"], series: [{ name: "A", values: [1, 3000] }, { name: "B", values: [2, 4] }] });
  assert.equal(chartTableText({ ...chart }), "\tRevenue\tCosts\nQ1\t10\t8\nQ2\t20.5\t9\nQ3\t30\t12");
  assert.deepEqual(parseChartTable("Month,Sales\nJan,5"), { categories: ["Jan"], series: [{ name: "Sales", values: [5] }] });
  assert.deepEqual([colName(0), colName(25), colName(26), colName(701)], ["A", "Z", "AA", "ZZ"]);
});

test("chart part: well formed, read back the same", () => {
  for (const type of ["bar", "line", "area", "pie", "doughnut", "scatter"] as const) {
    const c: ChartData = { ...chart, chartType: type, categories: type === "scatter" ? ["1", "2", "3"] : chart.categories };
    const xml = chartSpaceXml(c, { embedded: true });
    assert.doesNotThrow(() => parseXml(xml), type);
    const back = readChartSpace(xml)!;
    assert.equal(back.chartType, type);
    assert.deepEqual(back.categories, c.categories);
    assert.deepEqual(back.series.map((s) => s.values), [[10, 20.5, 30], [8, 9, 12]]);
    assert.deepEqual(back.series.map((s) => s.name), ["Revenue", "Costs"]);
    assert.equal(back.title, "Revenue & costs");
    assert.equal(back.legendPos, "r");
    if (type === "bar" || type === "line" || type === "area") {
      assert.equal(back.stacked, true, type);
      assert.equal(back.series[1].color, "C00000");
      assert.equal(back.series[1].trend?.type, "linear");
      assert.deepEqual([back.valAx?.min, back.valAx?.max, back.valAx?.major, back.valAx?.fmt, back.valAx?.title], [0, 50, 10, "0.0", "EUR"]);
    }
    assert.equal(back.dataLabels, true);
  }
  const xml = chartSpaceXml(chart, { embedded: true });
  assert.match(xml, /<c:f>Sheet1!\$B\$2:\$B\$4<\/c:f>/);
  assert.match(xml, /<c:externalData r:id="rId1">/);
  // element order inside the value axis follows the schema
  const ax = /<c:valAx>.*<\/c:valAx>/.exec(xml)![0];
  const order = ["axId", "scaling", "delete", "axPos", "majorGridlines", "title", "numFmt", "majorTickMark", "tickLblPos", "crossAx", "crossBetween", "majorUnit"].map((t) => ax.indexOf(`<c:${t}`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("the embedded workbook holds the data", async () => {
  const zip = await JSZip.loadAsync(await chartWorkbook(chart));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheet, /<c r="B1" t="inlineStr"><is><t xml:space="preserve">Revenue<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B3"><v>20.5<\/v><\/c>/);
  assert.match(sheet, /<c r="A4" t="inlineStr">/);
  assert.ok(zip.file("xl/workbook.xml"));
});

const diagram: DiagramData = { kind: "hierarchy", accent: "70AD47", items: [{ text: "CEO", level: 0 }, { text: "CTO", level: 1 }, { text: "Dev & Ops", level: 2 }, { text: "CFO", level: 1 }] };

test("SmartArt parts: data model, layout, drawing; read back", () => {
  const p = diagramParts(diagram, 576, 320, "rId9");
  for (const x of Object.values(p)) assert.doesNotThrow(() => parseXml(x));
  assert.match(p.data, /loTypeId="urn:microsoft.com\/office\/officeart\/2005\/8\/layout\/hierarchy1"/);
  assert.match(p.data, /<dsp:dataModelExt [^>]*relId="rId9"/);
  assert.match(p.layout, /uniqueId="urn:microsoft.com\/office\/officeart\/2005\/8\/layout\/hierarchy1"/);
  // a full layout definition: Word's hierarchy algorithms, constraints and the sample data, not a stub
  assert.match(p.layout, /<dgm:alg type="hierChild"\/>/);
  assert.match(p.layout, /<dgm:alg type="hierRoot"\/>/);
  assert.match(p.layout, /<dgm:constrLst><dgm:constr /);
  assert.match(p.layout, /<dgm:sampData/);
  assert.match(p.style, /<dgm:styleLbl name="sibTrans2D1">/);
  assert.match(p.colors, /<dgm:styleLbl name="parChTrans1D2">/);
  for (const kind of ["process", "cycle", "list", "pyramid"] as const) assert.doesNotThrow(() => parseXml(diagramParts({ ...diagram, kind }, 400, 200, "rId1").layout), kind);
  assert.match(p.drawing, /<a:t>Dev &amp; Ops<\/a:t>/);
  assert.match(p.drawing, /<a:prstGeom prst="roundRect">/);
  assert.match(p.drawing, /<a:custGeom>/, "connectors as freeforms");
  const back = readDiagram(p.data, p.layout)!;
  assert.deepEqual(back, diagram);
  assert.equal(diagramKindOf("urn:microsoft.com/office/officeart/2005/8/layout/hChevron3"), "process");
  assert.equal(diagramKindOf("urn:microsoft.com/office/officeart/2005/8/layout/radial1"), "cycle");
  assert.equal(diagramKindOf("urn:microsoft.com/office/officeart/2005/8/layout/default"), "list");
});

test("SmartArt drawn as SVG with its text", () => {
  for (const kind of ["process", "cycle", "hierarchy", "list", "pyramid"] as const) {
    const svg = diagramSvg({ ...diagram, kind }, 500, 300);
    assert.doesNotThrow(() => parseXml(svg), kind);
    assert.match(svg, /Dev &amp; Ops|CEO/);
  }
  assert.deepEqual(shapeParagraphs('<p style="text-align: center"><span style="color: #ffffff; font-size: 18pt">A &amp; B</span></p><ul><li><p><span style="color: #ffffff; font-size: 13pt">sub</span></p></li></ul>'), [
    { text: "A & B", color: "FFFFFF", pt: 18, level: 0, align: "ctr" },
    { text: "sub", color: "FFFFFF", pt: 13, level: 1, align: "l" },
  ]);
});

test("charts and SmartArt round-trip through .docx", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Results: " }, { type: "wordChart", attrs: { chart: JSON.stringify(chart), width: 400, height: 250, alt: "Revenue chart" } }] },
      { type: "paragraph", content: [{ type: "smartArt", attrs: { diagram: JSON.stringify(diagram), width: 500, height: 300 } }] },
    ],
  };
  const bytes = await buildDocx({ doc });
  const zip = await JSZip.loadAsync(bytes);
  const types = await zip.file("[Content_Types].xml")!.async("string");
  assert.match(types, /\/word\/charts\/chart1.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawingml.chart\+xml"/);
  assert.match(types, /\/word\/diagrams\/drawing1.xml" ContentType="application\/vnd.ms-office.drawingml.diagramDrawing\+xml"/);
  assert.match(types, /Extension="xlsx"/);
  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  assert.match(rels, /relationships\/chart" Target="charts\/chart1.xml"/);
  assert.match(rels, /diagramData" Target="diagrams\/data1.xml"/);
  assert.match(rels, /2007\/relationships\/diagramDrawing" Target="diagrams\/drawing1.xml"/);
  assert.ok(zip.file("word/embeddings/Microsoft_Excel_Worksheet1.xlsx"));
  assert.match(await zip.file("word/charts/_rels/chart1.xml.rels")!.async("string"), /relationships\/package" Target="..\/embeddings\/Microsoft_Excel_Worksheet1.xlsx"/);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<wp:extent cx="3810000" cy="2381250"\/>/);
  assert.match(xml, /<c:chart xmlns:c="[^"]+" r:id="rId\d+"\/>/);
  assert.match(xml, /<dgm:relIds [^>]*r:dm="rId\d+" r:lo="rId\d+" r:qs="rId\d+" r:cs="rId\d+"\/>/);
  // the drawing relationship id is the one the data model names
  const drawRel = /Id="(rId\d+)" Type="http:\/\/schemas.microsoft.com\/office\/2007\/relationships\/diagramDrawing"/.exec(rels)![1];
  assert.match(await zip.file("word/diagrams/data1.xml")!.async("string"), new RegExp(`relId="${drawRel}"`));

  const back = await importDocx(bytes);
  const p1 = back.doc.content![0].content!;
  const c = p1.find((n) => n.type === "wordChart")!;
  assert.deepEqual([c.attrs!.width, c.attrs!.height, c.attrs!.alt], [400, 250, "Revenue chart"]);
  const cd = JSON.parse(String(c.attrs!.chart)) as ChartData;
  assert.deepEqual(cd.series.map((s) => s.values), [[10, 20.5, 30], [8, 9, 12]]);
  assert.equal(cd.title, "Revenue & costs");
  const s = back.doc.content![1].content!.find((n) => n.type === "smartArt")!;
  assert.deepEqual(JSON.parse(String(s.attrs!.diagram)), diagram);
  assert.equal(back.warnings, undefined);
});

test("a combo chart keeps every series' type and the secondary axis", () => {
  const combo: ChartData = {
    chartType: "bar",
    categories: ["A", "B", "C"],
    series: [
      { name: "Sales", values: [5, 6, 7] },
      { name: "Trend", values: [4, 6, 8], type: "line" },
      { name: "Share", values: [0.2, 0.3, 0.4], type: "line", y2: true },
      { name: "Volume", values: [1, 2, 3], type: "area" },
    ],
    stacked: true,
  };
  const xml = chartSpaceXml(combo);
  assert.equal((xml.match(/<c:barChart>/g) || []).length, 1);
  assert.equal((xml.match(/<c:lineChart>/g) || []).length, 2);
  assert.equal((xml.match(/<c:areaChart>/g) || []).length, 1);
  assert.equal((xml.match(/<c:valAx>/g) || []).length, 2);
  // only the chart's own type is stacked
  assert.match(xml, /<c:barChart><c:barDir val="col"\/><c:grouping val="stacked"\/>/);
  assert.match(xml, /<c:lineChart><c:grouping val="standard"\/>/);
  assert.match(xml, /<c:crosses val="max"\/>/);
  parseXml(xml);
  const back = readChartSpace(xml)!;
  assert.equal(back.chartType, "bar");
  assert.deepEqual(
    back.series.map((s) => [s.name, s.type || null, !!s.y2]),
    [["Sales", null, false], ["Trend", "line", false], ["Share", "line", true], ["Volume", "area", false]],
  );
  assert.deepEqual(back.series[2].values, [0.2, 0.3, 0.4]);
  // a plain chart is unchanged: one plot
  const plain = chartSpaceXml({ ...combo, series: combo.series.map(({ name, values }) => ({ name, values })) });
  assert.equal((plain.match(/<c:(bar|line|area)Chart>/g) || []).length, 1);
});
