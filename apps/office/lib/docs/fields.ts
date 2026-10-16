// Captions, bookmarks and cross-references. Captions number themselves with
// SEQ fields (Figure 1, Figure 2…, counted per label in document order);
// a bookmark marks a place a cross-reference can point at; a cross-reference
// shows the bookmarked text, its number, its page, or "above"/"below".
//
// The same index is built from the editor's document (with positions) and
// from its JSON (for the .docx writer), so both show the same text.
import type { PMNode } from "./model";
import { textSwitch, formatNumber } from "./doc-fields";

export const CAPTION_LABELS = ["Figure", "Table", "Equation"] as const;

/** What a bookmark covers: "label" ends after the caption number ("Figure 1"); "para" runs to the end of the paragraph. */
export type BookmarkSpan = "label" | "para";
/** What a cross-reference shows. */
export type RefShow = "text" | "number" | "page" | "above";

export type BookmarkInfo = {
  name: string;
  span: BookmarkSpan;
  /** document position of the bookmark (editor documents only) */
  pos: number;
  /** order among bookmarks in the document */
  order: number;
  /** the bookmarked text, with caption numbers filled in */
  text: string;
  /** the caption number in the bookmarked text, if any */
  number: string;
  /** "Figure", "Table"… when the bookmark is a caption's */
  label: string;
  /** the heading or caption paragraph's whole text (for the cross-reference dialog) */
  para: string;
  /** heading level when the bookmark sits in a heading */
  heading: number;
};

export type FieldIndex = {
  bookmarks: Map<string, BookmarkInfo>;
  /** SEQ field position -> its number */
  seq: Map<number, number>;
  /** in order: every SEQ field's label and number with its paragraph text (captions list) */
  captions: { label: string; number: number; pos: number; text: string; bookmark: string | null }[];
};

/** Format a SEQ number: arabic by default; ROMAN, roman, ALPHABETIC, alphabetic like Word's \* switches. */
export function seqText(n: number, format?: string): string {
  switch (format) {
    case "ROMAN":
    case "roman": {
      const r = toRoman(n);
      return format === "ROMAN" ? r : r.toLowerCase();
    }
    case "ALPHABETIC":
    case "alphabetic": {
      let s = "";
      let v = n;
      while (v > 0) {
        v--;
        s = String.fromCharCode(65 + (v % 26)) + s;
        v = Math.floor(v / 26);
      }
      return format === "ALPHABETIC" ? s : s.toLowerCase();
    }
    default:
      return String(n);
  }
}

function toRoman(n: number): string {
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) (s += r), (n -= v);
  return s || "0";
}

type Inline = { type: string; text?: string; attrs?: Record<string, unknown>; pos: number };
type Block = { type: string; attrs: Record<string, unknown>; inlines: Inline[]; pos: number };

/** A ProseMirror node or its JSON: just what the index needs. */
type AnyNode = {
  type: string | { name: string };
  text?: string | null;
  attrs?: Record<string, unknown>;
  content?: PMNode[] | { forEach: (f: (n: AnyNode, off: number) => void) => void };
  isTextblock?: boolean;
};

const typeName = (n: AnyNode) => (typeof n.type === "string" ? n.type : n.type.name);
const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/** Every textblock in order with its inline content. Positions are exact for editor nodes. */
function blocksOf(doc: AnyNode): Block[] {
  const out: Block[] = [];
  const children = (n: AnyNode, f: (c: AnyNode, off: number) => void) => {
    const c = n.content;
    if (!c) return;
    if (Array.isArray(c)) {
      let off = 0;
      for (const k of c) {
        f(k as AnyNode, off);
        off += sizeOf(k as AnyNode);
      }
    } else c.forEach(f);
  };
  const walk = (n: AnyNode, pos: number) => {
    const t = typeName(n);
    if (TEXTBLOCKS.has(t)) {
      const inl: Inline[] = [];
      children(n, (c, off) => inl.push({ type: typeName(c), text: c.text ?? undefined, attrs: c.attrs, pos: pos + 1 + off }));
      out.push({ type: t, attrs: n.attrs || {}, inlines: inl, pos });
      return;
    }
    children(n, (c, off) => walk(c, pos + 1 + off));
  };
  // the doc node itself has no opening token
  children(doc, (c, off) => walk(c, off));
  return out;
}

/** Node size for JSON nodes (editor nodes bring their own positions through forEach). */
function sizeOf(n: AnyNode): number {
  if (typeName(n) === "text") return (n.text || "").length;
  const c = n.content;
  if (Array.isArray(c) && c.length) return 2 + c.reduce((s, k) => s + sizeOf(k as AnyNode), 0);
  return LEAVES.has(typeName(n)) ? 1 : 2;
}
const LEAVES = new Set(["hardBreak", "image", "pageBreak", "sectionBreak", "pageField", "tableOfContents", "horizontalRule", "noteRef", "bookmark", "seqField", "crossRef", "citation", "bibliography", "equation", "shape"]);

/** Build the caption, bookmark and SEQ index of a document. */
export function fieldIndex(doc: AnyNode): FieldIndex {
  const blocks = blocksOf(doc);
  const counts = new Map<string, number>();
  const seq = new Map<number, number>();
  const captions: FieldIndex["captions"] = [];
  // number SEQ fields first (a reference can point forward)
  for (const b of blocks) {
    for (const i of b.inlines) {
      if (i.type !== "seqField") continue;
      const name = String(i.attrs?.name || "Figure");
      const n = (counts.get(name) || 0) + 1;
      counts.set(name, n);
      seq.set(i.pos, n);
    }
  }
  const inlineText = (inls: Inline[]) =>
    inls
      .map((i) => (i.type === "text" ? i.text || "" : i.type === "seqField" ? seqText(seq.get(i.pos) || 0, i.attrs?.format as string) : i.type === "hardBreak" ? " " : ""))
      .join("");
  const bookmarks = new Map<string, BookmarkInfo>();
  let order = 0;
  for (const b of blocks) {
    const para = inlineText(b.inlines).trim();
    let bm: string | null = null;
    b.inlines.forEach((i, k) => {
      if (i.type === "bookmark") {
        const name = String(i.attrs?.name || "");
        if (!name || bookmarks.has(name)) return;
        const span: BookmarkSpan = i.attrs?.span === "label" ? "label" : "para";
        const rest = b.inlines.slice(k + 1);
        let covered = rest;
        if (span === "label") {
          const s = rest.findIndex((r) => r.type === "seqField");
          covered = s >= 0 ? rest.slice(0, s + 1) : rest;
        }
        const sq = covered.find((r) => r.type === "seqField");
        bookmarks.set(name, {
          name,
          span,
          pos: i.pos,
          order: order++,
          text: inlineText(covered).trim(),
          number: sq ? seqText(seq.get(sq.pos) || 0, sq.attrs?.format as string) : "",
          label: sq ? String(sq.attrs?.name || "") : "",
          para,
          heading: b.type === "heading" ? Number(b.attrs.level) || 1 : 0,
        });
        if (!bm) bm = name;
      }
    });
    for (const i of b.inlines)
      if (i.type === "seqField") captions.push({ label: String(i.attrs?.name || "Figure"), number: seq.get(i.pos) || 0, pos: b.pos, text: para, bookmark: bm });
  }
  return { bookmarks, seq, captions };
}

/** The text a cross-reference shows. `page` looks up a bookmark's page; `refOrder` places the reference among bookmarks for above/below. */
export function refText(
  ix: FieldIndex,
  target: string,
  show: RefShow,
  opts: { refPos?: number; page?: (b: BookmarkInfo) => string | null; below?: boolean; switches?: string | null; refPage?: string | null } = {},
): string {
  const b = ix.bookmarks.get(target);
  if (!b) return "Error! Reference source not found.";
  const sw = opts.switches;
  if (sw) return refVariant(b, show, sw, opts);
  return refBase(b, show, opts);
}

const relative = (b: BookmarkInfo, opts: { refPos?: number; below?: boolean }) => (opts.below !== undefined ? (opts.below ? "below" : "above") : opts.refPos !== undefined && opts.refPos < b.pos ? "below" : "above");

/**
 * REF and PAGEREF with switches Word combines: \p after a number or text
 * ("Figure 2 above"), PAGEREF \p ("on page 4", or above/below on the same page),
 * \* text formats and \# number pictures.
 */
function refVariant(b: BookmarkInfo, show: RefShow, sw: string, opts: { refPos?: number; page?: (b: BookmarkInfo) => string | null; below?: boolean; refPage?: string | null }): string {
  const position = /\\p\b/.test(sw);
  const numberish = /\\[nrw]\b/.test(sw);
  let v: string;
  if (show === "page") {
    const pg = opts.page?.(b) ?? "1";
    const pic = /\\#\s+(?:"([^"]*)"|(\S+))/.exec(sw);
    const shown = pic && /^\d+$/.test(pg) ? formatNumber(Number(pg), pic[1] ?? pic[2]) : pg;
    v = position ? (opts.refPage != null && opts.refPage === pg ? relative(b, opts) : `on page ${shown}`) : shown;
  } else {
    const base = numberish ? b.number || b.text : b.text;
    v = position ? (numberish || show === "number" ? `${base} ${relative(b, opts)}` : show === "above" ? relative(b, opts) : `${base} ${relative(b, opts)}`) : show === "above" ? relative(b, opts) : show === "number" ? b.number || b.text : base;
  }
  return textSwitch(v, sw);
}

function refBase(b: BookmarkInfo, show: RefShow, opts: { refPos?: number; page?: (b: BookmarkInfo) => string | null; below?: boolean }): string {
  switch (show) {
    case "number":
      return b.number || b.text;
    case "page":
      return opts.page?.(b) ?? "1";
    case "above":
      return relative(b, opts);
    default:
      return b.text;
  }
}

/** A new hidden bookmark name like Word's _Ref123456789. */
export const refName = () => `_Ref${String(Math.floor(100000000 + Math.random() * 899999999))}`;

/** Bookmarks people name themselves; Word's own hidden ones start with an underscore. */
export const isHiddenBookmark = (name: string) => name.startsWith("_");

/** Parse a REF/PAGEREF/SEQ field instruction. */
export function parseFieldInstr(instr: string): { kind: "REF" | "PAGEREF" | "SEQ" | "NOTEREF"; name: string; show: RefShow; format?: string; link: boolean; switches?: string } | null {
  const m = /^\s*(REF|PAGEREF|SEQ|NOTEREF)\s+("?)([^\s"\\]+)\2(.*)$/i.exec(instr);
  if (!m) {
    // a bare bookmark name is a REF too: { _Ref123 \h }
    const b = /^\s*(_Ref\d+)(?:\s|$)/.exec(instr);
    return b ? { kind: "REF", name: b[1], show: "text", link: true } : null;
  }
  const kind = m[1].toUpperCase() as "REF" | "PAGEREF" | "SEQ" | "NOTEREF";
  const sw = m[4] || "";
  const fmt = /\\\*\s*(ARABIC|ROMAN|roman|ALPHABETIC|alphabetic)/.exec(sw)?.[1];
  const show: RefShow = kind === "PAGEREF" ? (/\\p/.test(sw) ? "above" : "page") : /\\p/.test(sw) ? "above" : /\\[nrw]\b/.test(sw) ? "number" : "text";
  // switches beyond the plain forms we write ourselves (\\p after a number, \\n, \\w, \\* Upper, \\# pictures…) are kept
  const rest = sw.replace(/\\h\b/g, "").replace(/\s+/g, " ").trim();
  const plain = kind === "PAGEREF" ? rest === "" : rest === "" || rest === "\\p" || rest === "\\r";
  return { kind, name: m[3], show, format: fmt, link: /\\h/.test(sw), ...(plain || kind === "SEQ" ? {} : { switches: rest }), ...(kind === "PAGEREF" && !plain ? { show: "page" as RefShow } : {}) };
}
