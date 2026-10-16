// Fixes from the round-trip fidelity pass over real-world decks: Windows
// metafile pictures, pictures inside mc:AlternateContent, templates with no
// slides and notes text holding line breaks.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { metafilePlaceholder, metafileToSvg } from "../lib/slides/metafile";
import type { ImageEl, Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

/** Little-endian record writer. */
function bytes(parts: [("u16" | "i16" | "u32" | "i32"), number][]): Uint8Array {
  const size = parts.reduce((n, [t]) => n + (t.endsWith("16") ? 2 : 4), 0);
  const dv = new DataView(new ArrayBuffer(size));
  let o = 0;
  for (const [t, v] of parts) {
    if (t === "u16") dv.setUint16(o, v, true);
    else if (t === "i16") dv.setInt16(o, v, true);
    else if (t === "u32") dv.setUint32(o, v, true);
    else dv.setInt32(o, v, true);
    o += t.endsWith("16") ? 2 : 4;
  }
  return new Uint8Array(dv.buffer);
}
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) (out.set(x, o), (o += x.length));
  return out;
};

/** A 100x50 EMF with one red rectangle. */
function emf(): Uint8Array {
  const header = bytes([
    ["u32", 1], ["u32", 88],
    ["i32", 0], ["i32", 0], ["i32", 100], ["i32", 50], // bounds
    ["i32", 0], ["i32", 0], ["i32", 2645], ["i32", 1323], // frame (0.01 mm)
    ["u32", 0x464d4520], ["u32", 0x10000], ["u32", 0], ["u32", 4],
    ["u16", 2], ["u16", 0], ["u32", 0], ["u32", 0], ["u32", 0],
    ["i32", 1024], ["i32", 768], ["i32", 270], ["i32", 203],
  ]);
  const brush = bytes([["u32", 39], ["u32", 24], ["u32", 1], ["u32", 0], ["u32", 0x0000ff], ["u32", 0]]);
  const select = bytes([["u32", 37], ["u32", 12], ["u32", 1]]);
  const rect = bytes([["u32", 43], ["u32", 24], ["i32", 10], ["i32", 10], ["i32", 90], ["i32", 40]]);
  const eof = bytes([["u32", 14], ["u32", 20], ["u32", 0], ["u32", 16], ["u32", 20]]);
  return cat(header, brush, select, rect, eof);
}

/** A placeable WMF with one blue triangle. */
function wmf(): Uint8Array {
  const placeable = bytes([["u32", 0x9ac6cdd7], ["u16", 0], ["i16", 0], ["i16", 0], ["i16", 200], ["i16", 100], ["u16", 1440], ["u32", 0], ["u16", 0]]);
  const header = bytes([["u16", 1], ["u16", 9], ["u16", 0x300], ["u32", 0], ["u16", 1], ["u32", 10], ["u16", 0]]);
  const brush = bytes([["u32", 7], ["u16", 0x02fc], ["u16", 0], ["u32", 0xff0000], ["u16", 0]]);
  const select = bytes([["u32", 4], ["u16", 0x012d], ["u16", 0]]);
  const poly = bytes([["u32", 10], ["u16", 0x0324], ["i16", 3], ["i16", 0], ["i16", 100], ["i16", 100], ["i16", 0], ["i16", 200], ["i16", 100]]);
  const eof = bytes([["u32", 3], ["u16", 0]]);
  return cat(placeable, header, brush, select, poly, eof);
}

test("EMF and WMF pictures become SVG drawings", () => {
  const e = metafileToSvg(emf());
  assert.ok(e, "an EMF drawing");
  assert.match(e!, /^<svg\b/);
  assert.match(e!, /#ff0000/i);
  const w = metafileToSvg(wmf());
  assert.ok(w, "a WMF drawing");
  assert.match(w!, /viewBox="0 0 200 100"/);
  assert.match(w!, /#0000ff/i);
  assert.equal(metafileToSvg(new Uint8Array([1, 2, 3])), null);
  assert.match(metafilePlaceholder("emf"), /EMF picture/);
});

const blank = (): Slide => ({ id: "a", title: "T", body: "", notes: "", layout: "content", bg: "", bgImg: "", elements: [] });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function foreignZip(slides: Slide[]) {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const zip = await JSZip.loadAsync(await buildPptx(slides, { name: "f", w: 1280, h: 720, theme: "plain" }));
  const props = await zip.file("docProps/custom.xml")!.async("string");
  zip.file("docProps/custom.xml", props.replace(/<property[^>]*name="Synergy\w+"[^>]*>[\s\S]*?<\/property>/g, ""));
  return zip;
}

test("a metafile picture keeps its original bytes through .pptx", async () => {
  const { importPptx } = await import("../lib/slides/pptx-import");
  const zip = await foreignZip([{ ...blank(), elements: [{ id: "p", z: 1, type: "image", src: PNG, x: 100, y: 100, w: 200, h: 100 }] }]);
  const media = Object.keys(zip.files).find((p) => /^ppt\/media\/.+\.\w+$/.test(p))!;
  zip.remove(media);
  const emfPath = media.replace(/\.\w+$/, ".emf");
  zip.file(emfPath, emf());
  const rels = Object.keys(zip.files).filter((p) => /slides\/_rels\/slide1\.xml\.rels$/.test(p))[0];
  const base = media.split("/").pop()!;
  zip.file(rels, (await zip.file(rels)!.async("string")).replace(base, base.replace(/\.\w+$/, ".emf")));
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  zip.file("[Content_Types].xml", ct.replace("</Types>", `<Default Extension="emf" ContentType="image/x-emf"/></Types>`));
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const pic = deck.slides[0].elements.find((e) => e.type === "image") as ImageEl;
  assert.ok(pic, "the picture is kept");
  assert.match(pic.src, /^data:image\/svg\+xml;base64,/);
  assert.match(pic.orig || "", /^data:image\/x-emf;base64,/);

  const { buildPptx } = await import("../lib/slides/pptx-export");
  const again = await JSZip.loadAsync(await buildPptx(deck.slides, { name: "f", w: 1280, h: 720, theme: "plain" }));
  const out = Object.keys(again.files).filter((p) => p.startsWith("ppt/media/"));
  assert.ok(out.some((p) => p.endsWith(".emf")), `an .emf part in ${out.join(", ")}`);
  assert.match(await again.file("[Content_Types].xml")!.async("string"), /image\/x-emf/);
});

test("pictures inside mc:AlternateContent are read from the fallback", async () => {
  const { importPptx } = await import("../lib/slides/pptx-import");
  const zip = await foreignZip([{ ...blank(), elements: [{ id: "p", z: 1, type: "image", src: PNG, x: 100, y: 100, w: 200, h: 100 }] }]);
  const p = "ppt/slides/slide1.xml";
  const xml = await zip.file(p)!.async("string");
  const fill = /<p:blipFill>[\s\S]*?<\/p:blipFill>/.exec(xml)![0];
  const mc = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a14">${fill}</mc:Choice><mc:Fallback>${fill}</mc:Fallback></mc:AlternateContent>`;
  zip.file(p, xml.replace(fill, mc));
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const pic = deck.slides[0].elements.find((e) => e.type === "image") as ImageEl;
  assert.ok(pic, "the picture is kept");
  assert.match(pic.src, /^data:image\/png;base64,/);
});

test("a template with no slides opens with one blank slide and keeps its layouts", async () => {
  const { importPptx } = await import("../lib/slides/pptx-import");
  const zip = await foreignZip([blank()]);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  zip.file("ppt/presentation.xml", pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, ""));
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].elements.length, 0);
  assert.ok(Object.keys(deck.masters || {}).some((k) => k.startsWith("c:")), "the template's layouts are kept");
  assert.ok([...deck.warnings].some((w) => /no slides/.test(w)));
});

test("notes with line breaks are written as paragraphs", async () => {
  const { notesParagraphs } = await import("../lib/slides/pptx-export");
  const x = `<a:p><a:r><a:rPr lang="en-US"/><a:t>one\ntwo</a:t></a:r></a:p>`;
  assert.equal(notesParagraphs(x), `<a:p><a:r><a:rPr lang="en-US"/><a:t>one</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p><a:p><a:r><a:rPr lang="en-US"/><a:t>two</a:t></a:r></a:p>`);
  assert.equal(notesParagraphs(`<a:r><a:t>same</a:t></a:r>`), `<a:r><a:t>same</a:t></a:r>`);
});
