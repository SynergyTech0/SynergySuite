// Slide show settings: loop/timings and custom shows round-trip through .pptx;
// rehearsed timings and ink (with highlighter transparency) survive export.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { ShapeEl, Slide } from "../lib/slides/model";
import { customShowSlides, fmtTime, parseCustomShows, parseShowSettings, showPrXml } from "../lib/slides/show";
import { strokeToFreeform } from "../lib/slides/freeform";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const slide = (id: string, title: string, extra: Partial<Slide> = {}): Slide => ({ id, title, body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "", elements: [], ...extra });

test("show settings and custom shows parse defensively", () => {
  assert.deepEqual(parseShowSettings('{"loop":true,"useTimings":false,"show":"a"}'), { loop: true, useTimings: false, show: "a" });
  assert.deepEqual(parseShowSettings("nonsense"), {});
  assert.deepEqual(parseCustomShows('[{"id":"a","name":"Short","slides":["s2",3,"s1"]},{"bad":1}]'), [{ id: "a", name: "Short", slides: ["s2", "s1"] }]);
  const out = customShowSlides([slide("s1", "One"), slide("s2", "Two", { hidden: true })], { id: "a", name: "x", slides: ["s2", "gone", "s1"] });
  assert.deepEqual(out.map((s) => [s.id, !!s.hidden]), [["s2", false], ["s1", false]]);
  assert.equal(showPrXml({ loop: true, useTimings: false }, []), '<p:showPr loop="1" showNarration="1" useTimings="0"><p:sldAll/></p:showPr>');
  assert.equal(fmtTime(65_400), "1:05");
});

test("loop, timings, custom shows and rehearsed timings round-trip through .pptx", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const slides = [slide("s1", "One", { trans: { type: "none", dur: 500, advAfter: 4200 } }), slide("s2", "Two"), slide("s3", "Three")];
  const shows = [{ id: "cA", name: "Short & sweet", slides: ["s3", "s1"] }, { id: "cB", name: "Middle", slides: ["s2"] }];
  const out = await buildPptx(slides, { name: "show", w: 1280, h: 720, theme: "plain", show: { loop: true, useTimings: false, show: "cB" }, shows });
  const zip = await JSZip.loadAsync(out);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  assert.match(pres, /<p:notesSz [^>]*\/><p:custShowLst><p:custShow name="Short &amp; sweet" id="0"><p:sldLst><p:sld r:id="rId\d+"\/><p:sld r:id="rId\d+"\/><\/p:sldLst><\/p:custShow>/);
  const props = await zip.file("ppt/presProps.xml")!.async("string");
  assert.match(props, /<p:showPr loop="1" showNarration="1" useTimings="0"><p:custShow id="1"\/><\/p:showPr>/);
  assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /advTm="4200"/);
  const deck = await importPptx(out);
  const ids = deck.slides.map((s) => s.id);
  assert.deepEqual(deck.shows?.map((x) => x.name), ["Short & sweet", "Middle"]);
  assert.deepEqual(deck.shows?.[0].slides, [ids[2], ids[0]]);
  assert.deepEqual(deck.shows?.[1].slides, [ids[1]]);
  assert.deepEqual(deck.show, { loop: true, useTimings: false, show: deck.shows?.[1].id });
  assert.equal(deck.slides[0].trans?.advAfter, 4200);
});

test("kept ink becomes freeform shapes; highlighter keeps its transparency", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const f = strokeToFreeform([{ x: 100, y: 100 }, { x: 150, y: 140 }, { x: 220, y: 120 }, { x: 300, y: 180 }, { x: 104, y: 102 }], 0)!;
  assert.equal(f.closed, false); // ink never closes into a filled shape
  const hl: ShapeEl = { id: "h1", z: 1, type: "shape", shape: "freeform", geom: f.geom, fill: null, line: "FFF100", lineW: 22, lineA: 0.4, ...f.box };
  const out = await buildPptx([slide("s1", "Ink", { elements: [hl] })], { name: "ink", w: 1280, h: 720, theme: "plain" });
  const xml = await (await JSZip.loadAsync(out)).file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<a:ln [^>]*cap="rnd"><a:solidFill><a:srgbClr val="FFF100"><a:alpha val="40000"\/><\/a:srgbClr><\/a:solidFill>[\s\S]*?<a:round\/><\/a:ln>/);
  const back = (await importPptx(out)).slides[0].elements[0] as ShapeEl;
  assert.equal(back.shape, "freeform");
  assert.equal(back.lineA, 0.4);
  assert.equal(back.line, "FFF100");
  assert.equal(back.fill, null);
});
