// Translucent fills: drawing, .pptx and .odp round trips, and contrast.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { patchShapeXml } from "../lib/slides/effects";
import { blend } from "../lib/slides/a11y";
import type { ShapeEl, Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const G = { kind: "linear" as const, angle: 0, stops: [{ pos: 0, color: "FF0000" }, { pos: 100, color: "0000FF" }] };
const deck = (els: ShapeEl[]): Slide[] => [{ id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: els }];

test("fill transparency goes on the fill's colours, not the outline's", () => {
  const sp = '<p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln></p:spPr></p:sp>';
  const out = patchShapeXml(sp, { fillA: 0.25 });
  assert.match(out, /<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="25000"\/><\/a:srgbClr><\/a:solidFill><a:ln><a:solidFill><a:srgbClr val="00FF00"\/>/);
  const g = patchShapeXml(sp, { grad: G, fillA: 0.5 });
  assert.equal((g.match(/<a:alpha val="50000"\/>/g) || []).length, 2);
  assert.equal(blend("000000", "FFFFFF", 0.5), "808080");
});

test("translucent solid and gradient fills survive .pptx and .odp", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const els: ShapeEl[] = [
    { id: "a", z: 1, type: "shape", shape: "rect", fill: "FF0000", fillA: 0.4, line: null, x: 10, y: 10, w: 100, h: 100 },
    { id: "b", z: 2, type: "shape", shape: "ellipse", fill: "FF0000", grad: G, fillA: 0.7, line: "000000", x: 200, y: 10, w: 100, h: 100 },
    { id: "c", z: 3, type: "shape", shape: "rect", fill: "00FF00", line: null, x: 400, y: 10, w: 100, h: 100 },
  ];
  const p = await importPptx(await buildPptx(deck(els), { name: "f", w: 1280, h: 720, theme: "plain" }));
  const byShape = (d: Slide, s: string, f?: string) => d.elements.find((e) => e.type === "shape" && e.shape === s && (!f || e.fill === f)) as ShapeEl;
  assert.equal(byShape(p.slides[0], "rect", "FF0000").fillA, 0.4);
  assert.equal(byShape(p.slides[0], "ellipse").fillA, 0.7);
  assert.equal(byShape(p.slides[0], "rect", "00FF00").fillA, undefined);
  const zip = await JSZip.loadAsync((await buildOdp(deck(els), { name: "f", w: 1280, h: 720, theme: "plain" })).data);
  assert.match(await zip.file("content.xml")!.async("string"), /draw:opacity="40%"/);
  const o = await importOdp((await buildOdp(deck(els), { name: "f", w: 1280, h: 720, theme: "plain" })).data);
  assert.equal(byShape(o.slides[0], "rect", "FF0000").fillA, 0.4);
  assert.equal(byShape(o.slides[0], "ellipse").fillA, 0.7);
});
