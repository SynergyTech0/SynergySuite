// Importer tests: run with `npm test -w apps/office` (node:test via tsx).
// Fixtures are generated at test time — a hand-written OOXML package, a deck
// written by PptxGenJS, and (when python-pptx is installed) a deck written from
// PowerPoint's default template — so no binaries live in the repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importPptx, parasToHtml } from "../lib/slides/pptx-import";
import { buildPptx } from "../lib/slides/pptx-export";
import { parseXml, child } from "../lib/slides/xml";
import { applyMaster, readSlide, slideFields, type ChartEl, type ImageEl, type ShapeEl, type Slide, type TableEl, type TextEl } from "../lib/slides/model";
import { buildSyntheticPptx } from "./fixtures/synthetic-deck";

test("xml reader handles entities, CDATA, self-closing tags and namespaces", () => {
  const x = parseXml(`<?xml version="1.0"?><a:root xmlns:a="x"><a:t>A &amp; B &#x263A;</a:t><a:e v='1 &lt; 2'/><!-- c --><a:c><![CDATA[<raw>]]></a:c></a:root>`);
  assert.equal(x.local, "root");
  assert.equal(child(x, "t")?.text, "A & B ☺");
  assert.equal(child(x, "e")?.attrs.v, "1 < 2");
  assert.equal(child(x, "c")?.text, "<raw>");
});

test("paragraphs become nested TipTap lists", () => {
  const p = (level: number, bullet: "bullet" | "number" | "none", t: string) => ({ level, bullet, html: t, text: t });
  assert.equal(
    parasToHtml([p(0, "bullet", "a"), p(1, "bullet", "b"), p(0, "bullet", "c"), p(0, "none", "d"), p(0, "number", "e")]),
    "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p>c</p></li></ul><p>d</p><ol><li><p>e</p></li></ol>",
  );
});

test("synthetic deck: order, size, placeholders, inheritance and notes", async () => {
  const deck = await importPptx(await buildSyntheticPptx());
  assert.equal(deck.w, 960);
  assert.equal(deck.h, 720);
  assert.equal(deck.theme, "plain");
  assert.equal(deck.font, "Verdana");
  assert.equal(deck.slides.length, 3);

  // sldIdLst order wins over part names
  const [t, c, hidden] = deck.slides;
  // the deck's master and layouts become editable masters; slides inherit from them
  const tv = applyMaster(t, deck.masters), cv = applyMaster(c, deck.masters);
  assert.ok(t.clayout && deck.masters?.[`c:${t.clayout}`], "slide uses its imported layout");
  assert.equal(t.tbox, undefined, "the box comes from the layout");
  assert.equal(t.title, "Hello Deck");
  assert.equal(t.layout, "title");
  assert.deepEqual(tv.tbox, { x: 72, y: 220, w: 816, h: 150 }); // from layout
  assert.equal(tv.tstyle?.size, 54); // layout lstStyle beats master titleStyle
  assert.equal(tv.tstyle?.color, "1F497D"); // tx2 -> dk2 via clrMap
  assert.equal(tv.tstyle?.font, "Georgia"); // +mj-lt
  assert.equal(tv.tstyle?.align, "center");
  assert.match(t.body, /^<p style="text-align: center"><span style="font-size: 24pt">A &amp; B subtitle<\/span><\/p>$/);
  assert.equal(t.bg, "");
  assert.equal(tv.bg, "EEECE1"); // master bgRef -> bg2 -> lt2
  assert.equal(t.elements.length, 0);
  assert.equal(tv.under, undefined); // layout hides master shapes

  assert.equal(c.title, "Agenda");
  assert.equal(c.layout, "content");
  assert.deepEqual(cv.tbox, { x: 48, y: 30, w: 864, h: 120 }); // master geometry
  assert.deepEqual(cv.bbox, { x: 60, y: 180, w: 840, h: 460 }); // layout geometry (matched by idx)
  assert.equal(c.bg, "FFEEDD");
  // bullets from master bodyStyle, autofit 50% scales 28pt -> 14pt
  assert.ok(c.body.startsWith('<ul><li><p><span style="font-size: 14pt"><strong>First</strong></span><span style="font-size: 14pt"> point</span></p><ul><li><p>'));
  assert.ok(c.body.includes('<span style="color: #ff0000; font-size: 12pt"><em>Nested</em></span>'));
  assert.ok(c.body.includes('<p style="text-align: center"><span style="color: #376092; font-size: 16pt"><u>Plain centred</u></span><br>'));
  assert.ok(c.body.includes("<ol><li><p><span style=\"font-size: 14pt\"><s>Step one</s></span></p></li><li><p><span style=\"font-size: 14pt; font-family: 'Courier New'\">Step two</span></p></li></ol>"));
  assert.equal(c.notes, "Say hello\nthen pause\nSecond para");

  const els = c.elements;
  const bar = deck.masters!.master!.elements[0] as ShapeEl; // master decoration lives on the master
  assert.deepEqual(cv.under?.map((e) => e.id), [bar.id]);
  assert.equal(bar.type, "shape");
  assert.equal(bar.fill, "C0504D");
  const tb = els.find((e) => e.type === "text") as TextEl;
  assert.deepEqual([tb.x, tb.y, tb.w, tb.h, tb.valign], [500, 600, 300, 50, "bottom"]);
  assert.match(tb.html, /Free text/);
  const oval = els.find((e) => e.type === "shape" && e.shape === "ellipse") as ShapeEl;
  assert.equal(oval.fill, "00FF00");
  assert.equal(oval.line, "0000FF");
  assert.equal(oval.lineW, 2);
  assert.equal(oval.rot, 90);
  assert.equal(oval.flipH, true);
  assert.match(oval.html || "", /In shape/);
  const styled = els.find((e) => e.type === "shape" && e.shape === "roundRect") as ShapeEl;
  assert.equal(styled.fill, "9BBB59"); // style fillRef accent3
  assert.equal(styled.line, "28415F"); // lnRef accent1 shade 50%
  const tri = els.find((e) => e.type === "shape" && e.shape === "triangle") as ShapeEl;
  assert.deepEqual([tri.x, tri.y, tri.w, tri.h], [300, 350, 100, 50]); // group child scaled 2x
  const img = els.find((e) => e.type === "image") as ImageEl;
  assert.ok(img.src.startsWith("data:image/png;base64,iVBOR"));
  assert.equal(img.alt, "A red square");
  const tbl = els.find((e) => e.type === "table") as TableEl;
  assert.deepEqual(tbl.rows.map((r) => r.map((x) => x.text)), [["Name", "Score"], ["Ada", "10"]]);
  // the header comes from the table style (the deck's default, accent 1), not baked into the cells
  assert.equal(tbl.tstyle?.first, true);
  const { styledRows } = await import("../lib/slides/table-style");
  const shown = styledRows(tbl, "4F81BD", "000000");
  assert.equal(shown[0][0].fill, "4F81BD");
  assert.equal(shown[0][0].color, "FFFFFF");
  assert.equal(tbl.rows[1][0].fill, "FFFF00");
  assert.equal(tbl.rows[1][1].align, "right");
  const ln = els.find((e) => e.type === "shape" && e.shape === "lineArrow") as ShapeEl;
  assert.equal(ln.line, "333333");
  assert.equal(ln.lineW, 3);
  // z-order follows document order
  assert.deepEqual(els.map((e) => e.z), els.map((_, i) => i + 1));

  // transition (p14 duration) and animation sequence
  assert.deepEqual(c.trans, { type: "push", dir: "u", dur: 1200, advAfter: 4000 });
  assert.deepEqual(c.banim, { effect: "fade", start: "click", dur: 500, delay: 0, order: 1, byPara: true });
  assert.deepEqual(tb.anim, { effect: "fly", dir: "l", start: "after", dur: 800, delay: 0, order: 2 });
  assert.deepEqual(tri.anim, { effect: "fade", start: "click", dur: 500, delay: 250, order: 3 });
  assert.ok(tri.group, "group members keep a shared group id");
  // exit effects are read now (this one has no target, so it is dropped quietly)
  assert.ok(!deck.warnings.some((w) => /emphasis/i.test(w)));

  assert.equal(hidden.hidden, true);
  assert.equal(hidden.layout, "blank");
  assert.equal(hidden.elements.filter((e) => e.type === "text").length, 1);
});

test("deck written by PptxGenJS", async () => {
  const PptxGen = (await import("pptxgenjs")).default;
  const pptx = new PptxGen();
  pptx.layout = "LAYOUT_WIDE";
  const s1 = pptx.addSlide();
  s1.background = { color: "102030" };
  s1.addText([
    { text: "Bold ", options: { bold: true, color: "FF0000", fontSize: 24 } },
    { text: "plain", options: { breakLine: true } },
    { text: "Bullet", options: { bullet: true } },
  ], { x: 1, y: 1, w: 5, h: 2, fontSize: 18 });
  s1.addShape("ellipse" as never, { x: 7, y: 1, w: 2, h: 1, fill: { color: "00AA00" }, line: { color: "000000", width: 2 } });
  s1.addImage({ data: "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==", x: 1, y: 4, w: 1, h: 1 });
  s1.addTable([[{ text: "A" }, { text: "B" }], [{ text: "1" }, { text: "2" }]], { x: 4, y: 4, w: 4 });
  s1.addNotes("pptxgenjs notes");
  pptx.addSlide().addText("Second", { x: 0.5, y: 0.5, w: 4, h: 1 });
  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  const deck = await importPptx(buf);
  assert.equal(deck.w, 1280);
  assert.equal(deck.h, 720);
  assert.equal(deck.slides.length, 2);
  const [a, b] = deck.slides;
  assert.equal(a.bg, "102030");
  assert.equal(a.notes, "pptxgenjs notes");
  const text = a.elements.find((e) => e.type === "text") as TextEl;
  assert.ok(text, "text box imported");
  assert.match(text.html, /<strong>Bold <\/strong>/);
  assert.match(text.html, /color: #ff0000; font-size: 24pt/);
  assert.match(text.html, /<ul><li><p>.*Bullet/);
  assert.deepEqual([text.x, text.y, text.w, text.h], [96, 96, 480, 192]);
  const ell = a.elements.find((e) => e.type === "shape") as ShapeEl;
  assert.equal(ell.shape, "ellipse");
  assert.equal(ell.fill, "00AA00");
  assert.ok(a.elements.some((e) => e.type === "image"));
  const tbl = a.elements.find((e) => e.type === "table") as TableEl;
  assert.deepEqual(tbl.rows.map((r) => r.map((x) => x.text)), [["A", "B"], ["1", "2"]]);
  assert.match((b.elements[0] as TextEl).html, /Second/);
});

test("native PowerPoint charts import, export, and retain editable data", async () => {
  const PptxGen = (await import("pptxgenjs")).default;
  const pptx = new PptxGen();
  pptx.layout = "LAYOUT_WIDE";
  const source = pptx.addSlide();
  source.addChart("bar", [
    { name: "North", labels: ["Jan", "Feb", "Mar"], values: [10, 20, 15] },
    { name: "South", labels: ["Jan", "Feb", "Mar"], values: [5, 12, 9] },
  ], { x: 1, y: 1, w: 7, h: 4, title: "Regional sales", showTitle: true, showLegend: true, chartColors: ["4472C4", "ED7D31"] });
  const imported = await importPptx((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
  const chart = imported.slides[0].elements.find((e) => e.type === "chart") as ChartEl;
  assert.ok(chart, `Expected an imported chart; warnings: ${imported.warnings.join("; ")}`);
  assert.equal(chart.chartType, "bar");
  assert.equal(chart.title, "Regional sales");
  assert.deepEqual(chart.categories, ["Jan", "Feb", "Mar"]);
  assert.deepEqual(chart.series.map((s) => [s.name, s.values]), [["North", [10, 20, 15]], ["South", [5, 12, 9]]]);
  assert.deepEqual([chart.x, chart.y, chart.w, chart.h], [96, 96, 672, 384]);
  assert.equal(chart.showLegend, true);

  const slide: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [chart] };
  const persisted = readSlide(new Map(Object.entries(slideFields(slide))));
  assert.deepEqual(persisted.elements, [chart], "Chart data survives collaborative slide storage");
  const exported = await buildPptx([slide], { name: "Chart deck", w: 1280, h: 720, theme: "plain" });
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(exported);
  const chartParts = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
  assert.equal(chartParts.length, 1, "A native, editable chart part is in the PPTX");
  const xml = await zip.file(chartParts[0])!.async("string");
  assert.match(xml, /<c:barChart>/);
  assert.match(xml, /<c:v>20<\/c:v>/);
  const reopened = await importPptx(exported);
  const roundtrip = reopened.slides[0].elements.find((e) => e.type === "chart") as ChartEl;
  assert.ok(roundtrip, `Expected a reopened chart; warnings: ${reopened.warnings.join("; ")}`);
  assert.deepEqual(roundtrip.categories, chart.categories);
  assert.deepEqual(roundtrip.series.map((s) => s.values), chart.series.map((s) => s.values));
});

test("line and pie chart values import from native chart parts", async () => {
  const PptxGen = (await import("pptxgenjs")).default;
  const pptx = new PptxGen();
  const slide = pptx.addSlide();
  slide.addChart("line", [{ name: "Trend", labels: ["Start", "End"], values: [-3, 8] }], { x: 0.5, y: 0.5, w: 5, h: 3 });
  slide.addChart("pie", [{ name: "Share", labels: ["A", "B"], values: [25, 75] }], { x: 6, y: 0.5, w: 5, h: 3, showLegend: false });
  const deck = await importPptx((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
  const charts = deck.slides[0].elements.filter((e) => e.type === "chart") as ChartEl[];
  assert.equal(charts.length, 2, `Expected two charts; warnings: ${deck.warnings.join("; ")}`);
  assert.deepEqual(charts.map((c) => c.chartType), ["line", "pie"]);
  assert.deepEqual(charts.map((c) => c.series[0].values), [[-3, 8], [25, 75]]);
  assert.deepEqual(charts[1].categories, ["A", "B"]);
  assert.equal(charts[1].showLegend, false);
  const exported = await buildPptx([{ id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: charts }], { name: "Line and pie", w: deck.w, h: deck.h, theme: "plain" });
  const reopened = await importPptx(exported);
  const roundtrip = reopened.slides[0].elements.filter((e) => e.type === "chart") as ChartEl[];
  assert.deepEqual(roundtrip.map((c) => c.chartType), ["line", "pie"]);
  assert.deepEqual(roundtrip.map((c) => c.series[0].values), [[-3, 8], [25, 75]]);
});

let hasPythonPptx = false;
try {
  execFileSync("python3", ["-c", "import pptx"], { stdio: "ignore" });
  hasPythonPptx = true;
} catch {
  /* optional */
}

test("deck written from PowerPoint's default template (python-pptx)", { skip: !hasPythonPptx && "python-pptx not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pptx-"));
  try {
    const file = path.join(dir, "py.pptx");
    execFileSync("python3", [path.join(__dirname, "fixtures", "make_python_pptx.py"), file]);
    const deck = await importPptx(readFileSync(file));
    assert.equal(deck.slides.length, 3);
    const [t, c, free] = deck.slides;
    assert.equal(t.layout, "title");
    assert.equal(t.title, "Quarterly Review");
    assert.match(t.body, /Prepared by the team/);
    assert.equal(c.title, "Highlights");
    assert.match(c.body, /<ul><li><p><span style="font-size: 32pt">Revenue up<\/span><\/p><ul><li><p><span style="font-size: 28pt">Mostly in EMEA/);
    assert.match(c.body, /color: #c00000; font-size: 32pt"><strong>Costs flat/);
    assert.equal(c.notes, "Mention the hiring plan");
    assert.equal(free.layout, "blank");
    const tb = free.elements.find((e) => e.type === "text") as TextEl;
    assert.equal(tb.html, '<p style="text-align: center"><span style="font-size: 40pt"><em><u>Big italic</u></em></span></p>');
    const sh = free.elements.find((e) => e.type === "shape") as ShapeEl;
    assert.equal(sh.shape, "roundRect");
    assert.equal(sh.fill, "008000");
    assert.match(sh.html || "", /color: #ffffff.*Go/); // fontRef lt1
    assert.ok(free.elements.some((e) => e.type === "image"));
    const tbl = free.elements.find((e) => e.type === "table") as TableEl;
    assert.deepEqual(tbl.rows.map((r) => r.map((x) => x.text)), [["Q", "Total"], ["Q1", "42"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects files that are not presentations", async () => {
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  z.file("word/document.xml", "<w:document/>");
  await assert.rejects(importPptx(await z.generateAsync({ type: "uint8array" })), /not a PowerPoint presentation/);
});
