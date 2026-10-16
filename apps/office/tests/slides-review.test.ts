// Review: the accessibility checker (alt text, titles, contrast, reading
// order, links, table headers) and its fixes; spelling with nspell and
// dictionary-en; decorative objects and alt text in .pptx.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ChartEl, ImageEl, ShapeEl, Slide, TableEl, TextEl } from "../lib/slides/model";
import { checkAccessibility, contrast, readingOrderZ, visualOrder } from "../lib/slides/a11y";
import { spellIssues, wordsOf } from "../lib/slides/spell";
import { themeById } from "../lib/slides/themes";
import { fixHtmlContrast } from "../components/slides/ReviewPane";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const theme = themeById("plain"); // white background, black text
const slide = (extra: Partial<Slide> = {}): Slide => ({ id: "s", title: "A title", body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "", elements: [], ...extra });
const kinds = (s: Slide[]) => checkAccessibility(s, theme).map((i) => `${i.slide}:${i.kind}:${i.severity}${i.target ? `:${i.target}` : ""}`);

test("contrast ratios", () => {
  assert.equal(Math.round(contrast("000000", "FFFFFF")), 21);
  assert.equal(contrast("777777", "FFFFFF").toFixed(2), "4.48");
  assert.equal(contrast("#fff", "rgb(255, 255, 255)"), 1);
});

test("alt text, titles and duplicate titles", () => {
  const pic: ImageEl = { id: "p", z: 1, type: "image", src: "x", x: 700, y: 300, w: 100, h: 100 };
  const chart = { id: "c", z: 2, type: "chart", chartType: "bar", categories: [], series: [], x: 900, y: 300, w: 100, h: 100 } as unknown as ChartEl;
  const deco: ImageEl = { ...pic, id: "d", z: 3, x: 1100, deco: true };
  const out = kinds([slide({ elements: [pic, chart, deco] }), slide({ title: "" }), slide({ title: "A Title" })]);
  assert.deepEqual(out, ["0:alt:error:p", "0:alt:error:c", "0:dupTitle:warning", "1:title:error", "2:dupTitle:warning"]);
  assert.deepEqual(kinds([slide({ elements: [{ ...pic, alt: "A bar chart of sales" }] })]), []);
});

test("contrast of titles, bodies, text boxes and text on shapes", () => {
  const grey: TextEl = { id: "t", z: 1, type: "text", x: 100, y: 300, w: 300, h: 50, html: '<p>ok <span style="color: #bbbbbb">pale</span></p>' };
  const onShape: ShapeEl = { id: "sh", z: 2, type: "shape", shape: "rect", x: 500, y: 300, w: 300, h: 50, fill: "222222", html: "<p>dark on dark</p>" };
  const s = slide({ layout: "content", tstyle: { color: "EEEEEE" }, body: "<ul><li><p>fine</p></li></ul>", elements: [grey, onShape] });
  const issues = checkAccessibility([s], theme).filter((i) => i.kind === "contrast");
  assert.deepEqual(issues.map((i) => [i.target, i.severity]), [["t", "error"], ["sh", "error"], ["title", "error"]]);
  // the fixes
  assert.match(fixHtmlContrast(grey.html, "FFFFFF", "000000"), /color: #000000">pale/);
  assert.equal(fixHtmlContrast(onShape.html!, "222222", "000000"), '<p><span style="color: #FFFFFF">dark on dark</span></p>');
  // a picture background cannot be judged
  assert.equal(checkAccessibility([{ ...s, bgImg: "data:x" }], theme).filter((i) => i.kind === "contrast" && i.target === "title").length, 0);
});

test("reading order follows the layout; the fix restacks", () => {
  // stored: caption (bottom) before the picture (top right), both after the title
  const cap: TextEl = { id: "cap", z: 1, type: "text", x: 100, y: 600, w: 400, h: 50, html: "<p>Caption</p>" };
  const pic: ImageEl = { id: "pic", z: 2, type: "image", src: "x", alt: "a", x: 100, y: 250, w: 400, h: 300 };
  const bg: ShapeEl = { id: "bg", z: 3, type: "shape", shape: "rect", x: 0, y: 0, w: 1280, h: 720, fill: "FFFFFF" };
  const s = slide({ elements: [cap, pic, bg] });
  const issue = checkAccessibility([s], theme).find((i) => i.kind === "order")!;
  assert.deepEqual(issue.order, ["title", "pic", "cap"]);
  const z = readingOrderZ(s, issue.order!);
  assert.deepEqual(z, { bg: 1, pic: 2, cap: 3 });
  const zz: Record<string, number> = readingOrderZ(s, issue.order!);
  const fixed = { ...s, elements: s.elements.map((e) => ({ ...e, z: zz[e.id] })) };
  assert.equal(checkAccessibility([fixed], theme).filter((i) => i.kind === "order").length, 0);
  assert.deepEqual(visualOrder([{ id: "b", x: 500, y: 105, w: 10, h: 100 }, { id: "a", x: 10, y: 100, w: 10, h: 100 }]).map((x) => x.id), ["a", "b"]);
});

test("unclear links and table headers", () => {
  const t: TextEl = { id: "t", z: 1, type: "text", x: 0, y: 300, w: 10, h: 10, html: '<p><a href="https://x.org">click here</a> and <a href="https://x.org/a">the report</a></p>' };
  const tb = { id: "tb", z: 2, type: "table", x: 0, y: 400, w: 10, h: 10, rows: [[{ text: "a" }, { text: "b" }], [{ text: "1" }, { text: "2" }]] } as TableEl;
  assert.deepEqual(kinds([slide({ elements: [t, tb] })]), ["0:link:warning:t", "0:table:tip:tb"]);
});

test("spelling with dictionary-en", async () => {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve("dictionary-en"));
  const nspell = (await import("nspell")).default;
  const sp = nspell(readFileSync(path.join(dir, "index.aff"), "utf8"), readFileSync(path.join(dir, "index.dic"), "utf8"));
  assert.deepEqual(wordsOf("Teh quick-brown fox's NASA 3D site www.x.com/abc me@x.io don't"), ["Teh", "quick-brown", "fox's", "site", "don't"]);
  const s: Slide = slide({ title: "Quartely review", body: "<ul><li><p>Revenu is up</p></li></ul>", notes: "Mention the recieved feedback", elements: [{ id: "t", z: 1, type: "text", x: 0, y: 0, w: 1, h: 1, html: "<p>All good here, well-known</p>" } as TextEl] });
  const found = spellIssues([s], (w) => sp.correct(w));
  assert.deepEqual(found.map((m) => [m.key, m.word]), [["title", "Quartely"], ["body", "Revenu"], ["notes", "recieved"]]);
  assert.ok(sp.suggest("recieved").includes("received"));
});

test("decorative objects and alt text survive .pptx", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const pic: ImageEl = { id: "pic", z: 1, type: "image", src: PNG, alt: "Our team", x: 0, y: 0, w: 100, h: 100 };
  const line: ImageEl = { id: "orn", z: 2, type: "image", src: PNG, deco: true, x: 200, y: 0, w: 100, h: 100 };
  const sh: ShapeEl = { id: "sh", z: 3, type: "shape", shape: "rect", x: 400, y: 0, w: 100, h: 100, fill: "FF0000", deco: true };
  const buf = await buildPptx([slide({ elements: [pic, line, sh] })], { name: "a", w: 1280, h: 720, theme: "plain" });
  const deck = await importPptx(buf);
  const by = Object.fromEntries(deck.slides[0].elements.map((e) => [e.id, e]));
  assert.equal(by.pic.alt, "Our team");
  assert.equal(by.pic.deco, undefined);
  assert.equal(by.orn.deco, true);
  assert.equal(by.sh.deco, true);
});
