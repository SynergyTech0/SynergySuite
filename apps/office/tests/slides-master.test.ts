// Slide master and layouts, theme colours/fonts, headers & footers and
// sections: the model helpers and the .pptx round trip.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { applyMaster, footerFor, prepareSlides, sectionsOf, type Masters, type Slide, type SlideLayout } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const slide = (id: string, layout: SlideLayout, extra: Partial<Slide> = {}): Slide => ({ id, title: `T ${id}`, body: "<p>b</p>", notes: "", layout, bg: "", bgImg: "", elements: [], ...extra });
const blank = (layout: SlideLayout): Slide => ({ id: "", title: "", body: "", notes: "", layout, bg: "", bgImg: "", elements: [] });

const MASTERS: Masters = {
  master: {
    ...blank("content"),
    bg: "EEF2FF",
    tbox: { x: 40, y: 20, w: 1200, h: 90 },
    tstyle: { color: "112233", size: 36, font: "Georgia" },
    bstyle: { size: 20, color: "334455" },
    elements: [{ id: "logo", type: "shape", shape: "ellipse", fill: "00AA00", line: null, x: 1180, y: 640, w: 60, h: 60, z: 1, html: "<p>L</p>" }],
  },
  title: { ...blank("title"), bg: "101820", tstyle: { color: "FFFFFF" }, elements: [{ id: "band", type: "shape", shape: "rect", fill: "FF8800", line: null, x: 0, y: 600, w: 1280, h: 40, z: 1 }] },
};

test("slides inherit boxes, styles, background and objects from their layout and the master", () => {
  const c = applyMaster(slide("a", "content"), MASTERS, 3);
  assert.deepEqual(c.tbox, MASTERS.master!.tbox);
  assert.deepEqual(c.tstyle, { color: "112233", size: 36, font: "Georgia" });
  assert.deepEqual(c.bstyle, { size: 20, color: "334455" });
  assert.equal(c.bg, "EEF2FF");
  assert.deepEqual(c.under?.map((e) => e.id), ["logo"]);
  assert.equal(c.num, 3);
  // the title slide keeps its own geometry and size, takes its layout's look
  const t = applyMaster(slide("b", "title"), MASTERS);
  assert.equal(t.tbox, undefined);
  assert.deepEqual(t.tstyle, { color: "FFFFFF", font: "Georgia" });
  assert.equal(t.bg, "101820");
  assert.deepEqual(t.under?.map((e) => e.id), ["logo", "band"]);
  // the slide's own settings win
  const o = applyMaster(slide("c", "content", { bg: "000000", tstyle: { color: "ABCDEF" }, tbox: { x: 1, y: 2, w: 3, h: 4 } }), MASTERS);
  assert.equal(o.bg, "000000");
  assert.equal(o.tstyle?.color, "ABCDEF");
  assert.deepEqual(o.tbox, { x: 1, y: 2, w: 3, h: 4 });
});

test("sections and footers", () => {
  const ss = [slide("a", "title"), slide("b", "content", { sec: "Body" }), slide("c", "content"), slide("d", "content", { sec: "End" })];
  assert.deepEqual(sectionsOf(ss), [
    { name: "Default Section", start: 0, end: 1 },
    { name: "Body", start: 1, end: 3 },
    { name: "End", start: 3, end: 4 },
  ]);
  const view = prepareSlides(ss, undefined);
  const hf = { num: true, footer: "Acme", skipTitle: true };
  assert.equal(footerFor(view[0], hf), null);
  assert.deepEqual(footerFor(view[2], hf), { date: undefined, footer: "Acme", num: "3" });
});

test("master, layouts, theme, header/footer and sections survive export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const slides = [
    slide("s1", "title", { sec: "Intro" }),
    slide("s2", "content", { tstyle: { color: "ABCDEF" } }),
    slide("s3", "content", { sec: "Details", bg: "FFEEDD" }),
  ];
  const bytes = await buildPptx(slides, {
    name: "m",
    w: 1280,
    h: 720,
    theme: "plain",
    colors: { accent: "FF0000", title: "202020" },
    headFont: "Georgia",
    font: "Verdana",
    hf: { num: true, footer: "Acme Corp", date: "1 May 2026", skipTitle: true },
    masters: MASTERS,
  });
  const zip = await JSZip.loadAsync(bytes);
  const theme = await zip.file("ppt/theme/theme1.xml")!.async("string");
  assert.match(theme, /<a:accent1><a:srgbClr val="FF0000"\/><\/a:accent1>/);
  assert.match(theme, /<a:majorFont><a:latin typeface="Georgia"\/>/);
  assert.match(theme, /<a:minorFont><a:latin typeface="Verdana"\/>/);
  const s2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
  assert.match(s2, /<p:ph type="ftr"/);
  assert.match(s2, /<p:ph type="dt"/);
  assert.match(s2, /<p:ph type="sldNum"/);
  const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.doesNotMatch(s1, /type="sldNum"/, "no footer on the title slide");
  assert.match(await zip.file("ppt/presentation.xml")!.async("string"), /<p14:section name="Intro"/);

  const deck = await importPptx(bytes);
  assert.deepEqual(deck.colors, { accent: "FF0000", title: "202020" });
  assert.equal(deck.headFont, "Georgia");
  assert.equal(deck.font, "Verdana");
  assert.deepEqual(deck.hf, { num: true, footer: "Acme Corp", date: "1 May 2026", skipTitle: true });
  assert.deepEqual(deck.slides.map((s) => s.sec), ["Intro", undefined, "Details"]);
  const m = deck.masters!;
  assert.equal(m.master?.bg, "EEF2FF");
  assert.deepEqual(m.master?.tbox, MASTERS.master!.tbox);
  assert.deepEqual(m.master?.tstyle, MASTERS.master!.tstyle);
  assert.deepEqual(m.master?.bstyle, MASTERS.master!.bstyle);
  assert.deepEqual(m.master?.elements.map((e) => [e.id, e.type === "shape" && e.shape]), [["logo", "ellipse"]]);
  assert.deepEqual(m.title?.elements.map((e) => e.id), ["band"]);
  assert.equal(m.title?.bg, "101820");
  // slides keep only what they set themselves
  const [a, b, c] = deck.slides;
  assert.equal(a.tbox, undefined);
  assert.equal(a.tstyle, undefined);
  assert.equal(a.bg, "");
  assert.deepEqual(a.elements, []);
  assert.equal(b.tbox, undefined);
  assert.deepEqual(b.tstyle, { color: "ABCDEF" });
  assert.equal(b.body, "<p>b</p>");
  assert.equal(c.bg, "FFEEDD");
});

test("footers and sections from other writers", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const bytes = await buildPptx([slide("x", "content", { sec: "Only" }), slide("y", "content")], { name: "f", w: 1280, h: 720, theme: "plain", hf: { num: true, footer: "Footer text" } });
  // drop our custom properties: the file now reads like any other deck
  const zip = await JSZip.loadAsync(bytes);
  zip.remove("docProps/custom.xml");
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  assert.deepEqual(deck.hf, { num: true, footer: "Footer text" });
  assert.equal(deck.slides[0].sec, "Only");
  assert.ok(deck.slides.every((s) => !s.elements.some((e) => e.type === "text" && /Footer text/.test(e.html))), "footer is not imported as a text box");
});

test("custom layouts: inheritance, export and import", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { layoutKeys } = await import("../lib/slides/model");
  const masters: Masters = {
    ...MASTERS,
    "c:brk": {
      ...blank("titleOnly"), lname: "Section Break", bg: "202040", hideUnder: true,
      tbox: { x: 100, y: 300, w: 1080, h: 120 }, tstyle: { color: "FFFFFF", size: 54 },
      elements: [{ id: "stripe", type: "shape", shape: "rect", fill: "FFCC00", line: null, x: 100, y: 440, w: 300, h: 8, z: 1 }],
    },
  };
  assert.deepEqual(layoutKeys(masters).map((k) => k.label).slice(-1), ["Section Break"]);
  const s = slide("a", "titleOnly", { clayout: "brk" });
  const v = applyMaster(s, masters);
  assert.deepEqual(v.tbox, masters["c:brk"]!.tbox);
  assert.equal(v.bg, "202040");
  assert.equal(v.tstyle?.color, "FFFFFF");
  assert.deepEqual(v.under?.map((e) => e.id), ["stripe"], "the layout hides the master's logo");
  const plain = applyMaster(slide("b", "content", { hideUnder: true }), masters);
  assert.equal(plain.under, undefined);

  const bytes = await buildPptx([s, slide("b", "content", { hideUnder: true }), slide("c", "content")], { name: "c", w: 1280, h: 720, theme: "plain", masters });
  const zip = await JSZip.loadAsync(bytes);
  const layouts = await Promise.all(Object.keys(zip.files).filter((f) => /slideLayouts\/slideLayout\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")));
  assert.ok(layouts.some((x) => x.includes('name="syn-layout-c-brk"')));
  assert.match(await zip.file("ppt/slides/slide2.xml")!.async("string"), /<p:sld showMasterSp="0"/);
  const deck = await importPptx(bytes);
  const m = deck.masters!;
  assert.equal(m["c:brk"]?.lname, "Section Break");
  assert.equal(m["c:brk"]?.layout, "titleOnly");
  assert.equal(m["c:brk"]?.bg, "202040");
  assert.equal(m["c:brk"]?.hideUnder, true);
  assert.deepEqual(m["c:brk"]?.elements.map((e) => e.id), ["stripe"]);
  assert.deepEqual(deck.slides.map((x) => [x.clayout, x.hideUnder]), [["brk", undefined], [undefined, true], [undefined, undefined]]);
  assert.equal(deck.slides[0].tbox, undefined);
  assert.equal(deck.slides[0].tstyle, undefined);
});

test("footers: dates that update by themselves and positions set on the master", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { cleanHf, footerBoxes, formatDate } = await import("../lib/slides/model");
  const day = new Date(2026, 4, 1);
  const hf = { num: true, dateAuto: "datetime4", boxes: { num: { x: 1100, y: 20, w: 150, h: 40 } } };
  assert.deepEqual(footerFor(slide("a", "content", { num: 3 }), hf, day), { date: formatDate("datetime4", day), footer: undefined, num: "3" });
  assert.match(formatDate("datetime4", day, "en-US"), /May 1, 2026/);
  assert.deepEqual(footerBoxes(1280, 720, hf).num, hf.boxes.num);
  assert.equal(footerBoxes(1280, 720, hf).date.x, 64);
  assert.equal(cleanHf({ dateAuto: "bogus", footer: "x" })?.dateAuto, undefined);
  assert.deepEqual(cleanHf({ boxes: { date: { x: 1, y: 2, w: 3, h: "4" }, num: { x: 1, y: 2, w: 3, h: 4 } }, num: true }), { num: true, boxes: { num: { x: 1, y: 2, w: 3, h: 4 } } });
  const bytes = await buildPptx([slide("x", "content"), slide("y", "content")], { name: "f", w: 1280, h: 720, theme: "plain", hf });
  const zip = await JSZip.loadAsync(bytes);
  const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(s1, /<a:fld id="\{[0-9A-F-]+\}" type="datetime4">(?:<a:rPr[^>]*\/>|<a:rPr[^>]*>[\s\S]*?<\/a:rPr>)?<a:t>[^<]+<\/a:t><\/a:fld>/);
  assert.equal((await importPptx(bytes)).hf?.dateAuto, "datetime4");
  // as another writer's deck: the field and the moved slide number are read from the slides
  zip.remove("docProps/custom.xml");
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  assert.equal(deck.hf?.dateAuto, "datetime4");
  assert.ok(deck.hf?.boxes?.num && Math.abs(deck.hf.boxes.num.x - 1100) < 2 && Math.abs(deck.hf.boxes.num.y - 20) < 2);
  assert.equal(deck.hf?.boxes?.date, undefined, "the date stays where it usually is");
});

test("layout placeholder slots: prompts on slides until filled, PowerPoint placeholders in .pptx and .odp", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const masters: Masters = {
    ...MASTERS,
    "c:two": {
      ...blank("titleOnly"), lname: "Picture and text",
      elements: [
        { id: "pic1", type: "text", html: "", slot: "pic", x: 60, y: 160, w: 560, h: 480, z: 1 },
        { id: "txt1", type: "text", html: "<p>Your words here</p>", slot: "text", x: 660, y: 160, w: 560, h: 480, z: 2 },
      ],
    },
  };
  const filled = slide("a", "titleOnly", { clayout: "two", elements: [{ id: "p", type: "image", src: PNG, x: 60, y: 160, w: 560, h: 480, z: 1, ph: "pic1" }] });
  const empty = slide("b", "titleOnly", { clayout: "two" });
  const v = applyMaster(filled, masters);
  assert.deepEqual(v.slots?.map((e) => e.id), ["txt1"], "the picture slot is filled; the text one still prompts");
  assert.deepEqual(v.under?.map((e) => e.id), ["logo"], "slots are never drawn on slides");
  assert.deepEqual(applyMaster(empty, masters).slots?.map((e) => e.slot), ["pic", "text"]);

  const bytes = await buildPptx([filled, empty], { name: "slots", w: 1280, h: 720, theme: "plain", masters });
  const zip = await JSZip.loadAsync(bytes);
  const layouts = await Promise.all(Object.keys(zip.files).filter((f) => /slideLayouts\/slideLayout\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")));
  const lay = layouts.find((x) => x.includes('name="syn-layout-c-two"'))!;
  assert.match(lay, /<p:ph type="pic" idx="20"\/>/);
  assert.match(lay, /<p:ph type="body" idx="21"\/>[\s\S]*Your words here/);
  const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(s1, /name="syn-el-p"[\s\S]*?<p:nvPr><p:ph type="pic" idx="20"\/>/, "the picture is the layout's picture placeholder");

  const deck = await importPptx(bytes);
  const L = deck.masters!["c:two"]!;
  assert.deepEqual(L.elements.map((e) => [e.id, e.slot]), [["pic1", "pic"], ["txt1", "text"]]);
  assert.equal(L.elements[1].type === "text" && L.elements[1].html, "<p>Your words here</p>");
  assert.equal(deck.slides[0].elements.find((e) => e.type === "image")?.ph, "pic1");
  assert.deepEqual(applyMaster(deck.slides[1], deck.masters).slots?.map((e) => e.id), ["pic1", "txt1"]);

  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const { data } = await buildOdp([filled, empty], { name: "slots", w: 1280, h: 720, theme: "plain", masters });
  const odp = await importOdp(data);
  const OL = odp.masters!["c:two"]!;
  assert.deepEqual(OL.elements.map((e) => e.slot), ["pic", "text"]);
  assert.equal(odp.slides[0].elements.find((e) => e.type === "image")?.ph, "pic1");
});

test("slots in decks from other writers: a layout's picture placeholder and the slide picture in it", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const masters: Masters = { ...MASTERS, "c:pic": { ...blank("content"), lname: "Picture with Caption", elements: [{ id: "p1", type: "text", html: "", slot: "pic", x: 700, y: 100, w: 500, h: 500, z: 1 }] } };
  const s = slide("a", "content", { clayout: "pic", elements: [{ id: "img", type: "image", src: PNG, x: 700, y: 100, w: 500, h: 500, z: 1, ph: "p1" }] });
  const zip = await JSZip.loadAsync(await buildPptx([s, slide("b", "content", { clayout: "pic" })], { name: "f", w: 1280, h: 720, theme: "plain", masters }));
  // as another application writes it: no deck settings, its own shape names
  zip.remove("docProps/custom.xml");
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/(slides|slideLayouts)\/[^/]+\.xml$/.test(n))) {
    const x = await zip.file(f)!.async("string");
    zip.file(f, x.replace(/name="syn-slot-p1"/g, 'name="Picture Placeholder 2"').replace(/name="syn-el-img"/g, 'name="Picture 3"'));
  }
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const lay = Object.values(deck.masters || {}).find((m) => m?.elements.some((e) => e.slot === "pic"));
  assert.ok(lay, "the layout keeps its picture placeholder");
  const slot = lay!.elements.find((e) => e.slot === "pic")!;
  const img = deck.slides[0].elements.find((e) => e.type === "image");
  assert.equal(img?.ph, slot.id, "the picture fills it");
  assert.deepEqual(applyMaster(deck.slides[1], deck.masters).slots?.map((e) => e.id), [slot.id], "the second slide still prompts");
});
