// WordArt Transform (preset text warps): bodyPr placement and round trips.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { firstRunStyle, setBodyWarp, validWarp, warpOf, WARPS } from "../lib/slides/warp";
import type { ShapeEl, Slide, TextEl } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

test("the warp goes first in bodyPr, replaces an old one and none removes it", () => {
  const b = '<a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr>';
  const w = setBodyWarp(b, "textArchUp");
  assert.equal(w, '<a:bodyPr wrap="square"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp><a:normAutofit/></a:bodyPr>');
  assert.match(setBodyWarp(w, "textWave1"), /^<a:bodyPr wrap="square"><a:prstTxWarp prst="textWave1"><a:avLst\/><\/a:prstTxWarp><a:normAutofit\/>/);
  assert.equal(setBodyWarp(w, undefined), b);
  assert.equal(setBodyWarp("<a:bodyPr/>", "textCircle"), '<a:bodyPr><a:prstTxWarp prst="textCircle"><a:avLst/></a:prstTxWarp></a:bodyPr>');
  assert.equal(setBodyWarp("<a:bodyPr/>", "bogus"), "<a:bodyPr/>");
  assert.ok(validWarp("textCascadeUp") && !validWarp("textPlain") && !validWarp("x"));
  for (const k of WARPS) assert.ok(validWarp(k.id) && (k.path || k.css), k.id);
  assert.equal(warpOf("textCascadeUp"), undefined);
  assert.deepEqual(firstRunStyle('<p><span style="font-size: 36pt; color: #ff0000">Hi</span></p>'), { px: 48, color: "FF0000", bold: false, italic: false });
  assert.equal(firstRunStyle("<b>Hi</b>").bold, true);
});

test("warps survive .pptx and .odp", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const t: TextEl = { id: "t", z: 1, type: "text", html: "<p>Arched words</p>", x: 10, y: 10, w: 400, h: 120, warp: "textArchUp" };
  const s: ShapeEl = { id: "s", z: 2, type: "shape", shape: "rect", fill: "FFCC00", line: null, html: "<p>Wavy</p>", x: 500, y: 10, w: 300, h: 150, warp: "textWave1" };
  const deck: Slide[] = [{ id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [t, s] }];
  const meta = { name: "w", w: 1280, h: 720, theme: "plain" };
  const check = (sl: Slide) => {
    const tx = sl.elements.find((e) => e.type === "text") as TextEl;
    const sh = sl.elements.find((e) => e.type === "shape") as ShapeEl;
    assert.equal(tx.warp, "textArchUp");
    assert.equal(sh.warp, "textWave1");
  };
  check((await importPptx(await buildPptx(deck, meta))).slides[0]);
  check((await importOdp((await buildOdp(deck, meta)).data)).slides[0]);
});
