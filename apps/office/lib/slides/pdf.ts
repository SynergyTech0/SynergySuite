// A small PDF 1.4 writer: pages and reusable form XObjects (one per slide, so
// slides, notes pages and handouts share the same drawing), the standard 14
// fonts with WinAnsi text, RGB images (JPEG passed through, others deflated
// with an alpha mask), axial/radial shadings, transparency and link
// annotations. Content streams are deflated with CompressionStream.

export type StdFont = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Helvetica-BoldOblique" | "Times-Roman" | "Times-Bold" | "Times-Italic" | "Times-BoldItalic" | "Courier" | "Courier-Bold" | "Courier-Oblique" | "Courier-BoldOblique";
export type RGB = [number, number, number];
export type Matrix = [number, number, number, number, number, number];
export type Stop = { pos: number; color: RGB };

const enc = new TextEncoder();

/** A number for a content stream: at most 3 decimals, no exponent. */
export const f = (n: number) => {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

// Unicode -> WinAnsiEncoding byte for the 0x80-0x9F block (the rest of Latin-1 maps to itself)
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
/** Characters that need no glyph of their own when missing from WinAnsi. */
const SUBST: Record<string, string> = { "−": "-", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "⁡": "", "⁢": "", "⁣": "", "​": "" };

export function winAnsiByte(ch: string): number | undefined {
  const c = ch.codePointAt(0)!;
  if (c >= 0x20 && c <= 0x7e) return c;
  if (c >= 0xa0 && c <= 0xff) return c;
  return WIN_ANSI[c];
}

/** Can this text be written with a standard font (after harmless substitutions)? */
export const isWinAnsi = (s: string) => [...s].every((ch) => ch in SUBST || winAnsiByte(ch) !== undefined || ch === "\t");

/** A PDF literal string of WinAnsi bytes. */
export function pdfString(s: string): string {
  let out = "(";
  for (const ch0 of s) {
    const ch = ch0 in SUBST ? SUBST[ch0] : ch0 === "\t" ? " " : ch0;
    if (!ch) continue;
    const b = winAnsiByte(ch) ?? 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

/** Text outside PDFDocEncoding goes in UTF-16BE (for metadata and link titles). */
function textString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/([()\\])/g, "\\$1")})`;
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

export const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Builder for one content stream. */
export class Ops {
  parts: string[] = [];
  push(s: string) {
    this.parts.push(s);
    return this;
  }
  save() { return this.push("q"); }
  restore() { return this.push("Q"); }
  cm(m: Matrix) { return this.push(`${m.map(f).join(" ")} cm`); }
  fillColor(c: RGB) { return this.push(`${c.map((v) => f(v / 255)).join(" ")} rg`); }
  strokeColor(c: RGB) { return this.push(`${c.map((v) => f(v / 255)).join(" ")} RG`); }
  lineWidth(w: number) { return this.push(`${f(w)} w`); }
  cap(c: "butt" | "round" | "square") { return this.push(`${c === "round" ? 1 : c === "square" ? 2 : 0} J`); }
  join(j: "miter" | "round" | "bevel") { return this.push(`${j === "round" ? 1 : j === "bevel" ? 2 : 0} j`); }
  dash(a: number[]) { return this.push(`[${a.map(f).join(" ")}] 0 d`); }
  gs(name: string) { return this.push(`/${name} gs`); }
  m(x: number, y: number) { return this.push(`${f(x)} ${f(y)} m`); }
  l(x: number, y: number) { return this.push(`${f(x)} ${f(y)} l`); }
  c(x1: number, y1: number, x2: number, y2: number, x: number, y: number) { return this.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)} c`); }
  h() { return this.push("h"); }
  rect(x: number, y: number, w: number, h: number) { return this.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re`); }
  fill(evenOdd = false) { return this.push(evenOdd ? "f*" : "f"); }
  stroke() { return this.push("S"); }
  fillStroke() { return this.push("B"); }
  clip(evenOdd = false) { return this.push(evenOdd ? "W* n" : "W n"); }
  endPath() { return this.push("n"); }
  shade(name: string) { return this.push(`/${name} sh`); }
  xobject(name: string) { return this.push(`/${name} Do`); }
  /** Text drawn upright in a y-down space: `m` places the baseline origin. */
  /** Text in an embedded (CID) font: `cids` are the glyphs' ids in that font. */
  glyphs(font: string, size: number, m: Matrix, cids: number[], hscale = 100) {
    const hex = cids.map((c) => c.toString(16).padStart(4, "0")).join("");
    return this.push(`BT /${font} ${f(size)} Tf ${hscale !== 100 ? `${f(hscale)} Tz ` : ""}${m.map(f).join(" ")} Tm <${hex}> Tj ET`);
  }
  text(font: string, size: number, m: Matrix, s: string, hscale = 100) {
    return this.push(`BT /${font} ${f(size)} Tf ${hscale !== 100 ? `${f(hscale)} Tz ` : ""}${m.map(f).join(" ")} Tm ${pdfString(s)} Tj ET`);
  }
  toString() {
    return this.parts.join("\n");
  }
}

export type LinkAnnot = { rect: [number, number, number, number]; url?: string; page?: number };

type Obj = { body: string | null; stream?: Uint8Array; deflate?: boolean };

/** What an embedded font's subset is built from: the glyphs used, in CID order (CID 0 = .notdef). */
export type FontSubset = {
  /** an OpenType font (CFF outlines) whose glyph i is CID i */
  bytes: Uint8Array;
  /** advance widths, 1000 units per em, by CID */
  widths: number[];
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
  italic?: boolean;
};
/** A font embedded as a subset: glyphs get CIDs as they are used, and the subset is built when the PDF is saved. */
export type CidFont = { key: string; cid(glyph: number, text: string): number };
type Embedded = { key: string; name: string; glyphs: number[]; text: string[]; index: Map<number, number>; build: (glyphs: number[]) => Promise<FontSubset | null> };

/** A PDF name with its delimiters and non-ASCII characters written as #xx. */
const pdfName = (s: string) => s.replace(/[^!-~]|[#()<>[\]{}\/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, "0")}`).slice(0, 100) || "Font";

/** A ToUnicode CMap: each CID to the text it stands for (copying and searching the PDF). */
export function toUnicodeCMap(text: string[]): string {
  const hex16 = (s: string) => [...s].map((ch) => { const c = ch.codePointAt(0)!; if (c < 0x10000) return c.toString(16).padStart(4, "0"); const v = c - 0x10000; return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)); }).join("");
  const rows = text.map((t, cid) => (cid && t ? `<${cid.toString(16).padStart(4, "0")}> <${hex16(t)}>` : "")).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 100) chunks.push(`${Math.min(100, rows.length - i)} beginbfchar\n${rows.slice(i, i + 100).join("\n")}\nendbfchar`);
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const out = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export class PdfWriter {
  private objs: Obj[] = [];
  private fonts = new Map<StdFont, string>();
  private embedded = new Map<string, Embedded>();
  private gstates = new Map<string, string>();
  private res = { font: new Map<string, number>(), xobj: new Map<string, number>(), gs: new Map<string, number>(), sh: new Map<string, number>() };
  private pages: { id: number; annots: LinkAnnot[] }[] = [];
  private pagesId: number;
  private resId: number;
  private counter = 0;
  title = "";

  constructor() {
    this.alloc(); // 1: catalog
    this.pagesId = this.alloc();
    this.resId = this.alloc();
  }

  private alloc(): number {
    this.objs.push({ body: null });
    return this.objs.length;
  }
  private set(id: number, body: string, stream?: Uint8Array, deflate = false) {
    this.objs[id - 1] = { body, stream, deflate };
  }

  font(name: StdFont): string {
    let key = this.fonts.get(name);
    if (!key) {
      key = `F${this.fonts.size + 1}`;
      const id = this.alloc();
      this.set(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
      this.fonts.set(name, key);
      this.res.font.set(key, id);
    }
    return key;
  }

  /**
   * A font embedded as a subset (Type 0, Identity-H, CFF outlines). `id`
   * names the font program; `build` makes the subset from the glyphs used.
   */
  cidFont(id: string, name: string, build: (glyphs: number[]) => Promise<FontSubset | null>): CidFont {
    let e = this.embedded.get(id);
    if (!e) {
      e = { key: `CF${this.embedded.size + 1}`, name, glyphs: [0], text: [""], index: new Map([[0, 0]]), build };
      this.embedded.set(id, e);
      this.res.font.set(e.key, this.alloc());
    }
    const em = e;
    return {
      key: em.key,
      cid: (glyph: number, text: string) => {
        let c = em.index.get(glyph);
        if (c === undefined) {
          c = em.glyphs.length;
          em.glyphs.push(glyph);
          em.text.push(text);
          em.index.set(glyph, c);
        }
        return c;
      },
    };
  }

  /** The embedded fonts' objects, once every glyph is known. */
  private async writeFonts() {
    let n = 0;
    for (const e of this.embedded.values()) {
      const id = this.res.font.get(e.key)!;
      const sub = await e.build(e.glyphs).catch(() => null);
      if (!sub) {
        // the subset could not be made: the text falls back to a standard font's question marks
        this.set(id, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
        continue;
      }
      // subset tag: six capital letters
      const tag = String.fromCharCode(...[...Array(6)].map((_, i) => 65 + ((++n * 7 + i * 3 + e.glyphs.length) % 26)));
      const base = `${tag}+${pdfName(e.name)}`;
      const file = this.alloc(), desc = this.alloc(), cid = this.alloc(), uni = this.alloc();
      this.set(file, `<< /Subtype /OpenType`, sub.bytes, true);
      this.set(desc, `<< /Type /FontDescriptor /FontName /${base} /Flags ${sub.italic ? 68 : 4} /FontBBox [${sub.bbox.map((v) => Math.round(v)).join(" ")}] /ItalicAngle ${sub.italic ? -12 : 0} /Ascent ${Math.round(sub.ascent)} /Descent ${Math.round(sub.descent)} /CapHeight ${Math.round(sub.ascent * 0.9)} /StemV 80 /FontFile3 ${file} 0 R >>`);
      this.set(cid, `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [0 [${sub.widths.map((w) => Math.round(w)).join(" ")}]] >>`);
      this.set(uni, "<<", enc.encode(toUnicodeCMap(e.text)), true);
      this.set(id, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${uni} 0 R >>`);
    }
  }

  /** Graphics state with fill/stroke opacity. */
  alpha(fill: number, stroke = fill): string {
    const k = `${f(fill)}/${f(stroke)}`;
    let key = this.gstates.get(k);
    if (!key) {
      key = `GS${this.gstates.size + 1}`;
      const id = this.alloc();
      this.set(id, `<< /Type /ExtGState /ca ${f(fill)} /CA ${f(stroke)} >>`);
      this.gstates.set(k, key);
      this.res.gs.set(key, id);
    }
    return key;
  }

  /** A JPEG image as-is. */
  jpeg(bytes: Uint8Array, w: number, h: number): string {
    const key = `Im${++this.counter}`;
    const id = this.alloc();
    this.set(id, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, bytes);
    this.res.xobj.set(key, id);
    return key;
  }

  /** Raw RGBA pixels: RGB data plus a soft mask when any pixel is not opaque. */
  rgba(px: Uint8Array | Uint8ClampedArray, w: number, h: number): string {
    const rgb = new Uint8Array(w * h * 3);
    const a = new Uint8Array(w * h);
    let opaque = true;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      rgb[i * 3] = px[j];
      rgb[i * 3 + 1] = px[j + 1];
      rgb[i * 3 + 2] = px[j + 2];
      a[i] = px[j + 3];
      if (px[j + 3] !== 255) opaque = false;
    }
    let smask = "";
    if (!opaque) {
      const mid = this.alloc();
      this.set(mid, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8`, a, true);
      smask = ` /SMask ${mid} 0 R`;
    }
    const key = `Im${++this.counter}`;
    const id = this.alloc();
    this.set(id, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, rgb, true);
    this.res.xobj.set(key, id);
    return key;
  }

  /** Axial (coords x0 y0 x1 y1) or radial (x0 y0 r0 x1 y1 r1) shading through the stops. */
  shading(kind: "axial" | "radial", coords: number[], stops: Stop[]): string {
    const st = [...stops].sort((p, q) => p.pos - q.pos);
    if (st.length === 1) st.push({ ...st[0], pos: 1 });
    const c = (rgb: RGB) => `[${rgb.map((v) => f(v / 255)).join(" ")}]`;
    const fn = (a: Stop, b: Stop) => `<< /FunctionType 2 /Domain [0 1] /C0 ${c(a.color)} /C1 ${c(b.color)} /N 1 >>`;
    let func: string;
    const first = st[0].pos, last = st[st.length - 1].pos;
    const span = last - first || 1;
    if (st.length === 2) func = fn(st[0], st[1]);
    else {
      const fns = st.slice(1).map((s, i) => fn(st[i], s));
      const bounds = st.slice(1, -1).map((s) => f((s.pos - first) / span));
      func = `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(" ")}] /Bounds [${bounds.join(" ")}] /Encode [${fns.map(() => "0 1").join(" ")}] >>`;
    }
    // stops that do not span 0..1 move the ends of the gradient line
    let co = coords;
    if (kind === "axial" && (first > 0 || last < 1)) {
      const [x0, y0, x1, y1] = coords;
      co = [x0 + (x1 - x0) * first, y0 + (y1 - y0) * first, x0 + (x1 - x0) * last, y0 + (y1 - y0) * last];
    }
    const key = `Sh${++this.counter}`;
    const id = this.alloc();
    this.set(id, `<< /ShadingType ${kind === "axial" ? 2 : 3} /ColorSpace /DeviceRGB /Coords [${co.map(f).join(" ")}] /Function ${func} /Extend [true true] >>`);
    this.res.sh.set(key, id);
    return key;
  }

  /** A form XObject drawn in a w x h box (its content uses y-down coordinates from the top-left). */
  form(content: string, w: number, h: number): string {
    const key = `Fm${++this.counter}`;
    const id = this.alloc();
    this.set(id, `<< /Type /XObject /Subtype /Form /BBox [0 0 ${f(w)} ${f(h)}] /Matrix [1 0 0 -1 0 ${f(h)}] /Resources ${this.resId} 0 R`, enc.encode(content), true);
    this.res.xobj.set(key, id);
    return key;
  }

  addPage(w: number, h: number, content: string, annots: LinkAnnot[] = []): number {
    const id = this.alloc();
    const cid = this.alloc();
    this.set(cid, "<<", enc.encode(content), true);
    this.set(id, `<< /Type /Page /Parent ${this.pagesId} 0 R /MediaBox [0 0 ${f(w)} ${f(h)}] /Resources ${this.resId} 0 R /Contents ${cid} 0 R`);
    this.pages.push({ id, annots });
    return this.pages.length - 1;
  }

  get pageCount() {
    return this.pages.length;
  }

  async save(): Promise<Uint8Array> {
    await this.writeFonts();
    // annotations (links) need the page objects
    for (const p of this.pages) {
      if (!p.annots.length) continue;
      const ids = p.annots.map((a) => {
        const id = this.alloc();
        const r = a.rect.map(f).join(" ");
        const action = a.url ? `/A << /S /URI /URI ${textString(a.url)} >>` : a.page !== undefined && this.pages[a.page] ? `/Dest [${this.pages[a.page].id} 0 R /Fit]` : "";
        this.set(id, `<< /Type /Annot /Subtype /Link /Rect [${r}] /Border [0 0 0] ${action} >>`);
        return id;
      });
      const o = this.objs[p.id - 1];
      o.body = `${o.body} /Annots [${ids.map((i) => `${i} 0 R`).join(" ")}]`;
    }
    for (const p of this.pages) this.objs[p.id - 1].body += " >>";
    this.set(1, `<< /Type /Catalog /Pages ${this.pagesId} 0 R >>`);
    this.set(this.pagesId, `<< /Type /Pages /Kids [${this.pages.map((p) => `${p.id} 0 R`).join(" ")}] /Count ${this.pages.length} >>`);
    const dict = (m: Map<string, number>) => [...m].map(([k, id]) => `/${k} ${id} 0 R`).join(" ");
    this.set(this.resId, `<< /ProcSet [/PDF /Text /ImageB /ImageC] /Font << ${dict(this.res.font)} >> /XObject << ${dict(this.res.xobj)} >> /ExtGState << ${dict(this.res.gs)} >> /Shading << ${dict(this.res.sh)} >> >>`);
    const infoId = this.alloc();
    this.set(infoId, `<< /Producer (Synergy Office) ${this.title ? `/Title ${textString(this.title)} ` : ""}>>`);

    const chunks: Uint8Array[] = [];
    let len = 0;
    const put = (b: Uint8Array | string) => {
      const u = typeof b === "string" ? enc.encode(b) : b;
      chunks.push(u);
      len += u.length;
    };
    // 1.6 for OpenType font programs (embedded subsets)
    put(`%PDF-${this.embedded.size ? "1.6" : "1.4"}\n%\xe2\xe3\xcf\xd3\n`.replace(/[\u0080-ÿ]/g, (c) => c)); // binary marker line
    const offsets: number[] = [];
    for (const [i, o] of this.objs.entries()) {
      offsets.push(len);
      put(`${i + 1} 0 obj\n`);
      if (o.stream) {
        const data = o.deflate ? await deflate(o.stream) : o.stream;
        const head = o.body === "<<" ? "<<" : o.body!;
        put(`${head} /Length ${data.length}${o.deflate ? " /Filter /FlateDecode" : ""} >>\nstream\n`);
        put(data);
        put("\nendstream\nendobj\n");
      } else put(`${o.body ?? "null"}\nendobj\n`);
    }
    const xref = len;
    put(`xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`);
    for (const off of offsets) put(`${String(off).padStart(10, "0")} 00000 n \n`);
    put(`trailer\n<< /Size ${this.objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
