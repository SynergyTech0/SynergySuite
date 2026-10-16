// Body text styles of the deeper outline levels (2 to 5) on the slide master
// and layouts: merging, .pptx (own and foreign decks) and .odp round trips.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { applyMaster, cleanLevels, levelLook, type Masters, type Slide, type SlideLayout } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const blank = (layout: SlideLayout): Slide => ({ id: "", title: "", body: "", notes: "", layout, bg: "", bgImg: "", elements: [] });
const BODY = "<ul><li><p>one</p><ul><li><p>two</p><ul><li><p>three</p></li></ul></li></ul></li></ul>";
const MASTERS: Masters = {
  master: { ...blank("content"), bstyle: { size: 28, color: "222222", lv: [{ size: 24, color: "AA0000" }, { size: 20 }] } },
  content: { ...blank("content"), bstyle: { lv: [{ color: "0000AA" }, null, { font: "Georgia" }] } },
};

test("levels merge master < layout < slide, part by part, and deeper levels follow the level above", () => {
  const s = applyMaster({ ...blank("content"), id: "a", body: BODY, bstyle: { lv: [null, { color: "00AA00" }] } }, MASTERS);
  assert.deepEqual(s.bstyle, { size: 28, color: "222222", lv: [{ size: 24, color: "0000AA" }, { size: 20, color: "00AA00" }, { font: "Georgia" }] });
  assert.deepEqual(levelLook(s.bstyle, 1), {});
  assert.deepEqual(levelLook(s.bstyle, 3), { size: 20, color: "00AA00" });
  assert.deepEqual(levelLook(s.bstyle, 4), { size: 20, color: "00AA00", font: "Georgia" });
  assert.deepEqual(cleanLevels([{ size: 1000, color: "zz", font: "Arial" }, "x", null, null]), [{ font: "Arial" }]);
  assert.equal(cleanLevels([null, {}]), undefined);
});

test("levels survive .pptx: runs, the master's body style and the masters property", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const deck = [{ ...blank("content"), id: "a", title: "T", body: BODY }];
  const bytes = await buildPptx(deck, { name: "l", w: 1280, h: 720, theme: "plain", masters: MASTERS });
  const zip = await JSZip.loadAsync(bytes);
  const sl = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(sl, /<a:pPr lvl="1"[\s\S]*?<a:rPr lang="en-US" sz="2400"[^>]*><a:solidFill><a:srgbClr val="0000AA"\/>[\s\S]*?<a:t>two<\/a:t>/);
  assert.match(sl, /sz="2000"[^>]*><a:solidFill><a:srgbClr val="0000AA"\/>[\s\S]*?<a:t>three<\/a:t>/);
  const mx = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
  const bodyStyle = /<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/.exec(mx)![0];
  assert.match(bodyStyle, /<a:lvl1pPr[^>]*>[\s\S]*?<a:defRPr sz="2800"[^>]*><a:solidFill><a:srgbClr val="222222"\/>/);
  assert.match(bodyStyle, /<a:lvl2pPr[^>]*>[\s\S]*?<a:defRPr sz="2400"[^>]*><a:solidFill><a:srgbClr val="AA0000"\/>/);
  assert.match(bodyStyle, /<a:lvl3pPr[^>]*>[\s\S]*?<a:defRPr sz="2000"/);
  assert.match(bodyStyle, /<a:lvl9pPr[^>]*>[\s\S]*?<a:defRPr sz="2000"[^>]*><a:solidFill><a:srgbClr val="AA0000"\/>/);
  const back = await importPptx(bytes);
  assert.deepEqual(back.masters?.master?.bstyle?.lv, MASTERS.master!.bstyle!.lv);
  assert.deepEqual(back.masters?.content?.bstyle?.lv, MASTERS.content!.bstyle!.lv);

  // the same file seen as another application's deck: the master's text styles become editable levels
  const props = await zip.file("docProps/custom.xml")!.async("string");
  zip.file("docProps/custom.xml", props.replace(/<property[^>]*name="Synergy\w+"[^>]*>[\s\S]*?<\/property>/g, ""));
  const foreign = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const fm = Object.values(foreign.masters || {}).find((m) => m?.bstyle?.lv);
  assert.ok(fm, "a foreign master with level styles");
  assert.deepEqual(fm!.bstyle!.lv![0], { size: 24, color: "AA0000" });
  assert.equal(fm!.bstyle!.lv![1]?.size, 20);
});

test("levels survive .odp", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const deck = [{ ...blank("content"), id: "a", title: "T", body: BODY }];
  const out = await buildOdp(deck, { name: "l", w: 1280, h: 720, theme: "plain", masters: MASTERS });
  const content = await (await JSZip.loadAsync(out.data)).file("content.xml")!.async("string");
  assert.match(content, /fo:font-size="24pt"/);
  const back = await importOdp(out.data);
  assert.deepEqual(back.masters?.master?.bstyle?.lv, MASTERS.master!.bstyle!.lv);
});
