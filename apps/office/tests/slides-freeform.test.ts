// Freeform shapes (pen strokes, custGeom import/export) and slide resizing.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { custGeomXml, parseD, readCustGeom, scaledD, simplify, strokeToFreeform } from "../lib/slides/freeform";
import { resizeTransform, type Slide } from "../lib/slides/model";
import { parseXml } from "../lib/slides/xml";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

test("a pen stroke becomes a smoothed path in its own box; a loop closes", () => {
  const line = Array.from({ length: 21 }, (_, i) => ({ x: 100 + i * 10, y: 200 + (i % 2) * 0.5 }));
  assert.equal(simplify(line, 1.5).length, 2);
  const f = strokeToFreeform(line)!;
  assert.deepEqual(f.box, { x: 100, y: 200, w: 200, h: 1 });
  assert.equal(f.closed, false);
  assert.match(f.geom.d, /^M0 0 L200 0$/);
  const circle = Array.from({ length: 37 }, (_, i) => ({ x: 300 + 50 * Math.cos((i * Math.PI) / 18), y: 300 + 50 * Math.sin((i * Math.PI) / 18) }));
  const c = strokeToFreeform(circle)!;
  assert.equal(c.closed, true);
  assert.match(c.geom.d, /Z$/);
  assert.ok(Math.abs(c.box.w - 100) < 1 && Math.abs(c.box.h - 100) < 1);
  assert.ok(parseD(c.geom.d).filter((x) => x.c === "C").length > 4);
  assert.equal(scaledD({ w: 10, h: 10, d: "M0 0 L10 5 Z" }, 20, 40), "M0 0 L20 20 Z");
});

test("custGeom XML round-trips, including arcs from other writers", () => {
  const g = { w: 200, h: 100, d: "M0 0 L200 0 C150 50 50 50 0 100 Q20 20 0 0 Z" };
  const xml = custGeomXml(g);
  const el = parseXml(`<a:custGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml.slice("<a:custGeom>".length)}`);
  assert.deepEqual(readCustGeom(el, 200, 100), g);
  // a half circle drawn with arcTo in EMU
  const arc = parseXml(`<a:custGeom xmlns:a="a"><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="500"/></a:moveTo><a:arcTo wR="500" hR="500" stAng="10800000" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom>`);
  const r = readCustGeom(arc, 100, 100)!;
  const pts = parseD(r.d);
  const last = pts[pts.length - 2].p;
  assert.ok(Math.abs(last[0] - 100) < 0.01 && Math.abs(last[1] - 50) < 0.01, `arc ends at the right edge: ${last}`);
});

test("freeforms export as custGeom and import as editable freeforms", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const geom = { w: 300, h: 150, d: "M0 150 C100 0 200 0 300 150 Z" };
  const s: Slide = {
    id: "s", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "",
    elements: [
      { id: "f", type: "shape", shape: "freeform", geom, fill: "FF0000", line: "000000", lineW: 3, grad: { kind: "linear", angle: 0, stops: [{ pos: 0, color: "FF0000" }, { pos: 100, color: "0000FF" }] }, x: 100, y: 100, w: 300, h: 150, z: 1 },
      { id: "o", type: "shape", shape: "freeform", geom: { w: 100, h: 50, d: "M0 0 L50 50 L100 0" }, fill: null, line: "00AA00", lineW: 3, x: 500, y: 100, w: 100, h: 50, z: 2 },
    ],
  };
  const out = await buildPptx([s], { name: "f", w: 1280, h: 720, theme: "plain" });
  const xml = await (await JSZip.loadAsync(out)).file("ppt/slides/slide1.xml")!.async("string");
  assert.equal((xml.match(/<a:custGeom>/g) || []).length, 2);
  assert.match(xml, /<\/a:custGeom><a:gradFill/);
  assert.match(xml, /<a:path w="10000" h="5000" fill="none">/);
  const deck = await importPptx(out);
  const [f, o] = deck.slides[0].elements;
  assert.ok(f.type === "shape" && o.type === "shape");
  assert.equal(f.shape, "freeform");
  assert.deepEqual(f.geom, geom);
  assert.equal(f.grad?.stops.length, 2);
  assert.equal(o.fill, null);
  assert.equal(o.line, "00AA00");
  assert.deepEqual(o.geom, { w: 100, h: 50, d: "M0 0 L50 50 L100 0" });
  assert.ok(!deck.warnings.some((w) => /freeform/i.test(w)));
});

test("resizing a deck: stretch, fit (centred) or keep", () => {
  const b = { x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(resizeTransform(1280, 720, 960, 720, "scale")(b), { x: 75, y: 100, w: 150, h: 100 });
  assert.deepEqual(resizeTransform(1280, 720, 960, 720, "fit")(b), { x: 75, y: 165, w: 150, h: 75 });
  assert.deepEqual(resizeTransform(1280, 720, 960, 720, "none")(b), b);
});

test("polygon mode: clicked corners become straight lines, closed when asked", async () => {
  const { polygonToFreeform, pathPoints } = await import("../lib/slides/freeform");
  const f = polygonToFreeform([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 250 }], true)!;
  assert.deepEqual(f.box, { x: 100, y: 100, w: 200, h: 150 });
  assert.equal(f.geom.d, "M0 0 L200 0 L100 150 Z");
  assert.equal(f.closed, true);
  assert.equal(pathPoints(f.geom).length, 3); // every corner editable with Edit Points
  const open = polygonToFreeform([{ x: 0, y: 0 }, { x: 50, y: 20 }], true)!;
  assert.equal(open.closed, false); // two points make a line, not a shape
  assert.equal(polygonToFreeform([{ x: 1, y: 1 }], false), null);
});

test("fit to a new slide size scales text with its boxes", async () => {
  const { scaleHtmlFonts, scaleElementFonts, scaleSlideFonts } = await import("../lib/slides/resize");
  assert.equal(scaleHtmlFonts('<p><span style="font-size: 40pt">Big</span> small</p>', 0.5), '<p><span style="font-size: 20pt">Big</span> small</p>');
  assert.equal(scaleHtmlFonts("<p>Plain</p><p></p>", 0.75), '<p><span style="font-size: 13.5pt">Plain</span></p><p></p>');
  assert.equal(scaleHtmlFonts("<p>Plain</p>", 0.75, null), "<p>Plain</p>");
  const t = scaleElementFonts({ id: "t", z: 1, type: "table", x: 0, y: 0, w: 10, h: 10, rows: [[{ text: "a", html: '<p><span style="font-size: 24px">a</span></p>' }]] }, 0.5);
  assert.equal(t.type === "table" && t.fontSize, 7);
  assert.match(t.type === "table" ? t.rows[0][0].html! : "", /font-size: 9pt/);
  const m = scaleElementFonts({ id: "m", z: 1, type: "math", x: 0, y: 0, w: 10, h: 10, latex: "x" }, 0.5);
  assert.equal(m.type === "math" && m.size, 14);
  const s = { id: "s", title: "T", body: "", notes: "", layout: "title" as const, bg: "", bgImg: "", elements: [] };
  const f = scaleSlideFonts(s, 0.75, { master: { ...s, layout: "content", tstyle: { size: 40 } } }, undefined);
  assert.equal(f.tstyle?.size, 33); // a title slide's 44pt
  assert.equal(f.bstyle?.size, 13.5);
  assert.deepEqual(scaleSlideFonts({ ...s, layout: "content" }, 0.5, {}, "master").tstyle, { size: 16 });
});
