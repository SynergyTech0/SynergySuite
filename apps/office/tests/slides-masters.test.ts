// More than one slide master: an added master owns custom layouts, whose
// slides take its look; .pptx and .odp round trips.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { applyMaster, layoutKeys, masterKeyOf, type Masters, type Slide, type SlideLayout } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const blank = (layout: SlideLayout, extra: Partial<Slide> = {}): Slide => ({ id: "", title: "", body: "", notes: "", layout, bg: "", bgImg: "", elements: [], ...extra });
const MASTERS: Masters = {
  master: blank("content", { bg: "EEF2FF", tstyle: { color: "112233" }, elements: [{ id: "logo", type: "shape", shape: "ellipse", fill: "00AA00", line: null, x: 1180, y: 640, w: 60, h: 60, z: 1 }] }),
  "m:dark": blank("content", { lname: "Dark", bg: "111111", tstyle: { color: "FFFFFF" }, bstyle: { color: "DDDDDD" }, elements: [{ id: "star", type: "shape", shape: "star5", fill: "FFCC00", line: null, x: 20, y: 640, w: 60, h: 60, z: 1 }] }),
  "c:d1": blank("content", { lname: "Dark content", pm: "dark" }),
  "c:plain": blank("titleOnly", { lname: "Plain" }),
};

test("layouts follow their own master: look, objects and the rail order", () => {
  assert.equal(masterKeyOf("c:d1", MASTERS), "m:dark");
  assert.equal(masterKeyOf("c:plain", MASTERS), "master");
  assert.equal(masterKeyOf("content", MASTERS), "master");
  assert.equal(masterKeyOf("c:d1", { ...MASTERS, "m:dark": undefined }), "master");
  assert.deepEqual(layoutKeys(MASTERS).map((k) => `${k.master ? "*" : ""}${k.id}`), ["*master", "content", "title", "titleOnly", "blank", "c:plain", "*m:dark", "c:d1"]);
  assert.equal(layoutKeys(MASTERS).find((k) => k.id === "c:d1")?.group, "Dark");
  const dark = applyMaster(blank("content", { id: "a", clayout: "d1" }), MASTERS);
  assert.equal(dark.bg, "111111");
  assert.equal(dark.tstyle?.color, "FFFFFF");
  assert.equal(dark.bstyle?.color, "DDDDDD");
  assert.deepEqual(dark.under?.map((e) => e.id), ["star"]);
  const light = applyMaster(blank("content", { id: "b" }), MASTERS);
  assert.equal(light.bg, "EEF2FF");
  assert.deepEqual(light.under?.map((e) => e.id), ["logo"]);
});

const DECK = [blank("content", { id: "a", title: "Light" }), blank("content", { id: "b", title: "Dark", clayout: "d1" })];
const check = (m: Masters | undefined, slides: Slide[]) => {
  assert.equal(m?.["m:dark"]?.lname, "Dark");
  assert.equal(m?.["m:dark"]?.bg, "111111");
  assert.deepEqual(m?.["m:dark"]?.elements.map((e) => e.id), ["star"]);
  assert.deepEqual(m?.master?.elements.map((e) => e.id), ["logo"]);
  assert.equal(m?.["c:d1"]?.pm, "dark");
  assert.equal(m?.["c:plain"]?.pm, undefined);
  const b = applyMaster(slides.find((s) => s.title === "Dark")!, m);
  assert.equal(b.bg, "111111");
  assert.deepEqual(b.under?.map((e) => e.id), ["star"]);
};

test("an added master and its layouts survive .pptx", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const bytes = await buildPptx(DECK, { name: "m", w: 1280, h: 720, theme: "plain", masters: MASTERS });
  const back = await importPptx(bytes);
  check(back.masters, back.slides);

  // the added master is its own p:sldMaster part, with its layout
  const zip = await JSZip.loadAsync(bytes);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  assert.equal((pres.match(/<p:sldMasterId /g) || []).length, 2);
  const m2 = await zip.file("ppt/slideMasters/slideMaster2.xml")!.async("string");
  assert.match(m2, /<p:cSld name="Dark">/);
  assert.match(m2, /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="111111"\/>/);
  assert.equal((m2.match(/<p:sldLayoutId /g) || []).length, 1);
  const m2rels = await zip.file("ppt/slideMasters/_rels/slideMaster2.xml.rels")!.async("string");
  const lay = /Target="\.\.\/slideLayouts\/(slideLayout\d+\.xml)"/.exec(m2rels)![1];
  assert.match(await zip.file(`ppt/slideLayouts/${lay}`)!.async("string"), /<p:cSld name="syn-layout-c-d1"/);
  assert.match(await zip.file(`ppt/slideLayouts/_rels/${lay}.rels`)!.async("string"), /Target="\.\.\/slideMasters\/slideMaster2\.xml"/);
  const m1 = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
  const m1rels = await zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels")!.async("string");
  assert.ok(!m1rels.includes(lay));
  assert.equal((m1.match(/<p:sldLayoutId /g) || []).length, (m1rels.match(/\/slideLayout"/g) || []).length);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /PartName="\/ppt\/slideMasters\/slideMaster2\.xml"/);
  const ids = [...pres.matchAll(/<p:sldMasterId id="(\d+)"/g), ...m1.matchAll(/<p:sldLayoutId id="(\d+)"/g), ...m2.matchAll(/<p:sldLayoutId id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);

  // read as another application's file: two masters, the second with its layout
  const props = await zip.file("docProps/custom.xml")!.async("string");
  zip.file("docProps/custom.xml", props.replace(/<property[^>]*name="Synergy\w+"[^>]*>[\s\S]*?<\/property>/g, ""));
  const foreign = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const second = Object.keys(foreign.masters || {}).filter((k) => k.startsWith("m:"));
  assert.equal(second.length, 1);
  assert.ok(Object.entries(foreign.masters || {}).some(([k, m]) => k.startsWith("c:") && m?.pm && `m:${m.pm}` === second[0]));
});

test("an added master and its layouts survive .odp", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const back = await importOdp((await buildOdp(DECK, { name: "m", w: 1280, h: 720, theme: "plain", masters: MASTERS })).data);
  check(back.masters, back.slides);
});
