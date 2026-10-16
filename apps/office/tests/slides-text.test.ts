// Rich text: line/paragraph spacing, hyperlinks, sub/superscript and highlight
// through the exporter, the importer and the sanitizer (with a jsdom document).
import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Slide, TextEl } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const HTML =
  '<p style="line-height: 1.8; margin-top: 6pt; margin-bottom: 12pt">H<sub>2</sub>O and E=mc<sup>2</sup></p>' +
  '<p style="line-height: 24pt"><mark data-color="#ffff00" style="background-color: #ffff00">marked</mark> see <a href="https://example.com/x?a=1&amp;b=2">the site</a></p>';

test("runs carry spacing, baseline, highlight and hyperlink options", async () => {
  const { htmlToPptxRuns } = await import("../lib/slides/pptx-export");
  const runs = htmlToPptxRuns(HTML);
  const by = (t: string) => runs.find((r) => r.text === t)!.options;
  assert.equal(by("H").lineSpacingMultiple, 1.5);
  assert.equal(by("H").paraSpaceBefore, 6);
  assert.equal(by("H").paraSpaceAfter, 12);
  assert.equal(by("2").subscript, true);
  assert.equal(runs.filter((r) => r.text === "2")[1].options.superscript, true);
  assert.equal(by("marked").highlight, "FFFF00");
  assert.equal(by("marked").lineSpacing, 24);
  assert.deepEqual(by("the site").hyperlink, { url: "https://example.com/x?a=1&b=2" });
});

test("rich text survives export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const el: TextEl = { id: "t1", type: "text", html: HTML, x: 50, y: 50, w: 600, h: 200, z: 1 };
  const s: Slide = { id: "s", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [el] };
  const deck = await importPptx(await buildPptx([s], { name: "t", w: 1280, h: 720, theme: "plain" }));
  const html = (deck.slides[0].elements[0] as TextEl).html;
  assert.match(html, /<p style="line-height: 1.8; margin-top: 6pt; margin-bottom: 12pt">H<sub>2<\/sub>O and E=mc<sup>2<\/sup><\/p>/);
  assert.match(html, /<p style="line-height: 24pt"><mark data-color="#ffff00" style="background-color: #ffff00">marked<\/mark> see <a href="https:\/\/example.com\/x\?a=1&amp;b=2"[^>]*>the site<\/a><\/p>/);
});

test("the sanitizer keeps safe links and spacing, and drops script links", async () => {
  const { sanitizeHtml } = await import("../lib/slides/sanitize");
  const out = sanitizeHtml('<p style="line-height: 1.8; margin-top: 6pt">a <a href="javascript:alert(1)">x</a> <a href="https://ok.test/">y</a> <mark style="background-color: #00ff00">z</mark></p>');
  assert.match(out, /line-height: 1.8/);
  assert.match(out, /margin-top: 6pt/);
  assert.doesNotMatch(out, /javascript/);
  assert.match(out, /<a href="https:\/\/ok.test\/" target="_blank" rel="noopener noreferrer nofollow">y<\/a>/);
  assert.match(out, /<mark style="background-color: (#00ff00|rgb\(0, 255, 0\))">z<\/mark>/);
});

test("autofit modes survive export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const base = { type: "text" as const, html: "<p>x</p>", x: 50, y: 50, w: 300, h: 60 };
  const els: TextEl[] = [
    { ...base, id: "a", z: 1, autofit: "shrink" },
    { ...base, id: "b", z: 2, autofit: "resize" },
    { ...base, id: "c", z: 3 },
  ];
  const mk = (id: string, bodyFit?: "none"): Slide => ({ id, title: "T", body: "<p>b</p>", notes: "", layout: "content", bg: "", bgImg: "", elements: id === "s1" ? els : [], ...(bodyFit ? { bodyFit } : {}) });
  const deck = await importPptx(await buildPptx([mk("s1"), mk("s2", "none")], { name: "t", w: 1280, h: 720, theme: "plain" }));
  const got = (deck.slides[0].elements as TextEl[]).map((e) => e.autofit);
  assert.deepEqual(got, ["shrink", "resize", undefined]);
  assert.equal(deck.slides[0].bodyFit, undefined);
  assert.equal(deck.slides[1].bodyFit, "none");
});

test("shrunk text is written with its autofit font scale, and our own files keep the nominal size", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const JSZip = (await import("jszip")).default;
  const tb: TextEl = { id: "t1", z: 1, type: "text", x: 40, y: 40, w: 300, h: 60, autofit: "shrink", html: '<p><span style="font-size: 24pt">Lots of text</span></p>' };
  const other: TextEl = { id: "t2", z: 2, type: "text", x: 40, y: 200, w: 300, h: 60, autofit: "shrink", html: "<p>Fits</p>" };
  const s: Slide = { id: "s1", title: "T", body: "<ul><li><p>one</p></li></ul>", notes: "", layout: "content", bg: "", bgImg: "", elements: [tb, other] };
  const out = await buildPptx([s], { name: "fit", w: 1280, h: 720, theme: "plain", fitScales: { s1: { t1: 0.62, body: 0.8 } } });
  const xml = await (await JSZip.loadAsync(out)).file("ppt/slides/slide1.xml")!.async("string");
  const sp = (name: string) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((x) => x.includes(`name="${name}"`))!;
  assert.match(sp("syn-el-t1"), /<a:normAutofit fontScale="62000"\/>/);
  assert.match(sp("syn-body"), /<a:normAutofit fontScale="80000"\/>/);
  assert.match(sp("syn-el-t2"), /<a:normAutofit\/>/, "a box that fits keeps a plain autofit");
  const deck = await importPptx(out);
  const t = deck.slides[0].elements.find((e) => e.type === "text" && e.html.includes("Lots")) as TextEl;
  assert.match(t.html, /font-size: 24pt/);
  assert.equal(t.autofit, "shrink");
});

test("a title with formatted runs keeps them through .pptx, and a plain title stays plain", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { titleText, richTitle, titleHtml } = await import("../lib/slides/model");
  const thtml = '<p>Quarterly <em>Review</em> <span style="color: #c00000">2026</span></p>';
  assert.equal(titleText(thtml), "Quarterly Review 2026");
  assert.ok(richTitle(thtml));
  assert.ok(!richTitle("<p>Plain</p>"));
  const mk = (id: string, title: string, rich?: string): Slide => ({ id, title, ...(rich ? { thtml: rich } : {}), body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "", elements: [] });
  // a stale thtml (the text changed elsewhere) gives way to the plain title
  assert.equal(titleHtml({ title: "Other", thtml }), "<p>Other</p>");
  const deck = await importPptx(await buildPptx([mk("a", "Quarterly Review 2026", thtml), mk("b", "Plain")], { name: "t", w: 1280, h: 720, theme: "plain" }));
  const [a, b] = deck.slides;
  assert.equal(a.title, "Quarterly Review 2026");
  assert.ok(a.thtml, "the formatted runs come back");
  assert.match(a.thtml!, /<em>Review<\/em>/);
  assert.match(a.thtml!, /color: #c00000/);
  assert.equal(titleText(a.thtml!), a.title);
  assert.equal(a.thtml, `<p>Quarterly <em>Review</em> <span style="color: #c00000">2026</span></p>`, "only what differs from the title style is kept");
  assert.equal(b.thtml, undefined);
});
