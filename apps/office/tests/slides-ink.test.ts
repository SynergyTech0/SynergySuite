// Ink in .pptx: pen and highlighter strokes written as PowerPoint ink (a p14
// content part with an InkML part, the freeform as fallback) and read back,
// including ink PowerPoint wrote with InkML's difference encoding.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { strokeToFreeform } from "../lib/slides/freeform";
import { readInkml, inkToFreeforms } from "../lib/slides/pptx-ink";
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

const stroke = (id: string, hl: boolean): ShapeEl => {
  const pts = Array.from({ length: 20 }, (_, k) => ({ x: 200 + k * 20, y: 300 + Math.sin(k / 3) * 40 }));
  const f = strokeToFreeform(pts, 0)!;
  return { id, z: 1, type: "shape", shape: "freeform", geom: f.geom, fill: null, line: hl ? "FFFF00" : "C00000", lineW: hl ? 22 : 4, ink: hl ? "hl" : "pen", ...(hl ? { lineA: 0.4 } : {}), ...f.box };
};

test("ink is written as PowerPoint ink with the freeform as fallback, and read back", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { schemaProblems, ruledElements } = await import("./fixtures/ooxml-check.mts");
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [stroke("i1", false), { ...stroke("i2", true), z: 2 }] };
  const bytes = await buildPptx([s], { name: "ink", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<mc:Choice xmlns:p14="http:\/\/schemas.microsoft.com\/office\/powerpoint\/2010\/main" Requires="p14"><p:contentPart p14:bwMode="auto" r:id="rIdSynInk1"><p14:nvContentPartPr><p14:cNvPr id="\d+" name="syn-el-i1"\/>/);
  assert.match(xml, /<\/p:contentPart><\/mc:Choice><mc:Fallback><p:sp>/);
  assert.deepEqual(schemaProblems(xml), []);
  assert.ok(ruledElements(xml) >= 8);
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.match(rels, /Id="rIdSynInk1" Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/customXml" Target="\.\.\/ink\/ink1\.xml"/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /PartName="\/ppt\/ink\/ink1\.xml" ContentType="application\/inkml\+xml"/);
  const ink2 = await zip.file("ppt/ink/ink2.xml")!.async("string");
  assert.match(ink2, /<inkml:brushProperty name="color" value="#FFFF00"\/><inkml:brushProperty name="tip" value="rectangle"\/>/);
  assert.equal(new DOMParser().parseFromString(ink2, "application/xml").getElementsByTagName("parsererror").length, 0);

  const back = await importPptx(bytes);
  const [a, b] = back.slides[0].elements as ShapeEl[];
  assert.equal(a.id, "i1");
  assert.equal(a.ink, "pen");
  assert.equal(a.line, "C00000");
  assert.ok(Math.abs(a.lineW! - 4) < 0.05, String(a.lineW));
  assert.ok(Math.abs(a.x - s.elements[0].x) < 2 && Math.abs(a.w - s.elements[0].w) < 4, JSON.stringify([a.x, a.w, s.elements[0].x, s.elements[0].w]));
  assert.equal(b.ink, "hl");
  assert.equal(b.lineA, 0.4);
});

test("InkML difference encoding (as PowerPoint writes traces) and brush units", () => {
  const xml = `<ink xmlns="http://www.w3.org/2003/InkML"><definitions><brush xml:id="b"><brushProperty name="width" value="1" units="mm"/><brushProperty name="color" value="#00ff00"/></brush></definitions><trace brushRef="#b">1000 2000, '10 '20, "5 "5, 3 4</trace></ink>`;
  const [s] = readInkml(xml);
  // absolute, a first difference, then second differences (a prefix holds for the values after it)
  assert.deepEqual(s.pts, [{ x: 1000, y: 2000 }, { x: 1010, y: 2020 }, { x: 1025, y: 2045 }, { x: 1043, y: 2074 }]);
  assert.equal(s.color, "00FF00");
  assert.ok(Math.abs(s.width - 0.1) < 1e-9);
  const ff = inkToFreeforms([s], { x: 10, y: 10, w: 100, h: 50 });
  assert.equal(ff.length, 1);
  assert.ok(ff[0].box.x >= 9.9 && ff[0].box.x + ff[0].box.w <= 110.2);
});
