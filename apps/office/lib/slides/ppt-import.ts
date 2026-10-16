// Legacy PowerPoint 97-2003 (.ppt) import, read with our own record reader
// from the published format specifications ([MS-CFB], [MS-PPT], [MS-ODRAW]).
// The file is an OLE compound file; its "PowerPoint Document" stream holds
// binary records. We follow the current edit's persist directory to the
// document and each slide, and read the slide's drawing: text boxes and the
// title and body placeholders (with their positions), shapes (preset type,
// fill, outline, rotation, flips and their text), lines, pictures (from the
// "Pictures" stream: JPEG, PNG, DIB, EMF and WMF, with crop), tables (cells,
// spans and fills), groups (nested ones too), speaker notes and hidden slides. Text formatting,
// charts (embedded OLE objects), animations and master graphics are not read.
import type { ImportedDeck } from "./pptx-import";
import { genId, type Gradient, type Slide, type SlideElement, type TableCell } from "./model";
import { metafilePlaceholder, metafileToSvg } from "./metafile";

// ---- compound file (MS-CFB) ----

const FREE = 0xffffffff, END = 0xfffffffe;

/** The streams of a compound file, by name (the directory is flattened). */
export function readCfb(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buf.length < 512 || sig.some((b, i) => buf[i] !== b)) throw new Error("This is not a PowerPoint 97-2003 file.");
  const ss = 1 << dv.getUint16(0x1e, true);
  const mss = 1 << dv.getUint16(0x20, true);
  const firstDir = dv.getUint32(0x30, true);
  const cutoff = dv.getUint32(0x38, true);
  const firstMini = dv.getUint32(0x3c, true);
  let difatNext = dv.getUint32(0x44, true);
  const nDifat = dv.getUint32(0x48, true);
  const sector = (n: number) => buf.subarray(ss * (n + 1), ss * (n + 2));
  const u32 = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i * 4, true);

  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(0x4c + i * 4, true);
    if (s !== FREE) fatSectors.push(s);
  }
  for (let k = 0; k < nDifat && difatNext !== END && difatNext !== FREE; k++) {
    const sec = sector(difatNext);
    const per = ss / 4 - 1;
    for (let i = 0; i < per; i++) {
      const s = u32(sec, i);
      if (s !== FREE) fatSectors.push(s);
    }
    difatNext = u32(sec, per);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const sec = sector(s);
    for (let i = 0; i < ss / 4; i++) fat.push(u32(sec, i));
  }
  const chain = (start: number, next: number[]) => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END && s !== FREE && s < next.length && !seen.has(s); s = next[s]) {
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number) => {
    const ids = chain(start, fat);
    const out = new Uint8Array(ids.length * ss);
    ids.forEach((s, i) => out.set(sector(s), i * ss));
    return out;
  };

  const dir = readChain(firstDir);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const len = ddv.getUint16(off + 64, true);
    let name = "";
    for (let i = 0; i + 2 < len; i += 2) name += String.fromCharCode(ddv.getUint16(off + i, true));
    entries.push({ name, type: dir[off + 66], start: ddv.getUint32(off + 116, true), size: ddv.getUint32(off + 120, true) });
  }
  const root = entries[0];
  const mini = root ? readChain(root.start) : new Uint8Array();
  const minifat: number[] = [];
  if (firstMini !== END && firstMini !== FREE) {
    const mf = readChain(firstMini);
    for (let i = 0; i < mf.length / 4; i++) minifat.push(u32(mf, i));
  }
  const out = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size < cutoff) {
      const ids = chain(e.start, minifat);
      const data = new Uint8Array(ids.length * mss);
      ids.forEach((s, i) => data.set(mini.subarray(s * mss, (s + 1) * mss), i * mss));
      out.set(e.name, data.subarray(0, e.size));
    } else out.set(e.name, readChain(e.start).subarray(0, e.size));
  }
  return out;
}

// ---- PowerPoint binary records (MS-PPT) ----

const RT = {
  Document: 0x03e8,
  DocumentAtom: 0x03e9,
  Slide: 0x03ee,
  SlideAtom: 0x03ef,
  Notes: 0x03f0,
  NotesAtom: 0x03f1,
  SlidePersistAtom: 0x03f3,
  SSSlideInfoAtom: 0x03f9,
  OutlineTextRefAtom: 0x0f9e,
  TextHeaderAtom: 0x0f9f,
  TextCharsAtom: 0x0fa0,
  TextBytesAtom: 0x0fa8,
  SlideListWithText: 0x0ff0,
  UserEditAtom: 0x0ff5,
  CurrentUserAtom: 0x0ff6,
  PersistDirectoryAtom: 0x1772,
  SpContainer: 0xf004,
  ClientAnchor: 0xf010,
  ClientTextbox: 0xf00d,
  ChildAnchor: 0xf00f,
  ClientData: 0xf011,
  PlaceholderAtom: 0x0bc3,
  ColorSchemeAtom: 0x07f0,
  MainMaster: 0x03f8,
  PPDrawingGroup: 0x040b,
  DggContainer: 0xf000,
  BStoreContainer: 0xf001,
  FBSE: 0xf007,
  SpgrContainer: 0xf003,
  FSPGR: 0xf009,
  FSP: 0xf00a,
  FOPT: 0xf00b,
  SecondaryFOPT: 0xf121,
  TertiaryFOPT: 0xf122,
} as const;

/** Placeholder kinds (OEPlaceholderAtom placementId) as text types. */
const PLACEHOLDER_TEXT: Record<number, number> = { 0x0c: 2, 0x0d: 0, 0x0e: 1, 0x0f: 6, 0x10: 5, 0x11: 0, 0x12: 1 };

type Rec = { type: number; inst: number; container: boolean; start: number; len: number };

function recAt(dv: DataView, off: number): Rec | null {
  if (off + 8 > dv.byteLength) return null;
  const vi = dv.getUint16(off, true);
  const len = dv.getUint32(off + 4, true);
  if (off + 8 + len > dv.byteLength) return null;
  return { type: dv.getUint16(off + 2, true), inst: vi >> 4, container: (vi & 0xf) === 0xf, start: off + 8, len };
}

function children(dv: DataView, r: Rec): Rec[] {
  const out: Rec[] = [];
  for (let off = r.start; off < r.start + r.len; ) {
    const c = recAt(dv, off);
    if (!c) break;
    out.push(c);
    off = c.start + c.len;
  }
  return out;
}

/** Text in a run of text atoms: paragraphs split on CR, line breaks on VT. */
function atomText(dv: DataView, r: Rec): string {
  let s = "";
  if (r.type === RT.TextCharsAtom) for (let i = 0; i + 1 < r.len; i += 2) s += String.fromCharCode(dv.getUint16(r.start + i, true));
  else for (let i = 0; i < r.len; i++) s += String.fromCharCode(dv.getUint8(r.start + i));
  return s.replace(/\u000b/g, "\n");
}

// text types (TextHeaderAtom)
const TT = { Title: 0, Body: 1, Notes: 2, Other: 4, CenterBody: 5, CenterTitle: 6, HalfBody: 7, QuarterBody: 8 };
const isTitle = (t: number) => t === TT.Title || t === TT.CenterTitle;
const isBody = (t: number) => t === TT.Body || t === TT.CenterBody || t === TT.HalfBody || t === TT.QuarterBody;

type TextBlock = { type: number; text: string };
type Box = { x: number; y: number; w: number; h: number };

/** Text blocks in a run of records (TextHeaderAtom then a chars/bytes atom). */
function textBlocks(dv: DataView, recs: Rec[]): TextBlock[] {
  const out: TextBlock[] = [];
  let type = -1;
  for (const r of recs) {
    if (r.type === RT.TextHeaderAtom) type = dv.getUint32(r.start, true);
    else if ((r.type === RT.TextCharsAtom || r.type === RT.TextBytesAtom) && type >= 0) {
      out.push({ type, text: atomText(dv, r) });
      type = -1;
    }
  }
  return out;
}

// ---- OfficeArt shapes ([MS-ODRAW]) ----

type Prop = { v: number; complex?: Uint8Array };
/** A shape's property table: id -> value (and complex data, which follows the table in order). */
function readProps(dv: DataView, r: Rec): Map<number, Prop> {
  const out = new Map<number, Prop>();
  const n = r.inst;
  let data = r.start + n * 6;
  for (let i = 0; i < n && r.start + i * 6 + 6 <= r.start + r.len; i++) {
    const opid = dv.getUint16(r.start + i * 6, true);
    const v = dv.getUint32(r.start + i * 6 + 2, true);
    const id = opid & 0x3fff;
    if (opid & 0x8000) {
      const len = Math.min(v, Math.max(0, r.start + r.len - data));
      out.set(id, { v, complex: new Uint8Array(dv.buffer, dv.byteOffset + data, len) });
      data += len;
    } else out.set(id, { v });
  }
  return out;
}
/** A boolean in a property's bit set: the value bit counts when its "use" bit (16 higher) is set. */
function boolProp(props: Map<number, Prop>, id: number, bit: number, dflt: boolean): boolean {
  const v = props.get(id)?.v;
  if (v === undefined || !(v & (1 << (bit + 16)))) return dflt;
  return !!(v & (1 << bit));
}
/** A 16.16 fixed-point value (rotation in degrees, crop fractions). */
const fixed = (v: number | undefined) => (v === undefined ? 0 : (v | 0) / 65536);
/** An OfficeArtCOLORREF (red in the low byte) as hex. */
const rgbHex = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

/** A stored picture (OfficeArtBlip record) as a data URL; metafiles as SVG with the original kept. */
async function blipData(dv: DataView, r: Rec): Promise<{ src: string; orig?: string } | null> {
  const bytes = (o: number, n: number) => new Uint8Array(dv.buffer, dv.byteOffset + o, Math.max(0, n));
  const b64 = (u: Uint8Array) => {
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  // the second UID is there when the instance is the "two UIDs" variant (odd)
  const two = (base: number) => r.inst === base + 1;
  const RASTER: Record<number, [number, string]> = { 0xf01d: [0x46a, "image/jpeg"], 0xf02a: [0x6e2, "image/jpeg"], 0xf01e: [0x6e0, "image/png"], 0xf029: [0x6e4, "image/tiff"] };
  if (RASTER[r.type] || (r.type === 0xf01d && r.inst >= 0x6e2)) {
    const [base, mime] = RASTER[r.type];
    const jpegAlt = r.type === 0xf01d && (r.inst === 0x6e2 || r.inst === 0x6e3);
    const skip = 16 + (two(jpegAlt ? 0x6e2 : base) ? 16 : 0) + 1;
    return { src: `data:${mime};base64,${b64(bytes(r.start + skip, r.len - skip))}` };
  }
  if (r.type === 0xf01f) {
    // a device-independent bitmap: give it a BMP file header
    const skip = 16 + (two(0x7a8) ? 16 : 0) + 1;
    const dib = bytes(r.start + skip, r.len - skip);
    if (dib.length < 40) return null;
    const ddv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    const hsz = ddv.getUint32(0, true), bpp = ddv.getUint16(14, true), used = ddv.getUint32(32, true);
    const pal = (bpp <= 8 ? used || 1 << bpp : used) * 4;
    const head = new Uint8Array(14);
    const hdv = new DataView(head.buffer);
    head.set([0x42, 0x4d]);
    hdv.setUint32(2, 14 + dib.length, true);
    hdv.setUint32(10, 14 + hsz + pal, true);
    const all = new Uint8Array(14 + dib.length);
    all.set(head);
    all.set(dib, 14);
    return { src: `data:image/bmp;base64,${b64(all)}` };
  }
  if (r.type === 0xf01a || r.type === 0xf01b) {
    // EMF / WMF: a metafile header, then the (usually deflated) metafile
    const emf = r.type === 0xf01a;
    const skip = 16 + (two(emf ? 0x3d4 : 0x216) ? 16 : 0);
    const h = r.start + skip;
    if (r.len < skip + 34) return null;
    const size = dv.getUint32(h, true);
    const compressed = dv.getUint8(h + 32) === 0;
    let data = bytes(h + 34, r.len - skip - 34);
    if (compressed) {
      const ds = new DecompressionStream("deflate");
      data = new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer());
    }
    if (size && data.length > size) data = data.subarray(0, size);
    if (!emf) {
      // a WMF without its placeable header: add one from the record's bounds
      const bounds = [0, 4, 8, 12].map((i) => dv.getInt32(h + 4 + i, true));
      const ph = new Uint8Array(22);
      const pdv = new DataView(ph.buffer);
      pdv.setUint32(0, 0x9ac6cdd7, true);
      [bounds[0], bounds[1], bounds[2], bounds[3]].forEach((v, i) => pdv.setInt16(6 + i * 2, v, true));
      pdv.setUint16(14, 1440, true);
      let sum = 0;
      for (let i = 0; i < 20; i += 2) sum ^= pdv.getUint16(i, true);
      pdv.setUint16(20, sum, true);
      const all = new Uint8Array(22 + data.length);
      all.set(ph);
      all.set(data, 22);
      data = all;
    }
    const svg = metafileToSvg(data) || metafilePlaceholder(emf ? "emf" : "wmf");
    return { src: `data:image/svg+xml;base64,${b64(new TextEncoder().encode(svg))}`, orig: `data:image/${emf ? "emf" : "wmf"};base64,${b64(data)}` };
  }
  return null;
}

/** OfficeArt shape types ([MS-ODRAW] MSOSPT) as preset geometry names. */
const SPT: Record<number, string> = { 1: "rect", 2: "roundRect", 3: "ellipse", 4: "diamond", 5: "triangle", 6: "rtTriangle", 7: "parallelogram", 8: "trapezoid", 9: "hexagon", 10: "octagon", 11: "plus", 12: "star5", 13: "rightArrow", 15: "homePlate", 20: "line", 32: "line", 55: "chevron", 56: "pentagon", 61: "wedgeRectCallout", 66: "leftArrow", 67: "downArrow", 68: "upArrow", 202: "rect" };

type Tf = (raw: [number, number, number, number]) => Box;
type XfFlags = { rot?: number; flipH: boolean; flipV: boolean };
/** `path`: the groups the shape is in, outermost first. */
type Drawn = (
  | { kind: "text"; block: TextBlock; box?: Box; spt: number; fill: string | null; line: string | null; lineW: number; grad?: Gradient; xf: XfFlags; isPh: boolean }
  | { kind: "shape"; box: Box; spt: number; fill: string | null; line: string | null; lineW: number; grad?: Gradient; arrow: boolean; xf: XfFlags }
  | { kind: "picture"; box: Box; pib: number; crop: { l: number; t: number; r: number; b: number }; xf: XfFlags }
  | { kind: "table"; box: Box; cells: { box: Box; text: string; fill: string | null }[] }
) & { path?: string[] };

/** Table cells laid out by position: the grid their edges make, with spans. */
export function cellsToGrid(cells: { box: Box; text: string; fill: string | null }[], tol = 2): { rows: TableCell[][]; colW: number[]; rowH: number[] } {
  const edges = (vals: number[]) => {
    const out: number[] = [];
    for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    return out;
  };
  const xs = edges(cells.flatMap((c) => [c.box.x, c.box.x + c.box.w]));
  const ys = edges(cells.flatMap((c) => [c.box.y, c.box.y + c.box.h]));
  const at = (e: number[], v: number) => e.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(e[best] - v) ? i : best), 0);
  const nr = Math.max(1, ys.length - 1), nc = Math.max(1, xs.length - 1);
  const rows: TableCell[][] = Array.from({ length: nr }, () => Array.from({ length: nc }, () => ({ text: "" }) as TableCell));
  for (const c of cells) {
    const c0 = at(xs, c.box.x), c1 = Math.max(c0 + 1, at(xs, c.box.x + c.box.w));
    const r0 = at(ys, c.box.y), r1 = Math.max(r0 + 1, at(ys, c.box.y + c.box.h));
    if (r0 >= nr || c0 >= nc) continue;
    const text = c.text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    const cell: TableCell = { text };
    if (text.includes("\n")) cell.html = text.split("\n").map(paraHtml).join("");
    if (c.fill) cell.fill = c.fill;
    if (c1 - c0 > 1) cell.cs = c1 - c0;
    if (r1 - r0 > 1) cell.rs = r1 - r0;
    rows[r0][c0] = cell;
    for (let r = r0; r < Math.min(nr, r1); r++) for (let k = c0; k < Math.min(nc, c1); k++) if (r !== r0 || k !== c0) rows[r][k] = { text: "", merged: true };
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { rows, colW: xs.slice(1).map((x, i) => r1(x - xs[i])), rowH: ys.slice(1).map((y, i) => r1(y - ys[i])) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (s: string) => s.replace(/\r\n?/g, "\r").split("\r");
const paraHtml = (p: string) => `<p>${p ? esc(p).replace(/\n/g, "<br>") : "<br>"}</p>`;

/** Import a .ppt: slide titles, bodies and other text boxes, notes and hidden slides. */
export async function importPpt(data: ArrayBuffer | Uint8Array): Promise<ImportedDeck> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const streams = readCfb(buf);
  const doc = streams.get("PowerPoint Document");
  if (!doc) throw new Error("This file has no PowerPoint document in it.");
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);

  // persist directory: persist id -> stream offset, newest edit wins
  const persist = new Map<number, number>();
  let docRef = 0;
  const cu = streams.get("Current User");
  let editAt = -1;
  if (cu && cu.length >= 20) {
    const cdv = new DataView(cu.buffer, cu.byteOffset, cu.byteLength);
    const r = recAt(cdv, 0);
    if (r && r.type === RT.CurrentUserAtom) editAt = cdv.getUint32(16, true);
  }
  const seenEdits = new Set<number>();
  while (editAt >= 0 && !seenEdits.has(editAt)) {
    seenEdits.add(editAt);
    const ue = recAt(dv, editAt);
    if (!ue || ue.type !== RT.UserEditAtom) break;
    const lastEdit = dv.getUint32(ue.start + 8, true);
    const dirAt = dv.getUint32(ue.start + 12, true);
    if (!docRef) docRef = dv.getUint32(ue.start + 16, true);
    const pd = recAt(dv, dirAt);
    if (pd && pd.type === RT.PersistDirectoryAtom) {
      for (let off = pd.start; off + 4 <= pd.start + pd.len; ) {
        const v = dv.getUint32(off, true);
        const id0 = v & 0xfffff, n = v >>> 20;
        off += 4;
        for (let k = 0; k < n && off + 4 <= pd.start + pd.len; k++, off += 4) if (!persist.has(id0 + k)) persist.set(id0 + k, dv.getUint32(off, true));
      }
    }
    editAt = lastEdit ? lastEdit : -1;
  }
  let document: Rec | null = null;
  if (docRef && persist.has(docRef)) {
    const r = recAt(dv, persist.get(docRef)!);
    if (r?.type === RT.Document) document = r;
  }
  // without a usable edit chain, the last document container in the stream
  if (!document) {
    for (let off = 0; off < doc.length; ) {
      const r = recAt(dv, off);
      if (!r) break;
      if (r.type === RT.Document) document = r;
      off = r.start + r.len;
    }
  }
  if (!document) throw new Error("This PowerPoint file could not be read (no document record).");

  const top = children(dv, document);
  const da = top.find((r) => r.type === RT.DocumentAtom);
  // master units: 576 per inch; slide px are 96 per inch
  const W = da ? Math.round(dv.getInt32(da.start, true) / 6) : 960;
  const H = da ? Math.round(dv.getInt32(da.start + 4, true) / 6) : 720;

  type ListSlide = { persistRef: number; slideId: number; texts: TextBlock[] };
  const lists = top.filter((r) => r.type === RT.SlideListWithText);
  const readList = (inst: number): ListSlide[] => {
    const out: ListSlide[] = [];
    const l = lists.find((r) => r.inst === inst);
    if (!l) return out;
    let cur: ListSlide | null = null;
    let run: Rec[] = [];
    const flush = () => {
      if (cur) cur.texts = textBlocks(dv, run);
      run = [];
    };
    for (const r of children(dv, l)) {
      if (r.type === RT.SlidePersistAtom) {
        flush();
        cur = { persistRef: dv.getUint32(r.start, true), slideId: dv.getUint32(r.start + 12, true), texts: [] };
        out.push(cur);
      } else run.push(r);
    }
    flush();
    return out;
  };
  const slideList = readList(0);
  const notesList = readList(2);
  const notesById = new Map(notesList.map((n) => [n.slideId, n]));

  const containerAt = (ref: number, type: number) => {
    const off = persist.get(ref);
    const r = off === undefined ? null : recAt(dv, off);
    return r && r.type === type ? r : null;
  };

  // the drawing group: picture store and default shape properties
  const dgg = top.find((r) => r.type === RT.PPDrawingGroup);
  const dggC = dgg ? children(dv, dgg).find((r) => r.type === RT.DggContainer) : undefined;
  const dggKids = dggC ? children(dv, dggC) : [];
  const defaults = (() => {
    const fopt = dggKids.find((r) => r.type === RT.FOPT);
    return fopt ? readProps(dv, fopt) : new Map<number, Prop>();
  })();
  const blips: (Rec & { bt: number; foDelay: number; size: number; inline?: Rec })[] = [];
  const bstore = dggKids.find((r) => r.type === RT.BStoreContainer);
  for (const b of bstore ? children(dv, bstore) : []) {
    if (b.type !== RT.FBSE || b.len < 36) {
      blips.push({ ...b, bt: 0, foDelay: -1, size: 0 });
      continue;
    }
    const cbName = dv.getUint8(b.start + 33);
    const inline = b.len > 36 + cbName ? recAt(dv, b.start + 36 + cbName) ?? undefined : undefined;
    blips.push({ ...b, bt: dv.getUint8(b.start), size: dv.getUint32(b.start + 20, true), foDelay: dv.getUint32(b.start + 28, true), inline });
  }
  const picturesStream = streams.get("Pictures");
  const picCache = new Map<number, Promise<{ src: string; orig?: string } | null>>();
  const picture = (pib: number) => {
    let p = picCache.get(pib);
    if (!p) {
      p = (async () => {
        const b = blips[pib - 1];
        if (!b) return null;
        if (b.inline) return blipData(dv, b.inline);
        if (!picturesStream || b.foDelay >= picturesStream.length) return null;
        const pdv = new DataView(picturesStream.buffer, picturesStream.byteOffset, picturesStream.byteLength);
        const r = recAt(pdv, b.foDelay);
        return r ? blipData(pdv, r) : null;
      })().catch(() => null);
      picCache.set(pib, p);
    }
    return p;
  };

  // colour scheme: the first master's (slides that keep their own carry one too)
  const master = (() => {
    for (const [, off] of persist) {
      const r = recAt(dv, off);
      if (r?.type === RT.MainMaster) return r;
    }
    return null;
  })();
  const schemeOf = (r: Rec | null): string[] | null => {
    const a = r ? children(dv, r).find((k) => k.type === RT.ColorSchemeAtom && k.len >= 32) : undefined;
    return a ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rgbHex(dv.getUint32(a.start + i * 4, true))) : null;
  };
  const masterScheme = schemeOf(master) || ["FFFFFF", "000000", "808080", "000000", "BBE0E3", "333399", "009999", "99CC00"];

  /**
   * Everything drawn in a slide or notes container: text (with its
   * placeholder kind), shapes, lines, pictures and tables, in slide px.
   */
  const drawing = (root: Rec, listTexts: TextBlock[], scheme: string[]) => {
    const out: Drawn[] = [];
    const color = (v: number | undefined, fallback: string | null): string | null => {
      if (v === undefined) return fallback;
      const flags = v >>> 24;
      if (flags & 0x08) return scheme[v & 0xff] ?? fallback;
      if (flags & 0x10 || flags & 0x04) return fallback; // system colour / modified colour
      return rgbHex(v);
    };
    const anchorOf = (kids: Rec[], tf: Tf): Box | undefined => {
      const anchor = kids.find((k) => k.type === RT.ClientAnchor);
      const childAnchor = kids.find((k) => k.type === RT.ChildAnchor);
      let raw: [number, number, number, number] | undefined; // left, top, right, bottom
      if (anchor?.len === 8) {
        const [t, l, r, b] = [0, 2, 4, 6].map((i) => dv.getInt16(anchor.start + i, true));
        raw = [l, t, r, b];
      } else if (anchor && anchor.len >= 16) {
        const [t, l, r, b] = [0, 4, 8, 12].map((i) => dv.getInt32(anchor.start + i, true));
        raw = [l, t, r, b];
      } else if (childAnchor && childAnchor.len >= 16) raw = [0, 4, 8, 12].map((i) => dv.getInt32(childAnchor.start + i, true)) as [number, number, number, number];
      return raw ? tf(raw) : undefined;
    };
    const textOf = (kids: Rec[], phType?: number): TextBlock[] => {
      const tb = kids.find((k) => k.type === RT.ClientTextbox);
      if (!tb) return [];
      const recs = children(dv, tb);
      const ref = recs.find((k) => k.type === RT.OutlineTextRefAtom);
      const blocks = ref ? [listTexts[dv.getInt32(ref.start, true)]].filter(Boolean) : textBlocks(dv, recs);
      return blocks.map((b) => (phType !== undefined && b.type === TT.Other ? { ...b, type: phType } : b));
    };
    const shapeOf = (sp: Rec, tf: Tf) => {
      const kids = children(dv, sp);
      const fsp = kids.find((k) => k.type === RT.FSP);
      const flags = fsp && fsp.len >= 8 ? dv.getUint32(fsp.start + 4, true) : 0;
      const props = new Map(defaults);
      for (const k of kids) if (k.type === RT.FOPT || k.type === RT.SecondaryFOPT || k.type === RT.TertiaryFOPT) for (const [id, v] of readProps(dv, k)) props.set(id, v);
      const cd = kids.find((k) => k.type === RT.ClientData);
      const ph = cd && children(dv, cd).find((k) => k.type === RT.PlaceholderAtom);
      const phType = ph ? PLACEHOLDER_TEXT[dv.getUint8(ph.start + 4)] : undefined;
      return { kids, spt: fsp?.inst ?? 0, flags, props, phType, isPh: !!ph, box: anchorOf(kids, tf) };
    };
    const walk = (r: Rec, tf: Tf, path: string[] = []) => {
      const at = path.length ? { path } : {};
      for (const c of children(dv, r)) {
        if (c.type === RT.SpgrContainer) {
          const kids = children(dv, c);
          const head = kids[0]?.type === RT.SpContainer ? shapeOf(kids[0], tf) : null;
          const fspgr = head?.kids.find((k) => k.type === RT.FSPGR);
          let inner = tf;
          if (head?.box && fspgr && fspgr.len >= 16) {
            const [l, t, rr, b] = [0, 4, 8, 12].map((i) => dv.getInt32(fspgr.start + i, true));
            const g = head.box;
            const sx = rr !== l ? g.w / (rr - l) : 1, sy = b !== t ? g.h / (b - t) : 1;
            inner = ([x0, y0, x1, y1]) => ({ x: g.x + (x0 - l) * sx, y: g.y + (y0 - t) * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy });
          }
          // a table: a group whose shape carries table properties; its cells are the group's text rectangles
          if (head?.props.has(0x3a0)) {
            const cells: { box: Box; text: string; fill: string | null }[] = [];
            for (const k of kids.slice(1)) {
              if (k.type !== RT.SpContainer) continue;
              const cell = shapeOf(k, inner);
              if (cell.spt !== 1 || !cell.box) continue;
              const filled = boolProp(cell.props, 0x1bf, 4, true);
              cells.push({ box: cell.box, text: textOf(cell.kids).map((b) => b.text).join("\r"), fill: filled ? color(cell.props.get(0x181)?.v, null) : null });
            }
            if (cells.length && head.box) out.push({ kind: "table", box: head.box, cells, ...at });
            continue;
          }
          walk(c, inner, [...path, genId("g")]);
          continue;
        }
        if (c.type !== RT.SpContainer) {
          if (c.container) walk(c, tf, path);
          continue;
        }
        const sh = shapeOf(c, tf);
        // the patriarch, the background and deleted shapes draw nothing
        if (sh.flags & (0x4 | 0x8 | 0x400) || sh.flags & 0x1) continue;
        const blocks = textOf(sh.kids, sh.phType);
        const rot = fixed(sh.props.get(0x4)?.v);
        let box = sh.box;
        // rotated by 45-135 or 225-315 degrees: the anchor holds the turned box
        const r90 = ((Math.round(rot) % 360) + 360) % 360;
        if (box && ((r90 >= 45 && r90 < 135) || (r90 >= 225 && r90 < 315))) box = { x: box.x + box.w / 2 - box.h / 2, y: box.y + box.h / 2 - box.w / 2, w: box.h, h: box.w };
        const xf = { rot: r90 || undefined, flipH: !!(sh.flags & 0x40), flipV: !!(sh.flags & 0x80) };
        const pib = sh.props.get(0x104)?.v;
        if (sh.spt === 75 || (pib && !blocks.length && sh.spt !== 0)) {
          if (pib && box) {
            const crop = { t: fixed(sh.props.get(0x100)?.v) / 1, b: fixed(sh.props.get(0x101)?.v), l: fixed(sh.props.get(0x102)?.v), r: fixed(sh.props.get(0x103)?.v) };
            out.push({ kind: "picture", box, pib, crop, xf, ...at });
          }
          continue;
        }
        const filled = boolProp(sh.props, 0x1bf, 4, true);
        const lined = boolProp(sh.props, 0x1ff, 3, true);
        const fillType = sh.props.get(0x180)?.v ?? 0;
        const fill = filled ? color(sh.props.get(0x181)?.v, null) : null;
        const back = color(sh.props.get(0x183)?.v, "FFFFFF");
        const line = lined ? color(sh.props.get(0x1c0)?.v, "000000") : null;
        const lineW = (sh.props.get(0x1cb)?.v ?? 9525) / 9525;
        const grad: Gradient | undefined = filled && fill && back && fillType >= 4 && fillType <= 7 ? { kind: fillType === 4 || fillType === 7 ? "linear" : "radial", angle: ((((fixed(sh.props.get(0x18b)?.v) + 90) % 360) + 360) % 360), stops: [{ pos: 0, color: fill }, { pos: 100, color: back }] } : undefined;
        const arrow = (sh.props.get(0x1d0)?.v ?? 0) > 0 || (sh.props.get(0x1d1)?.v ?? 0) > 0;
        if (blocks.length) for (const block of blocks) out.push({ kind: "text", block, box, spt: sh.spt, fill, line, lineW, grad, xf, isPh: sh.isPh, ...at });
        else if (box && sh.spt !== 202) out.push({ kind: "shape", box, spt: sh.spt, fill, line, lineW, grad, arrow, xf, ...at });
      }
    };
    walk(root, ([l, t, r, b]) => ({ x: l / 6, y: t / 6, w: (r - l) / 6, h: (b - t) / 6 }));
    return { out, picture };
  };
  const shapes = (root: Rec, listTexts: TextBlock[]) =>
    drawing(root, listTexts, masterScheme).out.filter((d): d is Extract<Drawn, { kind: "text" }> => d.kind === "text").map((d) => ({ block: d.block, box: d.box }));

  const warnings = new Set<string>(["PowerPoint 97-2003 (.ppt) files import with their text, shapes, pictures, tables and notes; text formatting, charts and animations are left out. Save the file as .pptx in PowerPoint for a full import."]);
  const slides: Slide[] = [];
  for (const ls of slideList) {
    const sc = containerAt(ls.persistRef, RT.Slide);
    const drawn = sc ? drawing(sc, ls.texts, schemeOf(sc) || masterScheme).out : [];
    const found: { block: TextBlock; box?: Box; d?: Extract<Drawn, { kind: "text" }> }[] = drawn.filter((d): d is Extract<Drawn, { kind: "text" }> => d.kind === "text").map((d) => ({ block: d.block, box: d.box, d }));
    // placeholder text kept only in the slide list
    for (const t of ls.texts) if (!found.some((f) => f.block === t || (f.block.type === t.type && f.block.text === t.text))) found.push({ block: t });

    let hidden = false;
    let notesRef = 0;
    if (sc) {
      for (const c of children(dv, sc)) {
        if (c.type === RT.SSSlideInfoAtom && c.len >= 12) hidden = !!(dv.getUint16(c.start + 10, true) & 0x4);
        if (c.type === RT.SlideAtom && c.len >= 20) notesRef = dv.getUint32(c.start + 16, true);
      }
    }
    let notes = "";
    const nl = notesRef ? notesById.get(notesRef) : undefined;
    const nc = nl ? containerAt(nl.persistRef, RT.Notes) : null;
    if (nc) notes = shapes(nc, nl!.texts).filter((f) => f.block.type === TT.Notes).map((f) => f.block.text).join("\n");
    notes = notes.replace(/\r\n?/g, "\n").trim();

    const title = found.find((f) => isTitle(f.block.type));
    const bodies = found.filter((f) => isBody(f.block.type));
    const others = new Set(found.filter((f) => f.block.type === TT.Other && f.block.text.trim()));
    // the drawing in its order: text boxes, shapes (with their text), lines, pictures and tables
    const elements: SlideElement[] = [];
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const geo = (b: Box) => ({ x: r1(b.x), y: r1(b.y), w: Math.max(1, r1(b.w)), h: Math.max(1, r1(b.h)) });
    const xfOf = (xf: XfFlags) => ({ ...(xf.rot ? { rot: xf.rot } : {}), ...(xf.flipH ? { flipH: true } : {}), ...(xf.flipV ? { flipV: true } : {}) });
    let n = 0;
    const pathOf = new Map<SlideElement, string[]>();
    for (const d of drawn) {
      const z = ++n;
      const add = (e: SlideElement) => {
        elements.push(e);
        if (d.path?.length) pathOf.set(e, d.path);
      };
      if (d.kind === "text") {
        const f = found.find((x) => x.d === d);
        if (!f || !others.has(f)) continue;
        const b = d.box ?? { x: 48, y: 48 + elements.length * 60, w: W - 96, h: 50 };
        const html = paras(d.block.text).map(paraHtml).join("");
        const shape = SPT[d.spt];
        if (!d.isPh && shape && d.spt !== 202 && shape !== "line" && (d.fill || d.line)) {
          add({ id: genId("e"), z, type: "shape", shape, fill: d.fill, line: d.line, lineW: r1(d.lineW), ...(d.grad ? { grad: d.grad } : {}), html, ...geo(b), ...xfOf(d.xf) });
        } else add({ id: genId("e"), z, type: "text", ...geo({ ...b, w: Math.max(20, b.w), h: Math.max(20, b.h) }), html, ...xfOf(d.xf) });
      } else if (d.kind === "shape") {
        const shape = SPT[d.spt] || "rect";
        if (shape === "line") {
          if (!d.line) continue;
          add({ id: genId("e"), z, type: "shape", shape: d.arrow ? "lineArrow" : "line", fill: null, line: d.line, lineW: r1(d.lineW), ...geo(d.box), ...xfOf(d.xf) });
        } else {
          if (!d.fill && !d.line) continue;
          if (!SPT[d.spt]) warnings.add("Some .ppt shapes without a preset geometry (freeforms) were imported as rectangles.");
          add({ id: genId("e"), z, type: "shape", shape, fill: d.fill, line: d.line, lineW: r1(d.lineW), ...(d.grad ? { grad: d.grad } : {}), ...geo(d.box), ...xfOf(d.xf) });
        }
      } else if (d.kind === "picture") {
        const pic = await picture(d.pib);
        if (!pic) {
          warnings.add("Some .ppt pictures could not be read.");
          continue;
        }
        const crop = { l: d.crop.l, t: d.crop.t, r: d.crop.r, b: d.crop.b };
        const cropped = crop.l > 0 || crop.t > 0 || crop.r > 0 || crop.b > 0;
        add({ id: genId("e"), z, type: "image", src: pic.src, ...(pic.orig ? { orig: pic.orig } : {}), ...(cropped && crop.l + crop.r < 1 && crop.t + crop.b < 1 ? { crop } : {}), ...geo(d.box), ...xfOf(d.xf) });
      } else if (d.kind === "table") {
        const g = cellsToGrid(d.cells);
        add({ id: genId("e"), z, type: "table", rows: g.rows, colW: g.colW, rowH: g.rowH, fontSize: 14, ...geo(d.box) });
      }
    }
    // groups: those still holding two or more objects (some shapes draw nothing)
    const size = new Map<string, number>();
    for (const p of pathOf.values()) for (const g of p) size.set(g, (size.get(g) || 0) + 1);
    for (const [e, p] of pathOf) {
      const [group, ...sub] = p.filter((g) => (size.get(g) || 0) > 1);
      if (group) {
        e.group = group;
        if (sub.length) e.sub = sub;
      }
    }
    const centered = title?.block.type === TT.CenterTitle || bodies.some((b) => b.block.type === TT.CenterBody);
    const bodyText = bodies.map((b) => b.block.text).join("\r");
    const body = bodies.length
      ? centered
        ? paras(bodyText).map(paraHtml).join("")
        : `<ul>${paras(bodyText).filter((p) => p.trim()).map((p) => `<li>${paraHtml(p)}</li>`).join("")}</ul>`
      : "";
    const titleText = title ? title.block.text.replace(/\r\n?|\n/g, " ").trim() : "";
    const box = (f?: { box?: Box }) => (f?.box && f.box.w > 0 && f.box.h > 0 ? { x: Math.round(f.box.x), y: Math.round(f.box.y), w: Math.round(f.box.w), h: Math.round(f.box.h) } : undefined);
    slides.push({
      id: genId(),
      title: titleText,
      body,
      notes,
      layout: centered ? "title" : bodies.length ? "content" : title ? "titleOnly" : "blank",
      bg: "",
      bgImg: "",
      elements,
      ...(hidden ? { hidden: true } : {}),
      ...(title && box(title) ? { tbox: box(title) } : {}),
      ...(bodies[0] && box(bodies[0]) ? { bbox: box(bodies[0]) } : {}),
    });
  }
  if (!slides.length) throw new Error("No slides were found in this PowerPoint file.");
  return { w: W, h: H, theme: "plain", slides, warnings: [...warnings] };
}
