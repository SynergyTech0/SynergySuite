// OpenDocument presentations: a deck written by buildOdp reads back through
// importOdp with its text, shapes, tables, charts, equations, groups, notes,
// backgrounds and pictures; and the file is a well-formed ODF package.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { ChartEl, ImageEl, MathEl, MediaEl, ShapeEl, Slide, TableEl, TextEl } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

// a 1x1 red PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const near = (a: number | undefined, b: number, msg?: string) => assert.ok(a !== undefined && Math.abs(a - b) < 1.5, `${msg ?? ""} ${a} != ${b}`);

test("a deck round-trips through .odp", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const text: TextEl = { id: "t1", z: 1, type: "text", x: 100, y: 300, w: 400, h: 120, html: "<p>Plain <b>bold</b> <i>it</i> <span style=\"color: #ff0000\">red</span> <a href=\"https://example.com/x\"><b>link</b></a></p><p style=\"text-align: center\">second</p>", valign: "middle" };
  const rect: ShapeEl = { id: "r1", z: 2, type: "shape", shape: "roundRect", x: 600, y: 300, w: 200, h: 100, rot: 30, fill: "4472c4", line: "112233", lineW: 3, html: "<p>in shape</p>" };
  const line: ShapeEl = { id: "l1", z: 3, type: "shape", shape: "line", x: 100, y: 500, w: 300, h: 0, line: "00aa00", lineW: 2 };
  const free: ShapeEl = { id: "f1", z: 4, type: "shape", shape: "freeform", x: 900, y: 300, w: 100, h: 100, geom: { w: 10, h: 10, d: "M0 0 L10 0 L5 10 Z" }, fill: "ffc000", line: null };
  const g1: ShapeEl = { id: "g1", z: 5, type: "shape", shape: "ellipse", x: 900, y: 500, w: 80, h: 80, fill: "70ad47", group: "G" };
  const g2: ShapeEl = { id: "g2", z: 6, type: "shape", shape: "rect", x: 1000, y: 500, w: 80, h: 80, fill: "ed7d31", group: "G" };
  const s1: Slide = { id: "s1", title: "Hello ODF", body: "<ul><li><p>First point</p></li><li><p>Second point</p></li></ul>", notes: "Speaker notes here", layout: "content", bg: "fff2cc", bgImg: "", elements: [text, rect, line, free, g1, g2] };

  const table: TableEl = {
    id: "tb", z: 1, type: "table", x: 60, y: 60, w: 600, h: 200,
    rows: [
      [{ text: "A", bold: true, fill: "dddddd", cs: 2 }, { text: "", merged: true }, { text: "C" }],
      [{ text: "1", align: "right" }, { text: "2" }, { text: "3", color: "ff0000" }],
    ],
  };
  const chart: ChartEl = {
    id: "ch", z: 2, type: "chart", chartType: "bar", x: 700, y: 60, w: 500, h: 360, title: "Sales",
    categories: ["Q1", "Q2", "Q3"],
    series: [{ name: "North", values: [10, 20, 30], trend: { type: "linear", eq: true } }, { name: "South", values: [5, 8, 13] }],
    valAx: { min: 0, max: 40, major: 10, minor: 2, minorGrid: true, fmt: "$#,##0", title: "Units" },
  };
  const scatter: ChartEl = {
    id: "sc", z: 5, type: "chart", chartType: "scatter", x: 700, y: 440, w: 400, h: 260,
    categories: ["1", "2", "4"], series: [{ name: "Y", values: [3, 5, 9], trend: { type: "poly", order: 2, r2: true } }],
    catAx: { min: 0, max: 5, major: 1, fmt: "0.0", title: "Dose" },
  };
  const math: MathEl = { id: "m", z: 3, type: "math", x: 60, y: 400, w: 300, h: 100, latex: "\\frac{a}{b}+\\sqrt{x}", size: 32, color: "0000ff" };
  const img: ImageEl = { id: "im", z: 4, type: "image", x: 400, y: 400, w: 100, h: 100, src: PNG, alt: "red dot" };
  const s2: Slide = { id: "s2", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", hidden: true, bgGrad: { kind: "linear", angle: 90, stops: [{ pos: 0, color: "ffffff" }, { pos: 100, color: "4472c4" }] }, elements: [table, chart, math, img, scatter] };

  const { data } = await buildOdp([s1, s2], { name: "Round trip", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(data);
  // the mimetype comes first and is stored uncompressed
  assert.equal(Object.keys(zip.files)[0], "mimetype");
  assert.equal(await zip.file("mimetype")!.async("string"), "application/vnd.oasis.opendocument.presentation");
  const manifest = await zip.file("META-INF/manifest.xml")!.async("string");
  for (const f of Object.keys(zip.files).filter((f) => !f.endsWith("/") && f !== "mimetype" && !f.startsWith("META-INF"))) {
    assert.ok(manifest.includes(`manifest:full-path="${f}"`), `manifest lists ${f}`);
  }
  const content = await zip.file("content.xml")!.async("string");
  assert.match(content, /<draw:frame [^>]*presentation:class="title"/);
  assert.match(content, /<draw:custom-shape [^>]*draw:transform="rotate/);
  assert.match(content, /<table:covered-table-cell/);
  // links sit inside styled spans, as LibreOffice expects
  assert.match(content, /<text:span text:style-name="\w+"><text:a xlink:type="simple" xlink:href="https:\/\/example.com\/x">link<\/text:a><\/text:span>/);

  const deck = await importOdp(data);
  assert.equal(deck.w, 1280);
  assert.equal(deck.h, 720);
  assert.equal(deck.slides.length, 2);
  const [a, b] = deck.slides;

  assert.equal(a.title, "Hello ODF");
  assert.equal(a.layout, "content");
  assert.match(a.body, /First point[^]*Second point/);
  assert.match(a.body, /<li>/);
  assert.equal(a.notes, "Speaker notes here");
  assert.equal(a.bg.toLowerCase(), "fff2cc");
  assert.ok(!a.hidden);

  const t = a.elements.find((e) => e.type === "text") as TextEl;
  assert.ok(t, "text box");
  near(t.x, 100); near(t.y, 300); near(t.w, 400);
  assert.match(t.html, /<(b|strong)>bold<\/(b|strong)>/);
  assert.match(t.html, /<(i|em)>it<\/(i|em)>/);
  assert.match(t.html, /color: ?#ff0000/i);
  assert.match(t.html, /text-align: ?center/);
  assert.match(t.html, /<a href="https:\/\/example.com\/x"[^>]*>(<[^>]+>)*link/);
  assert.equal(t.valign, "middle");

  const shapes = a.elements.filter((e) => e.type === "shape") as ShapeEl[];
  const r = shapes.find((e) => e.shape === "roundRect")!;
  assert.ok(r, "rounded rectangle");
  near(r.x, 600, "x"); near(r.y, 300, "y"); near(r.w, 200, "w"); near(r.h, 100, "h");
  near(r.rot, 30, "rotation");
  assert.equal(r.fill?.toLowerCase(), "4472c4");
  assert.equal(r.line?.toLowerCase(), "112233");
  near(r.lineW, 3, "line width");
  assert.match(r.html ?? "", /in shape/);
  const l = shapes.find((e) => e.shape === "line")!;
  assert.ok(l, "line");
  near(l.x, 100); near(l.w, 300); near(l.h, 0);
  assert.equal(l.line?.toLowerCase(), "00aa00");
  const f = shapes.find((e) => e.shape === "freeform")!;
  assert.ok(f?.geom, "freeform outline");
  assert.equal(f.fill?.toLowerCase(), "ffc000");
  assert.equal(f.line, null);
  const grouped = shapes.filter((e) => e.group);
  assert.equal(grouped.length, 2, "both group members");
  assert.equal(grouped[0].group, grouped[1].group);

  assert.ok(b.hidden, "hidden slide");
  assert.equal(b.bgGrad?.stops.length, 2);
  const tb = b.elements.find((e) => e.type === "table") as TableEl;
  assert.ok(tb, "table");
  assert.equal(tb.rows.length, 2);
  assert.equal(tb.rows[0][0].text, "A");
  assert.equal(tb.rows[0][0].cs, 2);
  assert.ok(tb.rows[0][1].merged);
  assert.ok(tb.rows[0][0].bold);
  assert.equal(tb.rows[0][0].fill?.toLowerCase(), "dddddd");
  assert.equal(tb.rows[1][2].text, "3");

  const ch = b.elements.find((e) => e.type === "chart") as ChartEl;
  assert.ok(ch, "chart");
  assert.equal(ch.chartType, "bar");
  assert.equal(ch.title, "Sales");
  assert.deepEqual(ch.categories, ["Q1", "Q2", "Q3"]);
  assert.deepEqual(ch.series.map((s) => [s.name, s.values]), [["North", [10, 20, 30]], ["South", [5, 8, 13]]]);
  assert.deepEqual(ch.series[0].trend, { type: "linear", eq: true });
  assert.deepEqual(ch.valAx, chart.valAx);
  const sc2 = b.elements.find((e) => e.type === "chart" && e.chartType === "scatter") as ChartEl;
  assert.deepEqual(sc2.catAx, scatter.catAx);
  assert.deepEqual(sc2.series[0].trend, scatter.series[0].trend);

  const m = b.elements.find((e) => e.type === "math") as MathEl;
  assert.ok(m, "equation");
  assert.equal(m.latex, math.latex);

  const im = b.elements.find((e) => e.type === "image") as ImageEl;
  assert.ok(im, "picture");
  assert.match(im.src, /^data:image\/png;base64,/);
  near(im.w, 100);
});

test("MathML from other applications becomes LaTeX", async () => {
  const { mathmlToLatex } = await import("../lib/slides/odp-import");
  const { parseXml } = await import("../lib/slides/xml");
  const xml = parseXml(`<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mfrac><mi>a</mi><mn>2</mn></mfrac><mo>+</mo><msqrt><mi>x</mi></msqrt><mo>+</mo><msup><mi>e</mi><mi>y</mi></msup></mrow></semantics></math>`);
  assert.equal(mathmlToLatex(xml).replace(/\s+/g, ""), "\\frac{a}{2}+\\sqrt{x}+e^{y}");
});

test("masters, layouts and slide settings survive .odp", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const logo: ShapeEl = { id: "logo", z: 1, type: "shape", shape: "ellipse", x: 1180, y: 20, w: 60, h: 60, fill: "ff0000" };
  const band: ShapeEl = { id: "band", z: 1, type: "shape", shape: "rect", x: 0, y: 680, w: 1280, h: 40, fill: "00ff00" };
  const custom: ShapeEl = { id: "cst", z: 1, type: "shape", shape: "triangle", x: 20, y: 20, w: 40, h: 40, fill: "0000ff" };
  const base = { notes: "", bg: "", bgImg: "", elements: [] };
  const masters = {
    master: { id: "", title: "", body: "", layout: "content" as const, ...base, tstyle: { color: "112233" }, elements: [logo] },
    content: { id: "", title: "", body: "", layout: "content" as const, ...base, bg: "eeeeee", elements: [band] },
    "c:abc": { id: "", title: "", body: "", layout: "titleOnly" as const, lname: "Banner", ...base, elements: [custom] },
  };
  const pic: ImageEl = { id: "p", z: 1, type: "image", x: 10, y: 10, w: 50, h: 50, src: PNG, crop: { l: 0.25, t: 0, r: 0, b: 0 }, anim: { effect: "fade", start: "click" } as never };
  const slides: Slide[] = [
    { id: "a", title: "Cover", body: "", notes: "", layout: "title", bg: "", bgImg: "", elements: [] },
    { id: "b", title: "Points", body: "<ul><li><p>x</p></li></ul>", notes: "", layout: "content", bg: "", bgImg: "", elements: [pic], trans: { type: "fade", dur: 500 } },
    { id: "c", title: "Banner", body: "", notes: "", layout: "titleOnly", clayout: "abc", bg: "", bgImg: "", elements: [] },
    { id: "d", title: "Plain", body: "", notes: "", layout: "titleOnly", hideUnder: true, bg: "123456", bgImg: "", elements: [] },
  ];
  const vid: MediaEl = { id: "v", z: 2, type: "media", kind: "video", x: 100, y: 100, w: 320, h: 180, src: "data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=", mime: "video/webm", poster: PNG, autoplay: true, loop: true, name: "clip" };
  slides[1].elements.push(vid);
  const { data } = await buildOdp(slides, { name: "m", w: 1280, h: 720, theme: "plain", masters, hf: { num: true, footer: "ACME" } });
  const styles = await (await JSZip.loadAsync(data)).file("styles.xml")!.async("string");
  assert.match(styles, /<style:master-page style:name="syn-m-content" syn:key="content"[^>]*>.*syn-el-logo.*syn-el-band.*<\/style:master-page>/);
  assert.match(styles, /<style:master-page style:name="syn-m-c_abc" syn:key="c:abc"/);
  const deck = await importOdp(data);
  assert.deepEqual(deck.masters?.master?.elements.map((e) => e.id), ["logo"]);
  assert.deepEqual(deck.masters?.content?.elements.map((e) => e.id), ["band"]);
  assert.deepEqual(deck.masters?.["c:abc"]?.elements.map((e) => e.id), ["cst"]);
  assert.equal(deck.masters?.["c:abc"]?.lname, "Banner");
  assert.equal(deck.masters?.master?.tstyle?.color, "112233");
  assert.equal(deck.masters?.content?.bg, "eeeeee");
  assert.deepEqual(deck.hf, { num: true, footer: "ACME" });
  const [a, b, c, d] = deck.slides;
  assert.equal(a.layout, "title", "a title slide without a subtitle keeps its layout");
  assert.equal(a.elements.length, 0, "master objects are not copied onto slides");
  assert.equal(a.tstyle, undefined, "the master's title style is not frozen onto the slide");
  assert.equal(b.bg, "", "the layout's background stays the layout's");
  assert.deepEqual(b.trans, { type: "fade", dur: 500 });
  const p2 = b.elements[0] as ImageEl;
  assert.deepEqual(p2.crop, pic.crop);
  assert.equal(p2.anim?.effect, "fade");
  const v2 = b.elements.find((e) => e.type === "media") as MediaEl;
  assert.ok(v2, "video embedded as a plug-in");
  assert.equal(v2.src, vid.src);
  assert.deepEqual([v2.kind, v2.mime, v2.autoplay, v2.loop, v2.name], ["video", "video/webm", true, true, "clip"]);
  assert.match(v2.poster || "", /^data:image\/png;base64,/);
  assert.equal(c.clayout, "abc");
  assert.ok(d.hideUnder);
  assert.equal(d.bg, "123456");
});

test("axis number formats become ODF number styles and back", async () => {
  const { odfNumberStyle } = await import("../lib/slides/odp-export");
  const { numberStyleCode } = await import("../lib/slides/odp-import");
  const { parseXml } = await import("../lib/slides/xml");
  const { formatNumber } = await import("../lib/slides/chart");
  const NS = 'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';
  for (const code of ["0", "0.0", "#,##0.00", "0%", "0.0%", "$#,##0", "[$€-407]#,##0.00", '0.0"k"', "#,##0,", "0.00E+00"]) {
    const xml = odfNumberStyle("N1", code)!;
    assert.ok(xml, code);
    const back = numberStyleCode(parseXml(`<x ${NS}>${xml}</x>`).children[0]);
    for (const v of [0, 1234.567, 0.125, 98765]) assert.equal(formatNumber(v, back), formatNumber(v, code), `${code} -> ${back} at ${v}`);
  }
  assert.equal(odfNumberStyle("N1", "General"), undefined);
  assert.match(odfNumberStyle("N1", "0%")!, /^<number:percentage-style/);
});

test("cropped pictures go to .odp cropped (LibreOffice ignores crop) and come back whole with their crop", async () => {
  const { cropSvg } = await import("../lib/slides/crop");
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  assert.match(cropSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect/></svg>', { l: 0.25, t: 0.1, r: 0.25, b: 0.1 })!, /^<svg viewBox="50 10 100 80" width="100" height="80" preserveAspectRatio="none" xmlns/);
  assert.match(cropSvg('<svg viewBox="0 0 20 10"></svg>', { l: 0.5, t: 0, r: 0, b: 0 })!, /viewBox="10 0 10 10" width="10" height="10"/);
  assert.equal(cropSvg("<svg></svg>", { l: 0.5, t: 0, r: 0, b: 0 }), null);
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>').toString("base64")}`;
  const pic: ImageEl = { id: "p", z: 1, type: "image", x: 10, y: 10, w: 50, h: 50, src: svg, crop: { l: 0.5, t: 0, r: 0, b: 0 } };
  const s: Slide = { id: "s", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [pic] };
  const { data, warnings } = await buildOdp([s], { name: "c", w: 1280, h: 720, theme: "plain" });
  assert.ok(!warnings.some((w) => /uncropped/.test(w)));
  const zip = await JSZip.loadAsync(data);
  const svgs = await Promise.all(Object.keys(zip.files).filter((f) => f.endsWith(".svg")).map((f) => zip.file(f)!.async("string")));
  assert.equal(svgs.length, 2, "the cropped picture for others, the whole one for us");
  assert.ok(svgs.some((x) => /viewBox="100 0 100 100"/.test(x)));
  const back = (await importOdp(data)).slides[0].elements[0] as ImageEl;
  assert.deepEqual(back.crop, pic.crop);
  assert.doesNotMatch(Buffer.from(back.src.split(",")[1], "base64").toString(), /viewBox/);
});

test("animations go to .odp as ODF SMIL (LibreOffice's presets) and come back from other applications", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const box = (id: string, z: number, x: number): ShapeEl => ({ id, type: "shape", shape: "rect", fill: "4472C4", line: null, x, y: 300, w: 120, h: 80, z });
  const a = { ...box("a", 1, 100), anim: { effect: "fly", dir: "l", start: "click", dur: 500, delay: 0, order: 1 }, fx: [{ effect: "spin", kind: "emph", start: "after", dur: 1000, delay: 0, order: 3 }] } as ShapeEl;
  const b = { ...box("b", 2, 400), anim: { effect: "path", kind: "path", path: "M 0 0 L 0.25 0 E", start: "with", dur: 2000, delay: 250, order: 2 } } as ShapeEl;
  const c = { ...box("c", 3, 700), anim: { effect: "fade", kind: "exit", start: "click", dur: 500, delay: 0, order: 1, trigger: "b" } } as ShapeEl;
  const s: Slide = { id: "s", title: "Moves", body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "", elements: [a, b, c], tanim: { effect: "wipe", dir: "b", start: "click", dur: 500, delay: 0, order: 0 } };
  const { data } = await buildOdp([s], { name: "anim", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("content.xml")!.async("string");
  assert.match(xml, /<anim:par presentation:node-type="timing-root"><anim:seq presentation:node-type="main-sequence">/);
  assert.match(xml, /presentation:preset-id="ooo-entrance-fly-in" presentation:preset-sub-type="from-left"/);
  assert.match(xml, /presentation:preset-id="ooo-emphasis-spin"/);
  assert.match(xml, /<anim:animateMotion [^>]*svg:path="M 0 0 L 0.25 0"/);
  assert.match(xml, /presentation:node-type="interactive-sequence"/);
  assert.match(xml, /smil:begin="a-b\.click"/);
  assert.match(xml, /xml:id="a-title" draw:id="a-title" draw:name="syn-title"/);
  assert.match(xml, /xml:id="a-a" draw:id="a-a"/);
  // our own file: the exact settings from syn:x
  const own = await importOdp(data);
  assert.deepEqual(own.slides[0].elements.find((e) => e.id === "a")?.anim, a.anim);

  // as another application wrote it: no syn: settings, its own ids
  const foreign = xml.replace(/ syn:[\w-]+="[^"]*"/g, "");
  zip.file("content.xml", foreign);
  const meta = await zip.file("meta.xml")?.async("string");
  if (meta) zip.file("meta.xml", meta.replace(/<meta:user-defined[^>]*>[^<]*<\/meta:user-defined>/g, ""));
  const deck = await importOdp(await zip.generateAsync({ type: "uint8array" }));
  const sl = deck.slides[0];
  assert.equal(sl.tanim?.effect, "wipe");
  assert.equal(sl.tanim?.dir, "b");
  const shapes = sl.elements.filter((e) => e.type === "shape");
  const [ea, eb, ec] = shapes;
  assert.equal(ea.anim?.effect, "fly");
  assert.equal(ea.anim?.dir, "l");
  assert.equal(ea.fx?.[0]?.effect, "spin");
  assert.equal(ea.fx?.[0]?.start, "after");
  assert.equal(eb.anim?.kind, "path");
  assert.equal(eb.anim?.path, "M 0 0 L 0.25 0 E");
  assert.equal(eb.anim?.start, "with");
  assert.equal(eb.anim?.delay, 250);
  assert.equal(ec.anim?.kind, "exit");
  assert.equal(ec.anim?.effect, "fade");
  assert.equal(ec.anim?.trigger, eb.id, "the trigger is the object clicked");
});
