// WordArt text effects, text columns and editing a freeform's points.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { patchShapeXml, wordArtCss } from "../lib/slides/effects";
import { deleteVertex, insertVertex, pathPoints, refit, setPoint } from "../lib/slides/freeform";
import { WORDART_PRESETS, type ShapeEl, type Slide, type TextEl, type WordArt } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const WA: WordArt = {
  stroke: { c: "1F2430", w: 1.5 },
  grad: { kind: "linear", angle: 90, stops: [{ pos: 0, color: "F7D774" }, { pos: 100, color: "8A5A12" }] },
  shadow: { color: "000000", blur: 4, dist: 3, dir: 45, alpha: 0.5 },
  glow: { c: "FFC000", r: 8 },
};

test("wordArtCss draws outlines, glows and gradient-filled letters", () => {
  assert.deepEqual(wordArtCss(undefined), {});
  const o = wordArtCss({ stroke: { c: "112233", w: 2 }, glow: { c: "FFC000", r: 8 } });
  assert.equal(o.WebkitTextStroke, "2px #112233");
  assert.match(o.textShadow || "", /0 0 8px #FFC000/);
  const g = wordArtCss(WA);
  assert.equal(g.WebkitTextFillColor, "transparent");
  assert.match(g.backgroundImage || "", /^linear-gradient\(180deg/);
  assert.match(g.filter || "", /^drop-shadow\(/);
  assert.equal(g.textShadow, undefined);
  // a bad colour is ignored, not passed to CSS
  assert.deepEqual(wordArtCss({ stroke: { c: "red;x", w: 1 } }), {});
  assert.ok(WORDART_PRESETS.every((p) => p.id === "none" || Object.keys(wordArtCss(p.wa!)).length > 0));
});

test("patchShapeXml writes columns and run effects", () => {
  const sp = '<p:sp><p:spPr/><p:txBody><a:bodyPr wrap="square"/><a:p><a:r><a:rPr lang="en-US" sz="2400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Hi</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t>!</a:t></a:r></a:p></p:txBody></p:sp>';
  const out = patchShapeXml(sp, { cols: 2, colGap: 24, wa: WA });
  assert.match(out, /<a:bodyPr[^>]*numCol="2"/);
  assert.match(out, /<a:bodyPr[^>]*spcCol="228600"/);
  assert.equal((out.match(/<a:ln w="14288"><a:solidFill><a:srgbClr val="1F2430"/g) || []).length, 2);
  assert.equal((out.match(/<a:gradFill/g) || []).length, 2);
  assert.doesNotMatch(out, /val="000000"\/><\/a:solidFill><a:latin/);
  assert.match(out, /<a:effectLst><a:glow rad="76200"><a:srgbClr val="FFC000"/);
  assert.match(out, /<a:outerShdw /);
  // run properties keep the order the schema wants: ln, fill, effects, then fonts
  assert.match(out, /<a:ln [^]*?<\/a:ln><a:gradFill[^]*?<\/a:gradFill><a:effectLst>[^]*?<\/a:effectLst><a:latin/);
});

test("WordArt and text columns survive .pptx export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const text: TextEl = { id: "t", type: "text", x: 100, y: 100, w: 600, h: 200, z: 1, html: "<p>Big words</p>", wa: WA, cols: 3, colGap: 30 };
  const box: ShapeEl = { id: "b", type: "shape", shape: "rect", x: 100, y: 400, w: 400, h: 200, z: 2, fill: "DDEEFF", line: null, html: "<p>In a box</p>", wa: { stroke: { c: "FF0000", w: 1 } } };
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [text, box] };
  const bytes = await buildPptx([s], { name: "wa", w: 1280, h: 720, theme: "plain" });
  const xml = await (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /numCol="3"/);
  const deck = await importPptx(bytes);
  const els = deck.slides[0].elements;
  const t = els.find((e) => e.type === "text" && /Big words/.test(e.html));
  const b = els.find((e) => e.type === "shape" && e.shape === "rect");
  assert.ok(t?.type === "text" && b?.type === "shape");
  assert.equal(t.cols, 3);
  assert.ok(Math.abs((t.colGap || 0) - 30) < 0.5);
  assert.deepEqual(t.wa?.stroke, WA.stroke);
  assert.deepEqual(t.wa?.grad, WA.grad);
  assert.deepEqual(t.wa?.glow, WA.glow);
  assert.deepEqual(t.wa?.shadow, WA.shadow);
  assert.deepEqual(b.wa, { stroke: { c: "FF0000", w: 1 } });
  assert.equal(b.cols, undefined);
});

test("WordArt, columns, alt text and decorative marks survive .odp", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const text: TextEl = { id: "t", type: "text", x: 100, y: 100, w: 600, h: 200, z: 1, html: "<p>Columns</p>", wa: WA, cols: 2, colGap: 20, alt: "A heading" };
  const deco: ShapeEl = { id: "d", type: "shape", shape: "ellipse", x: 900, y: 100, w: 100, h: 100, z: 2, fill: "FFC000", deco: true };
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [text, deco] };
  const { data } = await buildOdp([s], { name: "wa", w: 1280, h: 720, theme: "plain" });
  const content = await (await JSZip.loadAsync(data)).file("content.xml")!.async("string");
  assert.match(content, /fo:column-count="2"/);
  const deck = await importOdp(data);
  const els = deck.slides[0].elements;
  const t = els.find((e) => e.type === "text");
  const d = els.find((e) => e.type === "shape" && e.shape === "ellipse");
  assert.ok(t?.type === "text" && d);
  assert.equal(t.cols, 2);
  assert.equal(t.colGap, 20);
  assert.deepEqual(t.wa, WA);
  assert.equal(t.alt, "A heading");
  assert.equal(d.deco, true);
});

test("freeform points can be moved, added and deleted, then refitted", () => {
  const g = { w: 100, h: 100, d: "M0 0 L100 0 L100 100 L0 100 Z" };
  assert.equal(pathPoints(g).length, 4);
  // move the third corner out of the box, then refit
  const moved = setPoint(g, 2, 0, 150, 120);
  assert.deepEqual(pathPoints(moved)[2], { cmd: 2, pair: 0, x: 150, y: 120, ctrl: false });
  const fit = refit(moved, { x: 10, y: 20, w: 200, h: 200 });
  assert.deepEqual(fit.geom, { w: 150, h: 120, d: fit.geom.d });
  assert.deepEqual(fit.box, { x: 10, y: 20, w: 300, h: 240 });
  // a point halfway along the top edge
  const ins = insertVertex(g, 1);
  assert.deepEqual(pathPoints(ins).map((p) => [p.x, p.y]), [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]);
  // deleting the first point makes the next one start the path
  const del = deleteVertex(g, 0)!;
  assert.deepEqual(pathPoints(del).map((p) => [p.x, p.y]), [[100, 0], [100, 100], [0, 100]]);
  // a closed shape keeps at least three points
  assert.equal(deleteVertex(del, 1), null);
  // splitting a curve keeps its ends; dragging an anchor carries its handles
  const c = { w: 100, h: 100, d: "M0 0 C0 50 50 100 100 100" };
  const split = insertVertex(c, 1);
  const pts = pathPoints(split);
  assert.equal(pts.filter((p) => !p.ctrl).length, 3);
  assert.deepEqual([pts.at(-1)!.x, pts.at(-1)!.y], [100, 100]);
  const dragged = pathPoints(setPoint(c, 1, 2, 90, 110));
  assert.deepEqual([dragged[2].x, dragged[2].y], [40, 110]);
});
