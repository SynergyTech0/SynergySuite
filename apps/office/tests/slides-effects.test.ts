// Gradient fills, shadows and picture crops: CSS helpers and the .pptx round trip.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { cropBox, gradientCss, gradientVector, patchShapeXml, shadowCss, shadowOffset } from "../lib/slides/effects";
import type { Gradient, Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
const G: Gradient = { kind: "linear", angle: 90, stops: [{ pos: 0, color: "FF0000" }, { pos: 100, color: "0000FF" }] };

test("gradient and shadow CSS follow the OOXML angles", () => {
  assert.equal(gradientCss(G), "linear-gradient(180deg, #FF0000 0%, #0000FF 100%)");
  assert.match(gradientCss({ ...G, kind: "radial" }), /^radial-gradient\(circle/);
  assert.deepEqual(gradientVector(0), { x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
  assert.deepEqual(shadowOffset({ color: "000000", blur: 4, dist: 10, dir: 90, alpha: 0.5 }), { dx: 0, dy: 10 });
  assert.equal(shadowCss({ color: "102030", blur: 4, dist: 10, dir: 0, alpha: 0.5 }), "drop-shadow(10px 0px 2px rgba(16, 32, 48, 0.5))");
  assert.deepEqual(cropBox({ l: 0.25, t: 0, r: 0.25, b: 0.5 }), { left: "-50%", top: "0%", width: "200%", height: "200%" });
});

test("patchShapeXml swaps the solid fill for a gradient and keeps the outline", () => {
  const sp = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="syn-el-a"/></p:nvSpPr><p:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln></p:spPr></p:sp>';
  const out = patchShapeXml(sp, { grad: G, shadow: { color: "000000", blur: 5, dist: 4, dir: 45, alpha: 0.4 } });
  assert.match(out, /<\/a:prstGeom><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">/);
  assert.match(out, /<a:lin ang="5400000" scaled="0"\/>/);
  assert.match(out, /<a:ln><a:solidFill><a:srgbClr val="00FF00"\/>/);
  assert.match(out, /<\/a:ln><a:effectLst><a:outerShdw blurRad="47625" dist="38100" dir="2700000"/);
  assert.doesNotMatch(out, /val="FF0000"\/><\/a:solidFill><a:ln/);
});

test("gradients, shadows, crops and gradient backgrounds survive export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const shadow = { color: "202020", blur: 6, dist: 5, dir: 45, alpha: 0.35 };
  const s: Slide = {
    id: "s1", title: "Effects", body: "", notes: "", layout: "titleOnly", bg: "112233", bgImg: "",
    bgGrad: { kind: "linear", angle: 45, stops: [{ pos: 0, color: "112233" }, { pos: 100, color: "445566" }] },
    elements: [
      { id: "g", type: "shape", shape: "roundRect", fill: "FF0000", grad: G, line: null, shadow, x: 100, y: 150, w: 300, h: 200, z: 1 },
      { id: "r", type: "shape", shape: "ellipse", fill: "00FF00", grad: { kind: "radial", angle: 0, stops: [{ pos: 0, color: "FFFFFF" }, { pos: 60, color: "00FF00" }, { pos: 100, color: "003300" }] }, line: "000000", x: 450, y: 150, w: 200, h: 200, z: 2 },
      { id: "p", type: "image", src: PNG, crop: { l: 0.1, t: 0.2, r: 0.05, b: 0 }, shadow, x: 700, y: 150, w: 200, h: 160, z: 3 },
    ],
  };
  const bytes = await buildPptx([s], { name: "fx", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<p:bg><p:bgPr><a:gradFill/);
  assert.match(xml, /<a:srcRect l="10000" t="20000" r="5000" b="0"\/>/);
  assert.equal((xml.match(/<a:outerShdw/g) || []).length, 2);

  const deck = await importPptx(bytes);
  const t = deck.slides[0];
  assert.deepEqual(t.bgGrad, s.bgGrad);
  const g = t.elements.find((e) => e.type === "shape" && e.shape === "roundRect");
  const r = t.elements.find((e) => e.type === "shape" && e.shape === "ellipse");
  const p = t.elements.find((e) => e.type === "image");
  assert.ok(g?.type === "shape" && r?.type === "shape" && p?.type === "image");
  assert.deepEqual(g.grad, G);
  assert.deepEqual(g.shadow, shadow);
  assert.equal(r.grad?.kind, "radial");
  assert.deepEqual(r.grad?.stops.map((x) => x.pos), [0, 60, 100]);
  assert.equal(r.line, "000000");
  assert.deepEqual(p.crop, { l: 0.1, t: 0.2, r: 0.05, b: 0 });
  assert.deepEqual(p.shadow, shadow);
});

test("multi-stop gradients: a stop added on the bar takes the colour already there; all stops round-trip", async () => {
  const { colorAt } = await import("../lib/slides/effects");
  const stops = [{ pos: 0, color: "000000" }, { pos: 50, color: "FF0000" }, { pos: 100, color: "FFFFFF" }];
  assert.equal(colorAt(stops, 25), "800000");
  assert.equal(colorAt(stops, 75), "FF8080");
  assert.equal(colorAt([...stops].reverse(), 50), "FF0000");
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const grad = { kind: "linear" as const, angle: 30, stops: [{ pos: 0, color: "112233" }, { pos: 30, color: "445566" }, { pos: 60, color: "778899" }, { pos: 100, color: "AABBCC" }] };
  const s = { id: "s1", title: "", body: "", notes: "", layout: "blank" as const, bg: "", bgImg: "", elements: [{ id: "g", z: 1, type: "shape" as const, shape: "rect" as const, x: 10, y: 10, w: 200, h: 100, fill: "112233", grad }] };
  const back = await importPptx(await buildPptx([s as never], { name: "g", w: 1280, h: 720, theme: "plain" }));
  const el = back.slides[0].elements[0] as { grad?: typeof grad };
  assert.deepEqual(el.grad?.stops, grad.stops);
});
