// Text the standard PDF fonts can't encode (Cyrillic, Greek, CJK, ...) is
// written as real text in an embedded font subset, so it stays vector,
// selectable and searchable. The font program comes from the fonts the
// browser can hand over: the computer's own fonts through the Local Font
// Access API (Chrome and Edge, with the person's permission) or a TrueType,
// OpenType or WOFF font the page loaded with @font-face. Scripts that need
// shaping or run right to left (Arabic, Hebrew, Indic, Thai, ...) and emoji
// are left to the caller's picture fallback, as is any text no available font
// covers.
import type { CidFont, FontSubset, PdfWriter } from "./pdf";

/** Minimal shape of the opentype.js API used here. */
type OtPath = { commands: unknown[] };
type OtGlyph = { name?: string; unicode?: number; advanceWidth?: number; path: OtPath; getPath?: unknown };
type OtFont = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  names: Record<string, Record<string, Record<string, string>>>;
  tables: { head?: { xMin: number; yMin: number; xMax: number; yMax: number; macStyle?: number }; post?: { italicAngle?: number } };
  glyphs: { get(i: number): OtGlyph; length: number };
  charToGlyphIndex(ch: string): number;
};
type Ot = { parse(buf: ArrayBuffer, opt?: object): OtFont; Font: new (o: object) => { toArrayBuffer(): ArrayBuffer }; Glyph: new (o: object) => OtGlyph };

let otLib: Promise<Ot> | null = null;
async function opentype(): Promise<Ot> {
  otLib ??= import("opentype.js").then((m) => ((m as unknown as Ot).parse ? (m as unknown as Ot) : (m as unknown as { default: Ot }).default));
  return otLib;
}

/** Text a plain left-to-right run of glyphs draws correctly (no shaping, no bidi, no emoji). */
export function plainScript(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x0300 && c <= 0x036f) || // combining marks
      (c >= 0x0590 && c <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, NKo...
      (c >= 0x0900 && c <= 0x0dff) || // Indic
      (c >= 0x0e00 && c <= 0x0fff) || // Thai, Lao, Tibetan
      (c >= 0x1000 && c <= 0x109f) || // Myanmar
      (c >= 0x1100 && c <= 0x11ff) || // Hangul jamo (composed)
      (c >= 0x1780 && c <= 0x17ff) || // Khmer
      (c >= 0x200c && c <= 0x200f) || // joiners, direction marks
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0xfb1d && c <= 0xfdff) || // Hebrew/Arabic presentation forms
      (c >= 0xfe70 && c <= 0xfeff) ||
      (c >= 0xfe00 && c <= 0xfe0f) || // variation selectors
      c >= 0x1f000 // emoji and other astral symbols
    )
      return false;
  }
  return true;
}

/** One font of a TrueType collection as a standalone sfnt (opentype.js reads single fonts only). */
export function fontFromCollection(buf: ArrayBuffer, index: number): ArrayBuffer | null {
  const v = new DataView(buf);
  if (v.getUint32(0) !== 0x74746366) return buf; // not 'ttcf'
  const n = v.getUint32(8);
  if (index >= n) return null;
  const off = v.getUint32(12 + index * 4);
  const numTables = v.getUint16(off + 4);
  const tables: { tag: number; sum: number; o: number; len: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = off + 12 + i * 16;
    tables.push({ tag: v.getUint32(r), sum: v.getUint32(r + 4), o: v.getUint32(r + 8), len: v.getUint32(r + 12) });
  }
  const head = 12 + numTables * 16;
  const size = head + tables.reduce((a, t) => a + ((t.len + 3) & ~3), 0);
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  out.set(new Uint8Array(buf, off, 12), 0);
  let at = head;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    ov.setUint32(r, t.tag);
    ov.setUint32(r + 4, t.sum);
    ov.setUint32(r + 8, at);
    ov.setUint32(r + 12, t.len);
    out.set(new Uint8Array(buf, t.o, t.len), at);
    at += (t.len + 3) & ~3;
  });
  return out.buffer;
}

/** A font's name as the name table gives it (Windows names first). */
function nameOf(font: OtFont, key: string): string {
  for (const plat of ["windows", "macintosh", "unicode"]) {
    const v = font.names?.[plat]?.[key];
    if (v) return v.en || Object.values(v)[0] || "";
  }
  return "";
}

/**
 * The subset of `font` holding `glyphs` (font glyph indices; the first is
 * .notdef), in that order: glyph i of the subset is CID i.
 */
export async function buildSubset(font: OtFont, glyphs: number[], italic = false): Promise<FontSubset> {
  const ot = await opentype();
  const k = 1000 / font.unitsPerEm;
  const gl = glyphs.map((gi, i) => {
    const g = font.glyphs.get(gi);
    return new ot.Glyph({ name: i ? `g${i}` : ".notdef", ...(i && g.unicode ? { unicode: g.unicode } : {}), advanceWidth: g.advanceWidth ?? font.unitsPerEm, path: g.path });
  });
  const family = nameOf(font, "fontFamily") || "Embedded";
  const sub = new ot.Font({ familyName: family, styleName: nameOf(font, "fontSubfamily") || "Regular", unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, glyphs: gl });
  const h = font.tables.head;
  return {
    bytes: new Uint8Array(sub.toArrayBuffer()),
    widths: glyphs.map((gi) => (font.glyphs.get(gi).advanceWidth ?? font.unitsPerEm) * k),
    bbox: h ? [h.xMin * k, h.yMin * k, h.xMax * k, h.yMax * k] : [0, font.descender * k, 1000, font.ascender * k],
    ascent: font.ascender * k,
    descent: font.descender * k,
    italic,
  };
}

/** A font that can stand in for some text: its parsed program and identity. */
type Source = { id: string; family: string; style: string; load: () => Promise<OtFont | null> };

/** Families likely to cover a script, tried after the text's own fonts. */
const FALLBACKS = ["Noto Sans", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Noto Sans CJK TC", "Source Han Sans", "Microsoft YaHei", "SimSun", "PingFang SC", "Hiragino Sans", "Yu Gothic", "Meiryo", "MS Gothic", "Malgun Gothic", "Apple SD Gothic Neo", "Arial Unicode MS", "Segoe UI", "Arial", "DejaVu Sans", "Liberation Sans", "Droid Sans Fallback", "WenQuanYi Micro Hei"];

/** How long to wait for the Local Font Access permission, and the largest font file read. */
const LOCAL_WAIT_MS = 8000;
const MAX_FONT_BYTES = 24 * 1024 * 1024;
/** Fonts tried for one piece of text before it is left to the picture fallback. */
const MAX_TRIES = 6;
/** Set once the computer's fonts were refused or never came: later exports don't ask again in this page. */
let localRefused = false;

type LocalFontData = { family: string; style: string; fullName: string; postscriptName: string; blob(): Promise<Blob> };

/**
 * The fonts embedded text can use during one PDF export, and the CID fonts
 * made from them. `local` asks the browser for the computer's fonts (the
 * Local Font Access permission prompt) the first time non-Latin text needs one.
 */
export class TextFonts {
  private sources: Promise<Source[]> | null = null;
  private parsed = new Map<string, Promise<OtFont | null>>();
  private cid = new Map<string, CidFont>();
  constructor(private pdf: PdfWriter, private opts: { local?: boolean } = { local: true }) {}

  private async listSources(): Promise<Source[]> {
    const out: Source[] = [];
    // fonts the page loaded itself (TrueType, OpenType or WOFF; WOFF2 needs Brotli, which browsers don't expose)
    try {
      for (const sheet of [...document.styleSheets]) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of [...rules]) {
          if (!(r instanceof CSSFontFaceRule)) continue;
          const fam = r.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
          const url = [...r.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]).find((u) => /\.(ttf|otf|woff)(\?|#|$)/i.test(u));
          if (!fam || !url) continue;
          const style = `${r.style.getPropertyValue("font-weight")} ${r.style.getPropertyValue("font-style")}`;
          const abs = new URL(url, sheet.href || location.href).href;
          out.push({ id: abs, family: fam, style, load: async () => (await fetch(abs)).arrayBuffer().then((b) => this.parse(b, 0)) });
        }
      }
    } catch {
      /* no stylesheets */
    }
    const q = (globalThis as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (this.opts.local && typeof q === "function" && !localRefused) {
      try {
        // the permission prompt may never be answered (or the browser may hold it): give up after a while
        const all = await Promise.race([q(), new Promise<LocalFontData[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), LOCAL_WAIT_MS))]);
        for (const fd of all) out.push({ id: `local:${fd.postscriptName}`, family: fd.family, style: fd.style, load: () => this.loadLocal(fd) });
      } catch {
        localRefused = true; // permission refused, unavailable or unanswered
      }
    }
    return out;
  }

  private async loadLocal(fd: LocalFontData): Promise<OtFont | null> {
    const blob = await fd.blob();
    // very large fonts (whole CJK collections) cost too much memory to parse in the page
    if (blob.size > MAX_FONT_BYTES) return null;
    const buf = await blob.arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint32(0) !== 0x74746366) return this.parse(buf, 0);
    // a collection: the font whose PostScript name matches
    for (let i = 0; i < v.getUint32(8); i++) {
      const f = await this.parse(buf, i);
      if (f && nameOf(f, "postScriptName") === fd.postscriptName) return f;
    }
    return this.parse(buf, 0);
  }

  private async parse(buf: ArrayBuffer, index: number): Promise<OtFont | null> {
    try {
      const one = fontFromCollection(buf, index);
      if (!one) return null;
      return (await opentype()).parse(one, { lowMemory: true });
    } catch {
      return null;
    }
  }

  private font(s: Source): Promise<OtFont | null> {
    let p = this.parsed.get(s.id);
    if (!p) {
      p = s.load().catch(() => null);
      this.parsed.set(s.id, p);
    }
    return p;
  }

  /**
   * The text as glyphs of an embedded font: the CSS font list first, then
   * common Unicode fonts; null when it must be drawn another way.
   */
  async encode(text: string, cssFamily: string, bold: boolean, italic: boolean): Promise<{ key: string; cids: number[]; width: number } | null> {
    if (!text || !plainScript(text)) return null;
    this.sources ??= this.listSources();
    const sources = await this.sources;
    if (!sources.length) return null;
    const want = [...cssFamily.split(",").map((f) => f.replace(/["']/g, "").trim().toLowerCase()).filter(Boolean), ...FALLBACKS.map((f) => f.toLowerCase())];
    const styleScore = (st: string) => {
      const b = /bold|black|heavy|semibold|[6-9]00/i.test(st), it = /italic|oblique/i.test(st);
      return (b === bold ? 0 : 2) + (it === italic ? 0 : 1);
    };
    const chars = [...text];
    let tries = 0;
    for (const fam of [...new Set(want)]) {
      const cands = sources.filter((s) => s.family.toLowerCase() === fam).sort((a, b) => styleScore(a.style) - styleScore(b.style));
      for (const s of cands) {
        if (!this.parsed.has(s.id) && ++tries > MAX_TRIES) return null;
        const f = await this.font(s);
        if (!f) continue;
        const gids = chars.map((ch) => (ch === " " || ch === " " ? f.charToGlyphIndex(" ") : f.charToGlyphIndex(ch)));
        if (gids.some((g) => !g)) continue;
        let cf = this.cid.get(s.id);
        if (!cf) {
          const it = /italic|oblique/i.test(s.style);
          cf = this.pdf.cidFont(s.id, nameOf(f, "postScriptName") || s.family, (glyphs) => buildSubset(f, glyphs, it));
          this.cid.set(s.id, cf);
        }
        const cids = gids.map((g, i) => cf!.cid(g, chars[i]));
        const width = gids.reduce((a, g) => a + (f.glyphs.get(g).advanceWidth ?? f.unitsPerEm), 0) / f.unitsPerEm;
        return { key: cf.key, cids, width };
      }
    }
    return null;
  }
}
