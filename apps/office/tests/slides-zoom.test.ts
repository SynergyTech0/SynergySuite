// Morph transition and zoom: pairing objects between slides, zoom ranges in
// the slide show, summary zoom, and the .pptx / .odp round trips (morph as
// PowerPoint's p159:morph with a fade fallback; zooms as slide-jump pictures).
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { ShapeEl, Slide, TextEl, ZoomEl } from "../lib/slides/model";
import { morphFrames, morphPairs, summaryZoom, zoomGrid, zoomRange } from "../lib/slides/morph";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [], ...extra });

test("morph pairs objects by id, then content, then kind", () => {
  const a: Slide = slide("a", {
    layout: "titleOnly",
    title: "Hello",
    elements: [
      { id: "x", z: 1, type: "shape", shape: "rect", x: 0, y: 0, w: 100, h: 100 } as ShapeEl,
      { id: "t1", z: 2, type: "text", x: 10, y: 10, w: 100, h: 40, html: "<p>Same words</p>" } as TextEl,
      { id: "o1", z: 3, type: "shape", shape: "ellipse", x: 500, y: 500, w: 50, h: 50 } as ShapeEl,
      { id: "gone", z: 4, type: "shape", shape: "triangle", x: 0, y: 0, w: 10, h: 10 } as ShapeEl,
    ],
  });
  const b: Slide = slide("b", {
    layout: "titleOnly",
    title: "Hello again",
    elements: [
      { id: "x", z: 1, type: "shape", shape: "rect", x: 200, y: 100, w: 200, h: 50, rot: 90 } as ShapeEl,
      { id: "t2", z: 2, type: "text", x: 600, y: 300, w: 100, h: 40, html: "<p>Same words</p>" } as TextEl,
      { id: "o2", z: 3, type: "shape", shape: "ellipse", x: 100, y: 100, w: 150, h: 150, html: "<p>new</p>" } as ShapeEl,
      { id: "new", z: 4, type: "shape", shape: "star5", x: 0, y: 0, w: 10, h: 10 } as ShapeEl,
    ],
  });
  const pairs = morphPairs(a, b, 1280, 720);
  const by = Object.fromEntries(pairs.map((p) => [p.to, p.from]));
  assert.equal(by.title, "title");
  assert.equal(by.x, "x");
  assert.equal(by.t2, "t1");
  assert.equal(by.o2, "o1");
  assert.equal(by.new, undefined);
  const fx = morphFrames(pairs.find((p) => p.to === "x")!);
  // from the old centre (50,50) to the new one (300,125), half as wide, twice as tall, turned back 90°
  assert.deepEqual(fx[0], { translate: "-250px -75px", scale: "0.5 2", rotate: "-90deg" });
  assert.deepEqual(fx[1], { translate: "0px 0px", scale: "1 1", rotate: "0deg" });
});

test("zoom ranges: a slide, or the section it starts, over visible slides", () => {
  const slides = [slide("s0"), slide("s1", { sec: "Intro" }), slide("s2"), slide("s3", { hidden: true }), slide("s4", { sec: "Main" }), slide("s5")];
  const visible = slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0); // [0,1,2,4,5]
  assert.deepEqual(zoomRange(slides, visible, "s1", "section"), { start: 1, end: 2 });
  assert.deepEqual(zoomRange(slides, visible, "s4", "section"), { start: 3, end: 4 });
  assert.deepEqual(zoomRange(slides, visible, "s2", "slide"), { start: 2, end: 2 });
  assert.equal(zoomRange(slides, visible, "s3", "slide"), null);
  assert.equal(zoomRange(slides, visible, "nope", "slide"), null);
  // a slide that does not start a section zooms to just itself
  assert.deepEqual(zoomRange(slides, visible, "s5", "section"), { start: 4, end: 4 });
});

test("summary zoom: sections for the picked slides and a grid of section zooms", () => {
  const slides = [slide("a", { title: "Cover" }), slide("b", { title: "Plan" }), slide("c", { title: "Results" }), slide("d")];
  let n = 0;
  const r = summaryZoom(slides, ["c", "b"], 1280, 720, (p) => `${p}${n++}`)!;
  assert.equal(r.at, 1);
  assert.deepEqual(r.sections, [{ index: 1, name: "Plan" }, { index: 2, name: "Results" }]);
  const zs = r.slide.elements as ZoomEl[];
  assert.deepEqual(zs.map((z) => [z.kind, z.target, z.ret]), [["section", "b", true], ["section", "c", true]]);
  assert.equal(r.slide.title, "Summary");
  // the grid stays inside the slide, below the title, without overlaps
  const boxes = zoomGrid(7, 1280, 720);
  for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 187 && b.x + b.w <= 1280 && b.y + b.h <= 720, JSON.stringify(b));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const p = boxes[i], q = boxes[j];
    assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, "overlap");
  }
});

test("morph and zooms round-trip through .pptx", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const z1: ZoomEl = { id: "zm1", z: 1, type: "zoom", kind: "slide", target: "s3", x: 100, y: 200, w: 320, h: 180 };
  const z2: ZoomEl = { id: "zm2", z: 2, type: "zoom", kind: "section", target: "s2", ret: true, border: false, x: 500, y: 200, w: 320, h: 180 };
  const slides: Slide[] = [
    slide("s1", { layout: "titleOnly", title: "Zooms", elements: [z1, z2] }),
    slide("s2", { layout: "titleOnly", title: "Two", sec: "Part" , trans: { type: "morph", dur: 1200 } }),
    slide("s3", { layout: "titleOnly", title: "Three" }),
  ];
  const buf = await buildPptx(slides, { name: "z", w: 1280, h: 720, theme: "plain", zoomThumbs: { zm1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==" } });
  const zip = await JSZip.loadAsync(buf);
  const x1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(x1, /<a:hlinkClick r:id="(rId\d+)"[^>]*action="ppaction:\/\/hlinksldjump"/);
  // PowerPoint's own zoom objects, with the pictures as their fallbacks
  const { creationId } = await import("../lib/slides/pptx-export");
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const sid3 = [...pres.matchAll(/<p:sldId [^>]*id="(\d+)"/g)][2][1];
  assert.match(x1, new RegExp(`<mc:Choice xmlns:pslz="http://schemas.microsoft.com/office/powerpoint/2016/slidezoom" Requires="pslz"><p:graphicFrame>[\\s\\S]*<pslz:sldZmObj sldId="${sid3}" cId="${creationId("s3")}"><pslz:zmPr id="\\{[0-9A-F-]+\\}" returnToParent="0"`));
  assert.match(await zip.file("ppt/slides/slide3.xml")!.async("string"), new RegExp(`<p14:creationId [^>]*val="${creationId("s3")}"/></p:ext></p:extLst></p:sld>`));
  const secId = /<p14:section name="Part" id="(\{[^"]+\})"/.exec(pres)![1];
  assert.match(x1, new RegExp(`<psez:sectionZmObj sectionId="${secId.replace(/[{}]/g, "\\$&")}"><psez:zmPr [^>]*returnToParent="1"`));
  assert.equal((x1.match(/<mc:Fallback><p:pic>/g) || []).length, 2);
  // checked against the [MS-PPTX] slide and section zoom schemas
  const { schemaProblems, ruledElements } = await import("./fixtures/ooxml-check.mts");
  assert.deepEqual(schemaProblems(x1), []);
  assert.ok(ruledElements(x1) >= 6);
  assert.equal(new DOMParser().parseFromString(x1, "application/xml").getElementsByTagName("parsererror").length, 0);
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.match(rels, /Target="(\.\.\/slides\/)?slide3\.xml"/);
  const x2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
  assert.match(x2, /<mc:Choice xmlns:p159="[^"]+" Requires="p159"><p:transition [^>]*p14:dur="1200"><p159:morph option="byObject"\/><\/p:transition><\/mc:Choice><mc:Fallback><p:transition[^>]*><p:fade\/>/);
  // the slide XML stays well-formed
  const doc = new DOMParser().parseFromString(x2, "application/xml");
  assert.equal(doc.getElementsByTagName("parsererror").length, 0);

  const deck = await importPptx(buf);
  assert.equal(deck.slides[1].trans?.type, "morph");
  assert.equal(deck.slides[1].trans?.dur, 1200);
  const zs = deck.slides[0].elements.filter((e): e is ZoomEl => e.type === "zoom");
  assert.equal(zs.length, 2);
  const a = zs.find((z) => z.id === "zm1")!, b = zs.find((z) => z.id === "zm2")!;
  assert.equal(a.kind, "slide");
  assert.equal(a.target, deck.slides[2].id);
  assert.equal(a.ret, undefined);
  assert.equal(b.kind, "section");
  assert.equal(b.target, deck.slides[1].id);
  assert.equal(b.ret, true);
  assert.equal(b.border, false);
  assert.ok(Math.abs(a.x - 100) < 1.5 && Math.abs(a.w - 320) < 1.5);
});

test("PowerPoint's own zooms import from their fallback pictures", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  // start from one of ours, then make it look like PowerPoint's: an image wrapped in a zoom AlternateContent, no SynergyZooms
  const z: ZoomEl = { id: "zm", z: 1, type: "zoom", kind: "slide", target: "s2", x: 100, y: 100, w: 320, h: 180 };
  const buf = await buildPptx([slide("s1", { elements: [z] }), slide("s2", { layout: "titleOnly", title: "Target" })], { name: "z", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(buf);
  const p = "ppt/slides/slide1.xml";
  let xml = await zip.file(p)!.async("string");
  const pic = /<p:pic>[\s\S]*?<\/p:pic>/.exec(xml)![0];
  const choice = `<mc:Choice xmlns:psez="http://schemas.microsoft.com/office/powerpoint/2015/10/main" Requires="psez"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Section Zoom 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/powerpoint/2016/sectionzoom"><psez:sectionZm><psez:sectionZmObj sectionId="{X}"><psez:zmPr returnToParent="1"/></psez:sectionZmObj></psez:sectionZm></a:graphicData></a:graphic></p:graphicFrame></mc:Choice>`;
  xml = xml.replace(pic, `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${choice}<mc:Fallback>${pic.replace(/name="syn-el-zm"/, 'name="Section Zoom 1"')}</mc:Fallback></mc:AlternateContent>`);
  zip.file(p, xml);
  const custom = (await zip.file("docProps/custom.xml")!.async("string")).replace(/<property[^>]*name="SynergyZooms"[\s\S]*?<\/property>/, "");
  zip.file("docProps/custom.xml", custom);
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const zs = deck.slides[0].elements.filter((e): e is ZoomEl => e.type === "zoom");
  assert.equal(zs.length, 1);
  assert.equal(zs[0].kind, "section");
  assert.equal(zs[0].ret, true);
  assert.equal(zs[0].target, deck.slides[1].id);
});

test("zooms round-trip through .odp with a click action LibreOffice follows", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const z: ZoomEl = { id: "zm", z: 1, type: "zoom", kind: "section", target: "s2", ret: true, x: 100, y: 100, w: 320, h: 180 };
  const { data } = await buildOdp([slide("s1", { title: "One", layout: "titleOnly", elements: [z] }), slide("s2", { layout: "titleOnly", title: "Target", sec: "Part" })], { name: "z", w: 1280, h: 720, theme: "plain" });
  const content = await (await JSZip.loadAsync(data)).file("content.xml")!.async("string");
  assert.match(content, /presentation:action="show" xlink:href="#Target"/);
  const deck = await importOdp(data);
  const zs = deck.slides[0].elements.filter((e): e is ZoomEl => e.type === "zoom");
  assert.equal(zs.length, 1);
  assert.deepEqual([zs[0].kind, zs[0].target, zs[0].ret], ["section", "s2", true]);
});
