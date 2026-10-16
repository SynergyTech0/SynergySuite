// Icons (SVG -> freeform paths), equations (LaTeX <-> MathML/OMML, .pptx round
// trip), SmartArt-style diagrams and the format painter.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { arcToCubics, normalizePath, shapeToPath } from "../lib/slides/svgpath";
import { ICON_SETS, iconGeom, searchIcons } from "../lib/slides/icons";
import { parseD } from "../lib/slides/freeform";
import { MATH_PRESETS, latexToMathml, latexToOmml, ommlToLatex, parseLatex } from "../lib/slides/math";
import { parseXml } from "../lib/slides/xml";
import { buildDiagram, parseOutline } from "../lib/slides/smartart";
import { applyTextFmt, paintFormat, pickFormat, textFmtOf } from "../lib/slides/painter";
import type { MathEl, ShapeEl, Slide, SlideElement } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

test("SVG path data becomes absolute M/L/C/Q/Z; arcs become curves", () => {
  assert.equal(normalizePath("m12 5 7 7-7 7"), "M12 5 L19 12 L12 19");
  assert.equal(normalizePath("M5 12h14v2H5z"), "M5 12 L19 12 L19 14 L5 14 Z");
  assert.equal(normalizePath("M0 0 s10 10 20 0 t10 0"), "M0 0 C0 0 10 10 20 0 Q20 0 30 0");
  // a half circle of radius 10 ends where it should, through the top
  const c = arcToCubics(0, 10, 10, 10, 0, false, true, 20, 10);
  assert.equal(c.length, 2);
  assert.deepEqual(c[1].slice(4), [20, 10]);
  assert.ok(Math.abs(c[0][5] - 0) < 1e-9); // first quarter ends at the top (10, 0)
  // arc flags written without separators
  assert.match(normalizePath("M2 2a2 2 0 012 2"), /^M2 2 C/);
  assert.match(shapeToPath("circle", { cx: 12, cy: 12, r: 10 }), /^M2 12 C.* Z$/);
  assert.match(shapeToPath("rect", { x: 2, y: 3, width: 20, height: 10, rx: 2 }), /^M4 3 L20 3 C/);
  assert.equal(shapeToPath("polyline", { points: "1 2 3 4 5 6" }), "M1 2 L3 4 L5 6");
});

test("every bundled icon converts to a freeform outline", () => {
  const all = ICON_SETS.flatMap((s) => s.icons);
  assert.ok(all.length > 250);
  for (const [name, svg] of all) {
    const g = iconGeom(svg);
    const cmds = parseD(g.d);
    assert.ok(cmds.length > 1, `${name} has a path`);
    assert.equal(cmds[0].c, "M", name);
    for (const c of cmds) for (const v of c.p) assert.ok(v > -2 && v < 26, `${name} stays on its canvas`);
  }
  assert.ok(searchIcons("chart").length >= 4);
});

test("LaTeX renders as MathML and survives an OMML round trip", () => {
  const mml = latexToMathml("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}");
  assert.match(mml, /<mfrac><mrow><mo>−<\/mo><mi>b<\/mi><mo>±<\/mo><msqrt>/);
  assert.match(latexToMathml("\\sum_{i=1}^{n} i"), /<munderover><mo largeop="true" movablelimits="false">∑<\/mo>/);
  assert.match(latexToMathml("\\text{if } x"), /<mtext>if <\/mtext>/);
  assert.deepEqual(parseLatex("\\alpha^2"), { k: "script", base: { k: "i", v: "α" }, sup: { k: "n", v: "2" } });
  const cases = [...MATH_PRESETS.map((p) => p.latex), "\\lim_{x\\to 0}\\frac{\\sin x}{x}=1", "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}", "\\vec{v}\\cdot\\overline{w}", "\\sqrt[3]{x}"];
  for (const l of cases) {
    const o = latexToOmml(l);
    const back = ommlToLatex(parseXml(o));
    assert.equal(latexToOmml(back), o, `${l} -> ${back}`);
  }
  // OMML as other writers save it (defaults left out)
  const word = parseXml(`<m:oMath xmlns:m="m"><m:nary><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>f</m:t></m:r></m:e></m:nary><m:d><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d><m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>θ</m:t></m:r></m:e></m:func></m:oMath>`);
  assert.equal(ommlToLatex(word), "\\int_0^1{f}\\left(x\\right)\\sin\\theta");
});

test("equations round-trip through .pptx as Office Math", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const eq: MathEl = { id: "m1", z: 1, type: "math", latex: "E=mc^{2}", size: 36, color: "C00000", x: 100, y: 100, w: 400, h: 120 };
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [eq] };
  const out = await buildPptx([s], { name: "m", w: 1280, h: 720, theme: "plain" });
  const xml = await (await JSZip.loadAsync(out)).file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<mc:AlternateContent [^>]*><mc:Choice [^>]*Requires="a14"><p:sp>/);
  assert.match(xml, /<a14:m><m:oMathPara xmlns:m="[^"]+"><m:oMathParaPr>/);
  assert.match(xml, /<m:sSup><m:e><m:r><a:rPr lang="en-US" sz="3600" i="1"><a:solidFill><a:srgbClr val="C00000"\/>/);
  assert.match(xml, /<mc:Fallback><p:sp>/);
  const deck = await importPptx(out);
  const back = deck.slides[0].elements[0] as MathEl;
  assert.equal(back.type, "math");
  assert.equal(back.id, "m1");
  assert.equal(back.latex, "E=mc^2");
  assert.equal(back.size, 36);
  assert.equal(back.color, "C00000");
  assert.deepEqual([back.x, back.y, back.w, back.h], [100, 100, 400, 120]);
});

test("equations on the master and on a layout are written as Office Math too", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const blank = (layout: Slide["layout"], elements: Slide["elements"] = []): Slide => ({ id: "", title: "", body: "", notes: "", layout, bg: "", bgImg: "", elements });
  const masters = {
    master: blank("content", [{ id: "mm", z: 1, type: "math", latex: "a^{2}+b^{2}", size: 20, x: 20, y: 640, w: 200, h: 60 } as MathEl]),
    blank: blank("blank", [{ id: "lm", z: 1, type: "math", latex: "\\sqrt{x}", size: 24, x: 1000, y: 20, w: 200, h: 60 } as MathEl]),
  };
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [] };
  const out = await buildPptx([s], { name: "m", w: 1280, h: 720, theme: "plain", masters });
  const zip = await JSZip.loadAsync(out);
  const lay = Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
  const blankLayout = await Promise.all(lay.map((f) => zip.file(f)!.async("string"))).then((xs) => xs.find((x) => x.includes('name="syn-layout-blank"'))!);
  assert.match(blankLayout, /<mc:Choice [^>]*Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="\d+" name="syn-mel-mm"[\s\S]*?<a14:m><m:oMathPara/);
  assert.match(blankLayout, /name="syn-lel-lm"[\s\S]*?<m:rad>/);
  const deck = await importPptx(out);
  const mm = deck.masters?.master?.elements.find((e) => e.id === "mm") as MathEl;
  const lm = deck.masters?.blank?.elements.find((e) => e.id === "lm") as MathEl;
  assert.equal(mm?.type, "math");
  assert.equal(mm.latex, "a^2+b^2");
  assert.equal(lm?.type, "math");
  assert.equal(lm.latex, "\\sqrt{x}");
});

test("diagrams lay out an outline as one group of shapes", () => {
  const items = parseOutline("CEO\n  Sales\n    East\n    West\n  Engineering\n- Board");
  assert.deepEqual(items.map((i) => i.level), [0, 1, 2, 2, 1, 0]);
  const area = { x: 100, y: 100, w: 1000, h: 500 };
  const inside = (e: { x: number; y: number; w: number; h: number }) => e.x >= area.x - 1 && e.y >= area.y - 1 && e.x + e.w <= area.x + area.w + 1 && e.y + e.h <= area.y + area.h + 1;
  for (const kind of ["process", "cycle", "hierarchy", "list", "pyramid"] as const) {
    const els = buildDiagram(kind, items, area, "4472C4", "g1");
    assert.ok(els.length >= 2, kind);
    assert.ok(els.every((e) => e.group === "g1"), kind);
    assert.ok(els.every(inside), `${kind} stays in its area`);
  }
  const org = buildDiagram("hierarchy", items, area, "4472C4", "g1");
  const boxes = org.filter((e) => e.type === "shape" && (e as ShapeEl).shape === "roundRect");
  assert.equal(boxes.length, 6);
  assert.equal(org.filter((e) => (e as ShapeEl).shape === "freeform").length, 2); // CEO and Sales have children
  const proc = buildDiagram("process", parseOutline("A\nB\nC"), area, "4472C4", "g");
  assert.equal(proc.filter((e) => (e as ShapeEl).shape === "rightArrow").length, 2);
});

test("the format painter copies fill, outline, effects and text style", () => {
  const src: ShapeEl = { id: "a", z: 1, type: "shape", shape: "ellipse", x: 0, y: 0, w: 10, h: 10, fill: "FF0000", line: "00FF00", lineW: 3, shadow: { color: "000000", blur: 4, dist: 3, dir: 45, alpha: 0.4 }, html: '<p><strong><span style="color: #0000ff; font-size: 24pt">Hi</span></strong> there</p>' };
  const f = pickFormat(src);
  assert.deepEqual(f.text, { b: true, color: "rgb(0, 0, 255)", size: "24pt" });
  const dst: ShapeEl = { id: "b", z: 2, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, fill: "FFFFFF", html: "<p><em>One</em></p><p>Two</p>" };
  const p = paintFormat(dst, f) as Partial<ShapeEl>;
  assert.equal(p.fill, "FF0000");
  assert.equal(p.line, "00FF00");
  assert.equal(p.lineW, 3);
  assert.deepEqual(p.shadow, src.shadow);
  assert.equal(p.html, '<p><span style="color: rgb(0, 0, 255); font-size: 24pt"><strong>One</strong></span></p><p><span style="color: rgb(0, 0, 255); font-size: 24pt"><strong>Two</strong></span></p>');
  assert.deepEqual(textFmtOf(p.html), { b: true, color: "rgb(0, 0, 255)", size: "24pt" });
  assert.equal(applyTextFmt("<p>x</p>", { i: true }), "<p><em>x</em></p>");
  // a picture only takes the shadow; a table takes bold/colour on its cells
  const img = { id: "i", z: 3, type: "image", src: "", x: 0, y: 0, w: 1, h: 1 } as SlideElement;
  assert.deepEqual(Object.keys(paintFormat(img, f)), ["shadow"]);
  const tbl = { id: "t", z: 4, type: "table", rows: [[{ text: "a" }]], x: 0, y: 0, w: 1, h: 1 } as SlideElement;
  assert.deepEqual((paintFormat(tbl, f) as { rows: unknown }).rows, [[{ text: "a", bold: true, color: "0000FF" }]]);
});
