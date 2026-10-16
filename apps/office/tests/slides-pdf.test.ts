// The PDF writer: valid structure (cross-reference offsets, page tree), text
// in WinAnsi, deflated content, forms reused across pages, images, shadings
// and links; and notes wrapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { Ops, PdfWriter, isWinAnsi, pdfString } from "../lib/slides/pdf";
import { wrapText } from "../lib/slides/pdf-export";

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/** Every object's stream, inflated when deflated, keyed by object number. */
function streams(pdf: Uint8Array): Map<number, string> {
  const raw = latin1(pdf);
  const out = new Map<number, string>();
  for (const m of raw.matchAll(/(\d+) 0 obj\n([^]*?)stream\n/g)) {
    const len = Number(/\/Length (\d+)/.exec(m[2])![1]);
    const start = m.index! + m[0].length;
    const data = Buffer.from(pdf.subarray(start, start + len));
    out.set(Number(m[1]), /FlateDecode/.test(m[2]) ? inflateSync(data).toString("latin1") : data.toString("latin1"));
  }
  return out;
}

test("strings are WinAnsi with escapes", () => {
  assert.equal(pdfString("a(b)\\c"), "(a\\(b\\)\\\\c)");
  assert.equal(pdfString("café – “q” €5"), "(caf\\351 \\226 \\223q\\224 \\2005)");
  assert.equal(pdfString("x−y"), "(x-y)");
  assert.ok(isWinAnsi("Résumé • 10 €"));
  assert.ok(!isWinAnsi("Ω ≈ 1"));
});

test("a document with forms, text, an image, a shading and links is well formed", async () => {
  const pdf = new PdfWriter();
  pdf.title = "Deck – Q3";
  const f1 = pdf.font("Helvetica-Bold");
  const slide = new Ops().fillColor([255, 0, 0]).rect(10, 10, 100, 50).fill().text(f1, 24, [1, 0, 0, -1, 20, 40], "Hello (world)");
  const sh = pdf.shading("axial", [0, 0, 100, 0], [{ pos: 0, color: [255, 0, 0] }, { pos: 0.5, color: [0, 255, 0] }, { pos: 1, color: [0, 0, 255] }]);
  slide.save().rect(0, 0, 100, 10).clip().shade(sh).restore();
  const img = pdf.rgba(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]), 2, 1);
  slide.save().cm([20, 0, 0, -10, 0, 70]).xobject(img).restore();
  const form = pdf.form(slide.toString(), 960, 540);
  pdf.addPage(720, 405, new Ops().cm([0.75, 0, 0, 0.75, 0, 0]).xobject(form).toString(), [{ rect: [10, 10, 100, 30], url: "https://example.com/a?b=(1)" }]);
  pdf.addPage(612, 792, new Ops().cm([0.3, 0, 0, 0.3, 50, 500]).xobject(form).toString(), [{ rect: [0, 0, 10, 10], page: 0 }]);
  const bytes = await pdf.save();
  const raw = latin1(bytes);
  assert.ok(raw.startsWith("%PDF-1.4\n"));
  assert.ok(raw.endsWith("%%EOF\n"));
  // xref offsets point at their objects
  const xrefAt = Number(/startxref\n(\d+)/.exec(raw)![1]);
  assert.ok(raw.slice(xrefAt).startsWith("xref\n"));
  const entries = [...raw.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.ok(raw.slice(off).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1}`));
  assert.match(raw, /\/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2/);
  assert.match(raw, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  assert.match(raw, /\/URI \(https:\/\/example.com\/a\?b=\\\(1\\\)\)/);
  assert.match(raw, /\/Dest \[\d+ 0 R \/Fit\]/);
  assert.match(raw, /\/Title <FEFF/);
  assert.match(raw, /\/ShadingType 2 [^]*\/FunctionType 3 [^]*\/Bounds \[0.5\]/);
  assert.match(raw, /\/SMask \d+ 0 R/, "a half-transparent pixel gets a soft mask");
  const all = [...streams(bytes).values()];
  assert.ok(all.some((s) => s.includes("BT /F1 24 Tf 1 0 0 -1 20 40 Tm (Hello \\(world\\)) Tj ET")));
  assert.equal(all.filter((s) => /\/Fm\d+ Do/.test(s)).length, 2, "both pages draw the same form");
});

test("notes wrap to the width, keep paragraphs and split long words", () => {
  const measure = (_f: string, size: number, s: string) => s.length * size * 0.5; // 6 units per char at 12
  const lines = wrapText("one two three four five six\n\nsupercalifragilistic", "Helvetica", 12, 60, measure as never);
  assert.deepEqual(lines, ["one two", "three four", "five six", "", "supercalif", "ragilistic"]);
});

test("non-Latin text is embedded as an OpenType subset (Type 0, Identity-H) with a ToUnicode map", async () => {
  const otm = await import("opentype.js");
  const ot = (otm as { parse?: unknown }).parse ? otm : (otm as unknown as { default: typeof otm }).default;
  // a small font with Cyrillic and CJK glyphs (boxes are enough to test the plumbing)
  const box = (w: number) => { const p = new ot.Path(); p.moveTo(50, 0); p.lineTo(w - 50, 0); p.lineTo(w - 50, 700); p.quadraticCurveTo(w / 2, 800, 50, 700); p.close(); return p; };
  const glyphs = [new ot.Glyph({ name: ".notdef", advanceWidth: 500, path: new ot.Path() }), new ot.Glyph({ name: "space", unicode: 32, advanceWidth: 250, path: new ot.Path() })];
  for (const [i, ch] of [..."Жизнь漢字"].entries()) glyphs.push(new ot.Glyph({ name: `u${i}`, unicode: ch.codePointAt(0), advanceWidth: ch > "　" ? 1000 : 600, path: box(ch > "　" ? 1000 : 600) }));
  const made = new ot.Font({ familyName: "Test Sans", styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  const font = ot.parse(made.toArrayBuffer());
  const { buildSubset, fontFromCollection, plainScript } = await import("../lib/slides/pdf-fonts");
  assert.equal(plainScript("Жизнь 漢字"), true);
  assert.equal(plainScript("مرحبا"), false); // needs shaping
  assert.equal(plainScript("שלום"), false); // right to left
  // a one-font collection gives back its font
  const single = new Uint8Array(made.toArrayBuffer());
  const ttc = new Uint8Array(16 + single.length);
  const v = new DataView(ttc.buffer);
  v.setUint32(0, 0x74746366); v.setUint32(4, 0x00010000); v.setUint32(8, 1); v.setUint32(12, 16);
  ttc.set(single, 16);
  const sv = new DataView(ttc.buffer, 16);
  for (let i = 0; i < sv.getUint16(4); i++) sv.setUint32(12 + i * 16 + 8, sv.getUint32(12 + i * 16 + 8) + 16);
  assert.equal(ot.parse(fontFromCollection(ttc.buffer, 0)!).glyphs.length, font.glyphs.length);

  const pdf = new PdfWriter();
  const cf = pdf.cidFont("test", "Test Sans", (g) => buildSubset(font, g));
  const text = "漢字Жизнь";
  const cids = [...text].map((ch) => cf.cid(font.charToGlyphIndex(ch), ch));
  assert.deepEqual(cids, [1, 2, 3, 4, 5, 6, 7]);
  const ops = new Ops().glyphs(cf.key, 24, [1, 0, 0, -1, 10, 40], cids);
  pdf.addPage(200, 100, ops.toString());
  const bytes = await pdf.save();
  const raw = latin1(bytes);
  assert.match(raw, /^%PDF-1\.6/);
  assert.match(raw, /\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+Test#20Sans \/Encoding \/Identity-H/);
  assert.match(raw, /\/Subtype \/CIDFontType0 .*\/W \[0 \[500 1000 1000 600 600 600 600 600\]\]/);
  assert.match(raw, /\/FontFile3 \d+ 0 R/);
  assert.match(raw, /<< \/Subtype \/OpenType \/Length \d+ \/Filter \/FlateDecode >>/);
  // the streams: the page shows the CIDs, the ToUnicode map gives the text back, the subset is a real font
  const streams = [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => inflateSync(Buffer.from(m[1], "latin1")));
  const all = streams.map((s) => s.toString("latin1"));
  assert.ok(all.some((s) => s.includes("<0001000200030004000500060007> Tj")));
  assert.ok(all.some((s) => s.includes("<0001> <6f22>") && s.includes("<0003> <0416>")));
  const otf = streams.find((s) => s.subarray(0, 4).toString("latin1") === "OTTO")!;
  const sub = ot.parse(otf.buffer.slice(otf.byteOffset, otf.byteOffset + otf.length));
  assert.equal(sub.glyphs.length, 8);
  assert.equal(sub.glyphs.get(1).advanceWidth, 1000);
});

test("shadows are read from computed text-shadow and drop-shadow() values", async () => {
  const { parseShadows } = await import("../lib/slides/pdf-render");
  assert.deepEqual(parseShadows("drop-shadow(rgba(0, 0, 0, 0.45) 2.12px 2.12px 2px)"), [{ dx: 2.12, dy: 2.12, blur: 2, color: "rgba(0, 0, 0, 0.45)" }]);
  assert.deepEqual(parseShadows("rgb(255, 192, 0) 0px 0px 8px, rgb(255, 192, 0) 0px 0px 4px").map((s) => s.blur), [8, 4]);
  assert.deepEqual(parseShadows("none"), []);
});
