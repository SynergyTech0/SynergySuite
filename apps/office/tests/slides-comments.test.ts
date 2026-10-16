// Slide comments: anchors in the thread quote, @mentions, and PowerPoint
// comments written on export and read back on import.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { anchorFor, decodeAnchor, encodeAnchor, mentionsIn, pptxComments, threadsBySlide, type CommentThread } from "../lib/slides/comments";
import type { Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, title: id, body: "", notes: "", layout: "content", bg: "", bgImg: "", elements: [], ...extra });
const msg = (id: string, name: string, body: string, ms: number) => ({ id, author_email: `${name.toLowerCase()}@synergy.test`, author_name: name, body, created_ms: String(ms) });

test("a thread's place on the slide rides in its quote", () => {
  const q = encodeAnchor({ slideId: "s1abc", x: 100.4, y: 20, el: "e9", label: "Revenue chart" });
  assert.equal(q, "@slide/s1abc/100/20/e9 Revenue chart");
  assert.deepEqual(decodeAnchor(q), { slideId: "s1abc", x: 100, y: 20, el: "e9", label: "Revenue chart" });
  assert.deepEqual(decodeAnchor("@slide/s2/5/6"), { slideId: "s2", x: 5, y: 6, label: "" });
  assert.equal(decodeAnchor("a quote from a document"), null);
  const s = slide("s1", { elements: [{ id: "e1", type: "text", html: "<p>x</p>", x: 100, y: 50, w: 200, h: 40, z: 1 }] });
  assert.deepEqual(anchorFor(s, "e1", 1280), { slideId: "s1", x: 300, y: 50, el: "e1" });
  assert.deepEqual(anchorFor(s, null, 1280), { slideId: "s1", x: 12, y: 12 });
  assert.deepEqual(mentionsIn("ping @Ana@synergy.test and @bo@synergy.test, @ana@synergy.test"), ["ana@synergy.test", "bo@synergy.test"]);
});

test("comments go to PowerPoint and come back as threads", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const slides = [slide("a"), slide("b")];
  const threads: CommentThread[] = [
    { id: "t1", quote: encodeAnchor({ slideId: "b", x: 120, y: 60, label: "b" }), resolved: false, created_ms: "1", messages: [msg("m1", "Ana", "Check the numbers", Date.UTC(2026, 9, 1)), msg("m2", "Bo", "Fixed — @ana@synergy.test", Date.UTC(2026, 9, 2))] },
    { id: "t2", quote: encodeAnchor({ slideId: "a", x: 12, y: 12, label: "a" }), resolved: false, created_ms: "2", messages: [msg("m3", "Bo", "Nice <title> & intro", Date.UTC(2026, 9, 3))] },
    { id: "t3", quote: encodeAnchor({ slideId: "a", x: 1, y: 1, label: "a" }), resolved: true, created_ms: "3", messages: [msg("m4", "Ana", "old", 0)] },
    { id: "t4", quote: "a docs quote", resolved: false, created_ms: "4", messages: [msg("m5", "Ana", "not a slide comment", 0)] },
  ];
  assert.deepEqual([...threadsBySlide(threads).keys()], ["b", "a"]);
  const list = pptxComments(slides, threads);
  assert.equal(list.length, 3, "resolved and non-slide threads are left out");
  const bytes = await buildPptx(slides, { name: "c", w: 1280, h: 720, theme: "plain", comments: list });
  const zip = await JSZip.loadAsync(bytes);
  const authors = await zip.file("ppt/commentAuthors.xml")!.async("string");
  assert.match(authors, /<p:cmAuthor id="0" name="Ana" initials="A"/);
  const c2 = await zip.file("ppt/comments/comment2.xml")!.async("string");
  assert.match(c2, /<p:pos x="720" y="360"\/><p:text>Check the numbers<\/p:text>/);
  assert.match(c2, /<p15:parentCm authorId="0" idx="1"\/>/);
  assert.match(await zip.file("ppt/slides/_rels/slide2.xml.rels")!.async("string"), /relationships\/comments" Target="..\/comments\/comment2.xml"/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /\/ppt\/commentAuthors.xml/);

  const deck = await importPptx(bytes);
  assert.deepEqual(deck.comments, [
    { slide: 0, x: 12, y: 12, messages: [{ author: "Bo", text: "Nice <title> & intro", ms: Date.UTC(2026, 9, 3) }] },
    { slide: 1, x: 120, y: 60, messages: [{ author: "Ana", text: "Check the numbers", ms: Date.UTC(2026, 9, 1) }, { author: "Bo", text: "Fixed — @ana@synergy.test", ms: Date.UTC(2026, 9, 2) }] },
  ]);
});
