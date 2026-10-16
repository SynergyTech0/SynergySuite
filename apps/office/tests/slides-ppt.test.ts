// Legacy PowerPoint (.ppt) text import: a compound file built here holds a
// PowerPoint document stream with one slide (title, body, a text box and a
// title referenced from the slide list), its notes and the hidden flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importPpt, readCfb } from "../lib/slides/ppt-import";
import type { TableCell } from "../lib/slides/model";

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};
const u16 = (...v: number[]) => new Uint8Array(new Uint16Array(v).buffer);
const u32 = (...v: number[]) => new Uint8Array(new Uint32Array(v).buffer);
const i16 = (...v: number[]) => new Uint8Array(new Int16Array(v).buffer);
const rec = (type: number, body: Uint8Array, inst = 0, container = false) => cat(u16((inst << 4) | (container ? 0xf : 0), type), u32(body.length), body);
const box = (type: number, ...kids: Uint8Array[]) => rec(type, cat(...kids), 0, true);
const utf16 = (s: string) => u16(...[...s].map((c) => c.charCodeAt(0)));
const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const header = (t: number) => rec(0x0f9f, u32(t));

/** A minimal compound file: 512-byte sectors, one FAT sector, every stream in the big-sector area. */
function cfb(streams: [string, Uint8Array][]): Uint8Array {
  const S = 512;
  const pad = (b: Uint8Array) => cat(b, new Uint8Array((S - (b.length % S)) % S || 0));
  const bodies = streams.map(([, d]) => pad(d.length < 4096 ? cat(d, new Uint8Array(4096 - d.length)) : d));
  const fat: number[] = [0xfffffffd, 0xfffffffe];
  const starts: number[] = [];
  for (const b of bodies) {
    const n = b.length / S;
    starts.push(fat.length);
    for (let k = 0; k < n; k++) fat.push(k === n - 1 ? 0xfffffffe : fat.length + 1);
  }
  while (fat.length < S / 4) fat.push(0xffffffff);
  const entry = (name: string, type: number, start: number, size: number, child = 0xffffffff, right = 0xffffffff) => {
    const e = new Uint8Array(128);
    const dv = new DataView(e.buffer);
    [...name].forEach((c, i) => dv.setUint16(i * 2, c.charCodeAt(0), true));
    dv.setUint16(64, (name.length + 1) * 2, true);
    e[66] = type;
    dv.setUint32(68, 0xffffffff, true);
    dv.setUint32(72, right, true);
    dv.setUint32(76, child, true);
    dv.setUint32(116, start, true);
    dv.setUint32(120, size, true);
    return e;
  };
  const dir = cat(
    entry("Root Entry", 5, 0xfffffffe, 0, 1),
    ...streams.map(([n], i) => entry(n, 2, starts[i], Math.max(4096, streams[i][1].length), 0xffffffff, i + 1 < streams.length ? i + 2 : 0xffffffff)),
  );
  const h = new Uint8Array(512);
  const dv = new DataView(h.buffer);
  h.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  dv.setUint16(0x18, 0x3e, true);
  dv.setUint16(0x1a, 3, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, 9, true);
  dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, 1, true);
  dv.setUint32(0x30, 1, true);
  dv.setUint32(0x38, 4096, true);
  dv.setUint32(0x3c, 0xfffffffe, true);
  dv.setUint32(0x44, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i === 0 ? 0 : 0xffffffff, true);
  return cat(h, u32(...fat), pad(dir), ...bodies);
}

function buildPpt(): Uint8Array {
  const shape = (anchor: number[], ...text: Uint8Array[]) => box(0xf004, rec(0xf010, i16(...anchor)), box(0xf00d, ...text));
  const drawing = (...shapes: Uint8Array[]) => box(0x040c, box(0xf002, box(0xf003, ...shapes)));
  const persistAtom = (ref: number, id: number) => rec(0x03f3, u32(ref, 0, 0, id, 0));
  const docAtom = rec(0x03e9, cat(u32(5760, 3240), new Uint8Array(32))); // 960 x 540 px
  const slideList = rec(0x0ff0, cat(persistAtom(2, 256), header(0), rec(0x0fa0, utf16("Quarterly – review")), header(1), rec(0x0fa8, latin1("Revenue up\rCosts down"))), 0, true);
  const notesList = rec(0x0ff0, persistAtom(3, 7), 2, true);
  const document = box(0x03e8, docAtom, slideList, notesList);
  // title placeholder refers to the slide list's first text; a free text box carries its own
  const slide = box(0x03ee,
    rec(0x03ef, cat(u32(0), new Uint8Array(8), u32(0, 7), u16(0, 0))),
    rec(0x03f9, cat(u32(0, 0), new Uint8Array([0, 0]), u16(0x4), new Uint8Array(4))),
    drawing(shape([96, 192, 1152, 576], rec(0x0f9e, u32(0))), shape([2400, 600, 4800, 4800], header(4), rec(0x0fa0, utf16("Free text\rline two")))),
  );
  const notes = box(0x03f0, rec(0x03f1, new Uint8Array(8)), drawing(shape([0, 0, 100, 100], header(2), rec(0x0fa0, utf16("Say hello")))));
  const offDoc = 0, offSlide = document.length, offNotes = offSlide + slide.length;
  const persistDir = rec(0x1772, u32(1 | (3 << 20), offDoc, offSlide, offNotes));
  const offDir = offNotes + notes.length;
  const offEdit = offDir + persistDir.length;
  const userEdit = rec(0x0ff5, u32(256, 0, 0, offDir, 1, 4, 0));
  const stream = cat(document, slide, notes, persistDir, userEdit);
  const current = rec(0x0ff6, u32(20, 0xe391c05f, offEdit, 0, 0));
  return cfb([["PowerPoint Document", stream], ["Current User", current]]);
}

test("compound files list their streams", () => {
  const f = readCfb(buildPpt());
  assert.ok(f.get("PowerPoint Document")!.length > 100);
  assert.equal(f.get("Current User")!.length, 4096);
  assert.throws(() => readCfb(new Uint8Array(600)), /not a PowerPoint 97-2003 file/);
});

test("a .ppt imports its slide text, positions, notes and hidden flag", async () => {
  const deck = await importPpt(buildPpt());
  assert.equal(deck.w, 960);
  assert.equal(deck.h, 540);
  assert.equal(deck.slides.length, 1);
  const s = deck.slides[0];
  assert.equal(s.title, "Quarterly – review");
  assert.equal(s.layout, "content");
  assert.equal(s.body, "<ul><li><p>Revenue up</p></li><li><p>Costs down</p></li></ul>");
  assert.deepEqual(s.tbox, { x: 32, y: 16, w: 160, h: 80 });
  assert.equal(s.notes, "Say hello");
  assert.ok(s.hidden);
  assert.equal(s.elements.length, 1);
  const t = s.elements[0];
  assert.equal(t.type, "text");
  assert.deepEqual([t.x, t.y, t.w, t.h], [100, 400, 700, 400]);
  assert.equal(t.type === "text" && t.html, "<p>Free text</p><p>line two</p>");
  assert.match(deck.warnings[0], /text, shapes, pictures, tables and notes/);
});

/** A .ppt with a drawing group (one PNG in the picture store) and a slide holding a group, a line, a picture and a table. */
function buildDrawingPpt(): Uint8Array {
  const prop = (id: number, v: number) => cat(u16(id), u32(v));
  const fopt = (...p: [number, number][]) => rec(0xf00b, cat(...p.map(([id, v]) => prop(id, v))), p.length);
  const fsp = (spt: number, flags: number) => rec(0xf00a, u32(1024, flags), spt);
  const anchor = (t: number, l: number, r: number, b: number) => rec(0xf010, i16(t, l, r, b));
  const childAnchor = (l: number, t: number, r: number, b: number) => rec(0xf00f, u32(l, t, r, b));
  const text = (s: string) => box(0xf00d, header(4), rec(0x0fa0, utf16(s)));
  const sp = (...k: Uint8Array[]) => box(0xf004, ...k);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const blip = rec(0xf01e, cat(new Uint8Array(16), new Uint8Array([0xff]), png), 0x6e0);
  const fbse = rec(0xf007, cat(new Uint8Array([6, 6]), new Uint8Array(16), u16(0), u32(blip.length, 1, 0), new Uint8Array(4)), 6);
  const dgg = box(0x040b, box(0xf000, rec(0xf006, new Uint8Array(16)), rec(0xf001, fbse, 1, true), fopt([0x181, 0x08000004], [0x1bf, 0x00100010], [0x1c0, 0x08000001], [0x1ff, 0x00080008])));
  const persistAtom = (ref: number, id: number) => rec(0x03f3, u32(ref, 0, 0, id, 0));
  const docAtom = rec(0x03e9, cat(u32(5760, 4320), new Uint8Array(32))); // 960 x 720 px
  const document = box(0x03e8, docAtom, dgg, rec(0x0ff0, persistAtom(2, 256), 0, true));
  const group = box(0xf003,
    sp(rec(0xf009, u32(0, 0, 1000, 1000)), fsp(0, 0x201), anchor(600, 600, 1200, 1200)), // 100,100 100x100 px, inner space 0..1000
    sp(fsp(3, 0x202), fopt([0x181, 0x0000ff], [0x4, 45 << 16]), childAnchor(0, 0, 500, 1000)), // red ellipse, left half, turned 45 degrees
    sp(fsp(1, 0x202), fopt([0x1bf, 0x00100000], [0x1c0, 0x00ff00], [0x1cb, 19050]), childAnchor(500, 0, 1000, 500), text("Boxed")), // no fill, green 2px outline, with text
  );
  const line = sp(fsp(20, 0x200 | 0x40), fopt([0x1c0, 0xff0000], [0x1d1, 1]), anchor(1800, 600, 2400, 2400));
  const pic = sp(fsp(75, 0x200), fopt([0x104, 1], [0x102, 0x4000]), anchor(2400, 3000, 3600, 3600));
  const cell = (l: number, t: number, r: number, b: number, s: string, fill?: number) => sp(fsp(1, 0x202), fopt([0x181, fill ?? 0xffffff], [0x1bf, fill === undefined ? 0x00100000 : 0x00100010]), childAnchor(l, t, r, b), text(s));
  const table = box(0xf003,
    sp(rec(0xf009, u32(0, 0, 1200, 600)), fsp(0, 0x201), rec(0xf122, prop(0x3a0, 1), 1), anchor(3000, 600, 1800, 3600)),
    cell(0, 0, 1200, 300, "Head", 0x996633),
    cell(0, 300, 600, 600, "A"),
    cell(600, 300, 1200, 600, "B\rb"),
  );
  const drawing = box(0x040c, box(0xf002, box(0xf003, sp(rec(0xf009, new Uint8Array(16)), fsp(0, 0x5)), group, line, pic, table)));
  const slide = box(0x03ee, rec(0x03ef, cat(u32(0), new Uint8Array(8), u32(0, 0), u16(0, 0))), drawing);
  const offDoc = 0, offSlide = document.length;
  const persistDir = rec(0x1772, u32(1 | (2 << 20), offDoc, offSlide));
  const offDir = offSlide + slide.length;
  const userEdit = rec(0x0ff5, u32(256, 0, 0, offDir, 1, 3, 0));
  const stream = cat(document, slide, persistDir, userEdit);
  const current = rec(0x0ff6, u32(20, 0xe391c05f, offDir + persistDir.length, 0, 0));
  return cfb([["PowerPoint Document", stream], ["Current User", current], ["Pictures", blip]]);
}

test("a .ppt's drawing imports: grouped shapes with fills, outlines, rotation and text; lines, pictures and tables", async () => {
  const deck = await importPpt(buildDrawingPpt());
  const els = deck.slides[0].elements;
  const [ell, boxed, line, pic, table] = els as never[] as (Record<string, unknown> & { type: string })[];
  assert.deepEqual(els.map((e) => e.type), ["shape", "shape", "shape", "image", "table"]);
  // the ellipse fills the group's left half: 100,100 50x100 px, turned 45 degrees (its anchor holds the turned box)
  assert.equal(ell.shape, "ellipse");
  assert.equal(ell.fill, "FF0000");
  assert.equal(ell.line, "000000"); // the drawing group's default outline
  assert.equal(ell.rot, 45);
  assert.deepEqual([ell.x, ell.y, ell.w, ell.h], [75, 125, 100, 50]);
  assert.equal(boxed.fill, null);
  assert.equal(boxed.line, "00FF00");
  assert.equal(boxed.lineW, 2);
  assert.equal(boxed.html, "<p>Boxed</p>");
  assert.deepEqual([boxed.x, boxed.y, boxed.w, boxed.h], [150, 100, 50, 50]);
  assert.equal(line.shape, "lineArrow");
  assert.equal(line.line, "0000FF");
  assert.equal(line.flipH, true);
  assert.match(pic.src as string, /^data:image\/png;base64,iVBORw0KGgoBAgME$/);
  assert.deepEqual(pic.crop, { l: 0.25, t: 0, r: 0, b: 0 });
  assert.deepEqual([pic.x, pic.y, pic.w, pic.h], [500, 400, 100, 200]);
  const rows = table.rows as TableCell[][];
  assert.deepEqual(rows.map((r) => r.map((c) => (c.merged ? "~" : c.text))), [["Head", "~"], ["A", "B\nb"]]);
  assert.equal(rows[0][0].cs, 2);
  assert.equal(rows[0][0].fill, "336699");
  assert.equal(rows[1][0].fill, undefined);
  assert.deepEqual(table.colW, [100, 100]);
  assert.deepEqual([table.x, table.y, table.w, table.h], [100, 500, 200, 100]);
});
