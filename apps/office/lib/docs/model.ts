// The Word-shaped parts of a document that live beside the Tiptap content:
// paragraph and character styles, sections (page size, margins, columns,
// headers and footers) and document settings. Plain data, shared by the
// editor, the .docx reader/writer and the tests. Lengths are in points.

import type { Source, CitationStyle } from "./citations";
import type { MergeSource } from "./mail-merge";
import type { Watermark, PageBorders, LineNumbers } from "./page-design";
import type { Protection } from "./protection";
import { bordersCss, type ParaBorders, type TabStop } from "./para-format";

/** A ProseMirror/Tiptap JSON node. */
export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export type RunProps = {
  font?: string; // family name, e.g. "Calibri"
  size?: number; // pt
  color?: string; // #rrggbb
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: string; // #rrggbb
  caps?: boolean;
  smallCaps?: boolean;
  /** character spacing (expanded/condensed), pt */
  charSpacing?: number;
  vertAlign?: "superscript" | "subscript";
};

export type ParaProps = {
  align?: "left" | "center" | "right" | "justify";
  spaceBefore?: number;
  spaceAfter?: number;
  /** Word line spacing: a multiple ("1.15"), exact ("14pt") or at least ("min14pt"). */
  lineHeight?: string;
  indentLeft?: number;
  indentRight?: number;
  /** first-line indent; negative for a hanging indent */
  indentFirst?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  /** false turns Word's widow/orphan control off */
  widowControl?: boolean;
  borders?: ParaBorders;
  shading?: string;
  tabs?: TabStop[];
};

export type DocStyle = {
  id: string; // [A-Za-z0-9_-]
  name: string;
  type: "paragraph" | "character";
  basedOn?: string;
  next?: string;
  /** shown in the style gallery (Word's quick styles) */
  gallery?: boolean;
  /** Word's semiHidden styles: kept for the round trip, not listed */
  hidden?: boolean;
  builtin?: boolean;
  run: RunProps;
  para?: ParaProps;
};

export type HeaderFooterSet = { default?: PMNode; first?: PMNode; even?: PMNode };

export type Section = {
  /** how this section starts */
  type?: "nextPage" | "continuous" | "evenPage" | "oddPage";
  pageWidth: number;
  pageHeight: number;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number; header: number; footer: number; gutter?: number };
  columns?: { count: number; space: number; separator?: boolean };
  /** different first page */
  titlePage?: boolean;
  /** absent means "same as previous" (Word's link to previous) */
  headers?: HeaderFooterSet;
  footers?: HeaderFooterSet;
  pageNumberStart?: number;
  pageNumberFormat?: "decimal" | "lowerRoman" | "upperRoman" | "lowerLetter" | "upperLetter";
  pageBorders?: PageBorders;
  lineNumbers?: LineNumbers;
  /** vertical alignment of the text on the page */
  vAlign?: "top" | "center" | "bottom" | "both";
};

export type DocSettings = {
  evenAndOddHeaders?: boolean;
  /** Word's Track Changes switch: everyone's edits become tracked changes */
  trackRevisions?: boolean;
  /** the document's bibliography sources and the citation style */
  sources?: Source[];
  citationStyle?: CitationStyle;
  /** the document theme (lib/docs/design.ts THEMES id) */
  theme?: string;
  /** mail merge: the Sheet that holds the recipients */
  mergeSource?: MergeSource;
  watermark?: Watermark;
  /** page background colour (#rrggbb) */
  pageColor?: string;
  autoHyphenation?: boolean;
  /** inside/outside margins: even pages swap left and right */
  mirrorMargins?: boolean;
  /** restrict editing */
  protection?: Protection;
  /** File › Properties: Word's built-in properties beyond title and author (Subject, Keywords, Comments, Category, Company, Manager…), for DOCPROPERTY and INFO fields */
  properties?: Record<string, string>;
  /** custom document properties (docProps/custom.xml) */
  customProperties?: Record<string, string>;
};

/** Built-in properties, by Word's names, and where they live in a .docx. */
export const BUILTIN_PROPERTIES: { name: string; part: "core" | "app"; tag: string }[] = [
  { name: "Subject", part: "core", tag: "dc:subject" },
  { name: "Keywords", part: "core", tag: "cp:keywords" },
  { name: "Comments", part: "core", tag: "dc:description" },
  { name: "Category", part: "core", tag: "cp:category" },
  { name: "LastSavedBy", part: "core", tag: "cp:lastModifiedBy" },
  { name: "RevisionNumber", part: "core", tag: "cp:revision" },
  { name: "Company", part: "app", tag: "Company" },
  { name: "Manager", part: "app", tag: "Manager" },
  { name: "Template", part: "app", tag: "Template" },
];

export const PT_PX = 4 / 3;
export const ptToPx = (pt: number) => pt * PT_PX;
export const pxToPt = (px: number) => px / PT_PX;
export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const PAGE_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: "letter", label: "Letter (8.5 × 11 in)", w: 612, h: 792 },
  { id: "legal", label: "Legal (8.5 × 14 in)", w: 612, h: 1008 },
  { id: "a4", label: "A4 (21 × 29.7 cm)", w: 595.3, h: 841.9 },
  { id: "a5", label: "A5 (14.8 × 21 cm)", w: 419.55, h: 595.3 },
  { id: "a3", label: "A3 (29.7 × 42 cm)", w: 841.9, h: 1190.55 },
  { id: "executive", label: "Executive (7.25 × 10.5 in)", w: 522, h: 756 },
  { id: "tabloid", label: "Tabloid (11 × 17 in)", w: 792, h: 1224 },
];

export const MARGIN_PRESETS: { id: string; label: string; m: [number, number, number, number] }[] = [
  { id: "normal", label: "Normal (1 in)", m: [72, 72, 72, 72] },
  { id: "narrow", label: "Narrow (0.5 in)", m: [36, 36, 36, 36] },
  { id: "moderate", label: "Moderate (1 in, 0.75 in)", m: [72, 54, 72, 54] },
  { id: "wide", label: "Wide (1 in, 2 in)", m: [72, 144, 72, 144] },
];

export function defaultSection(): Section {
  return {
    type: "nextPage",
    pageWidth: 612,
    pageHeight: 792,
    orientation: "portrait",
    margins: { top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36 },
  };
}

/** Section props from a JSON string (node attribute / shared map), filling gaps. */
export function parseSection(json: unknown): Section {
  const d = defaultSection();
  let s: Partial<Section> = {};
  if (typeof json === "string" && json) {
    try {
      s = JSON.parse(json) as Partial<Section>;
    } catch {
      s = {};
    }
  } else if (json && typeof json === "object") s = json as Partial<Section>;
  const num = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : f);
  const m = (s.margins || {}) as Partial<Section["margins"]>;
  const out: Section = {
    ...s,
    type: s.type && ["nextPage", "continuous", "evenPage", "oddPage"].includes(s.type) ? s.type : "nextPage",
    pageWidth: Math.max(72, num(s.pageWidth, d.pageWidth)),
    pageHeight: Math.max(72, num(s.pageHeight, d.pageHeight)),
    orientation: s.orientation === "landscape" ? "landscape" : "portrait",
    margins: {
      top: num(m.top, 72),
      right: num(m.right, 72),
      bottom: num(m.bottom, 72),
      left: num(m.left, 72),
      header: num(m.header, 36),
      footer: num(m.footer, 36),
      ...(m.gutter ? { gutter: num(m.gutter, 0) } : {}),
    },
  };
  if (s.columns && s.columns.count > 1) out.columns = { count: Math.min(6, Math.max(1, Math.round(s.columns.count))), space: num(s.columns.space, 36), ...(s.columns.separator ? { separator: true } : {}) };
  else delete out.columns;
  return out;
}

export const sectionJson = (s: Section) => JSON.stringify(s);

/** Text width of a section's page (pt). */
export const contentWidth = (s: Section) => Math.max(36, s.pageWidth - s.margins.left - s.margins.right - (s.margins.gutter || 0));
export const contentHeight = (s: Section) => Math.max(36, s.pageHeight - s.margins.top - s.margins.bottom);

// ---- Styles ----

export const HEADING_COLOR = "#2f5496";
export const BUILTIN_STYLES: DocStyle[] = [
  { id: "Normal", name: "Normal", type: "paragraph", builtin: true, gallery: true, run: { font: "Calibri", size: 11 }, para: { spaceAfter: 8, lineHeight: "1.08" } },
  { id: "NoSpacing", name: "No Spacing", type: "paragraph", builtin: true, gallery: true, basedOn: "Normal", run: {}, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "Title", name: "Title", type: "paragraph", builtin: true, gallery: true, basedOn: "Normal", next: "Normal", run: { font: "Calibri Light", size: 28 }, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "Subtitle", name: "Subtitle", type: "paragraph", builtin: true, gallery: true, basedOn: "Normal", next: "Normal", run: { color: "#5a5a5a", size: 11 }, para: { spaceAfter: 8 } },
  ...[1, 2, 3, 4, 5, 6].map(
    (n): DocStyle => ({
      id: `Heading${n}`,
      name: `Heading ${n}`,
      type: "paragraph",
      builtin: true,
      gallery: n <= 3,
      basedOn: "Normal",
      next: "Normal",
      run: { font: "Calibri Light", size: [16, 13, 12, 11, 11, 11][n - 1], color: n === 3 || n === 6 ? "#1f3763" : HEADING_COLOR, ...(n === 4 ? { italic: true } : {}) },
      para: { spaceBefore: n === 1 ? 12 : 2, spaceAfter: 0, keepNext: true },
    }),
  ),
  { id: "Quote", name: "Quote", type: "paragraph", builtin: true, gallery: true, basedOn: "Normal", next: "Normal", run: { italic: true, color: "#404040" }, para: { align: "center", spaceBefore: 10, indentLeft: 43.2, indentRight: 43.2 } },
  { id: "ListParagraph", name: "List Paragraph", type: "paragraph", builtin: true, basedOn: "Normal", run: {}, para: { indentLeft: 36 } },
  { id: "Code", name: "Code", type: "paragraph", builtin: true, basedOn: "Normal", run: { font: "Consolas", size: 10 }, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "Caption", name: "Caption", type: "paragraph", builtin: true, basedOn: "Normal", next: "Normal", run: { italic: true, size: 9, color: "#44546a" }, para: { spaceAfter: 10, lineHeight: "1" } },
  { id: "Bibliography", name: "Bibliography", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { indentLeft: 36, indentFirst: -36 } },
  { id: "TableofFigures", name: "Table of Figures", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 0 } },
  { id: "TOCHeading", name: "TOC Heading", type: "paragraph", builtin: true, basedOn: "Heading1", next: "Normal", run: {}, para: {} },
  { id: "TOC1", name: "toc 1", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 5 } },
  { id: "TOC2", name: "toc 2", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 5, indentLeft: 11 } },
  { id: "TOC3", name: "toc 3", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 5, indentLeft: 22 } },
  { id: "Index1", name: "index 1", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 0, indentLeft: 11, indentFirst: -11 } },
  { id: "Index2", name: "index 2", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 0, indentLeft: 22, indentFirst: -11 } },
  { id: "Index3", name: "index 3", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Normal", run: {}, para: { spaceAfter: 0, indentLeft: 33, indentFirst: -11 } },
  { id: "IndexHeading", name: "index heading", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", next: "Index1", run: { bold: true }, para: { spaceBefore: 6, spaceAfter: 2 } },
  { id: "Header", name: "header", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", run: {}, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "Footer", name: "footer", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", run: {}, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "Strong", name: "Strong", type: "character", builtin: true, gallery: true, run: { bold: true } },
  { id: "Emphasis", name: "Emphasis", type: "character", builtin: true, gallery: true, run: { italic: true } },
  { id: "SubtleEmphasis", name: "Subtle Emphasis", type: "character", builtin: true, gallery: true, run: { italic: true, color: "#404040" } },
  { id: "IntenseEmphasis", name: "Intense Emphasis", type: "character", builtin: true, gallery: true, run: { italic: true, color: "#4472c4" } },
  { id: "Hyperlink", name: "Hyperlink", type: "character", builtin: true, hidden: true, run: { color: "#0563c1", underline: true } },
  { id: "FootnoteText", name: "Footnote Text", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", run: { size: 10 }, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "FootnoteReference", name: "Footnote Reference", type: "character", builtin: true, hidden: true, run: { vertAlign: "superscript" } },
  { id: "EndnoteText", name: "Endnote Text", type: "paragraph", builtin: true, hidden: true, basedOn: "Normal", run: { size: 10 }, para: { spaceAfter: 0, lineHeight: "1" } },
  { id: "EndnoteReference", name: "Endnote Reference", type: "character", builtin: true, hidden: true, run: { vertAlign: "superscript" } },
];

/** Word's display names for built-in styles where they differ (lower case in styles.xml). */
export const WORD_NAMES: Record<string, string> = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Heading${n}`, `heading ${n}`])),
  Caption: "caption",
  TableofFigures: "table of figures",
  FootnoteText: "footnote text",
  FootnoteReference: "footnote reference",
  EndnoteText: "endnote text",
  EndnoteReference: "endnote reference",
};

export const cleanStyleId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "Style";

/** Built-ins merged with the document's own (stored or imported) styles. */
export function mergeStyles(own: DocStyle[] | undefined): DocStyle[] {
  const map = new Map<string, DocStyle>();
  for (const s of BUILTIN_STYLES) map.set(s.id, s);
  for (const s of own || []) if (s && s.id) map.set(s.id, { ...map.get(s.id), ...s, builtin: map.get(s.id)?.builtin || s.builtin });
  return [...map.values()];
}

/** A style's effective run and paragraph props (basedOn chain resolved). */
export function resolveStyle(styles: DocStyle[], id: string | undefined, seen = new Set<string>()): { run: RunProps; para: ParaProps } {
  const s = styles.find((x) => x.id === id);
  if (!s || seen.has(s.id)) return { run: {}, para: {} };
  seen.add(s.id);
  const base = s.basedOn ? resolveStyle(styles, s.basedOn, seen) : { run: {}, para: {} };
  return { run: { ...base.run, ...stripUndef(s.run) }, para: { ...base.para, ...stripUndef(s.para || {}) } };
}

function stripUndef<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Style id of a paragraph or heading node. */
export function paraStyleOf(node: PMNode): string {
  if (node.type === "heading") return `Heading${Number(node.attrs?.level) || 1}`;
  return (node.attrs?.styleId as string) || "Normal";
}

// ---- CSS ----

const FALLBACK: Record<string, string> = {
  calibri: '"Calibri", "Carlito", sans-serif',
  "calibri light": '"Calibri Light", "Carlito", sans-serif',
  cambria: '"Cambria", "Caladea", serif',
  arial: '"Arial", "Liberation Sans", sans-serif',
  "times new roman": '"Times New Roman", "Liberation Serif", serif',
  "courier new": '"Courier New", "Liberation Mono", monospace',
  consolas: '"Consolas", "Liberation Mono", monospace',
};
/** A CSS font-family list for a Word font name. */
export function cssFont(name: string): string {
  const n = name.trim();
  const f = FALLBACK[n.toLowerCase()];
  if (f) return f;
  const generic = /mono|courier|consol|code/i.test(n) ? "monospace" : /serif|roman|georgia|garamond|cambria|book|times/i.test(n) && !/sans/i.test(n) ? "serif" : "sans-serif";
  return `"${n.replace(/"/g, "")}", ${generic}`;
}
/** The Word font name from a CSS font-family list. */
export function fontName(css: string): string {
  const first = css.split(",")[0] || "";
  return first.trim().replace(/^["']|["']$/g, "");
}

/** CSS line-height for a Word line spacing value. Word's single line is about 1.2 font heights. */
export function cssLineHeight(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (v.endsWith("pt")) return v.startsWith("min") ? v.slice(3) : v;
  const m = Number(v);
  return Number.isFinite(m) && m > 0 ? String(round(m * 1.2, 3)) : undefined;
}

export function runCss(r: RunProps): string {
  const out: string[] = [];
  if (r.font) out.push(`font-family: ${cssFont(r.font)}`);
  if (r.size) out.push(`font-size: ${r.size}pt`);
  if (r.color) out.push(`color: ${r.color}`);
  if (r.bold !== undefined) out.push(`font-weight: ${r.bold ? 700 : 400}`);
  if (r.italic !== undefined) out.push(`font-style: ${r.italic ? "italic" : "normal"}`);
  const deco = [r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (r.underline !== undefined || r.strike !== undefined) out.push(`text-decoration: ${deco || "none"}`);
  if (r.highlight) out.push(`background-color: ${r.highlight}`);
  if (r.caps) out.push("text-transform: uppercase");
  if (r.smallCaps) out.push("font-variant: small-caps");
  if (r.charSpacing) out.push(`letter-spacing: ${r.charSpacing}pt`);
  if (r.vertAlign) out.push(`vertical-align: ${r.vertAlign === "superscript" ? "super" : "sub"}; font-size: smaller`);
  return out.join("; ");
}

export function paraCss(p: ParaProps): string {
  const out: string[] = [];
  if (p.align) out.push(`text-align: ${p.align}`);
  if (p.spaceBefore !== undefined) out.push(`padding-top: ${p.spaceBefore}pt`);
  if (p.spaceAfter !== undefined) out.push(`padding-bottom: ${p.spaceAfter}pt`);
  const lh = cssLineHeight(p.lineHeight);
  if (lh) out.push(`line-height: ${lh}`);
  if (p.indentLeft !== undefined) out.push(`padding-left: ${p.indentLeft}pt`);
  if (p.indentRight !== undefined) out.push(`padding-right: ${p.indentRight}pt`);
  if (p.indentFirst !== undefined) out.push(`text-indent: ${p.indentFirst}pt`);
  if (p.borders || p.shading) out.push(bordersCss(p.borders || null, p.shading));
  return out.join("; ");
}

/** Stylesheet for the document's styles, scoped under `scope` (e.g. ".word-doc"). */
export function stylesCss(styles: DocStyle[], scope: string): string {
  const rules: string[] = [];
  const sel = (s: string) => `${scope} .ProseMirror ${s}, ${scope} .hf-content ${s}`;
  const normal = resolveStyle(styles, "Normal");
  rules.push(`${scope} .ProseMirror, ${scope} .hf-content { ${runCss({ ...normal.run, bold: undefined, italic: undefined, underline: undefined, strike: undefined })}; line-height: ${cssLineHeight(normal.para.lineHeight) || "1.3"} }`);
  for (const s of styles) {
    const r = resolveStyle(styles, s.id);
    if (s.type === "character") {
      rules.push(`${sel(`span[data-cstyle="${s.id}"]`)} { ${runCss(r.run)} }`);
      continue;
    }
    const base = "margin: 0; letter-spacing: normal; font-weight: 400; font-style: normal";
    const css = [base, runCss(r.run), paraCss(r.para)].filter(Boolean).join("; ");
    const h = /^Heading([1-6])$/.exec(s.id);
    if (s.id === "Normal") rules.push(`${sel("p")} { ${css} }`);
    else if (h) rules.push(`${sel(`h${h[1]}`)} { ${css} }`);
    else rules.push(`${sel(`p[data-style="${s.id}"]`)} { ${css} }`);
  }
  return rules.join("\n");
}

// ---- Colours ----

export const HIGHLIGHTS: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};

/** #rrggbb from a CSS colour (hex, rgb()), or undefined. */
export function hexColor(c: unknown): string | undefined {
  if (typeof c !== "string") return undefined;
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("");
  const named: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000", yellow: "#ffff00", gray: "#808080", grey: "#808080" };
  return named[s];
}

/** A CSS length (px, pt, em of 11pt, in, cm) in points. */
export function cssLengthPt(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const m = /^(-?[\d.]+)\s*(px|pt|em|rem|in|cm|mm)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch (m[2]) {
    case "pt":
      return n;
    case "em":
    case "rem":
      return n * 12;
    case "in":
      return n * 72;
    case "cm":
      return (n * 72) / 2.54;
    case "mm":
      return (n * 72) / 25.4;
    default:
      return n * 0.75;
  }
}

export const LIST_FORMATS = ["decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"] as const;
export type ListFormat = (typeof LIST_FORMATS)[number];
export const CSS_LIST: Record<string, string> = { decimal: "decimal", lowerLetter: "lower-alpha", upperLetter: "upper-alpha", lowerRoman: "lower-roman", upperRoman: "upper-roman" };

/** Format a page number like Word's PAGE field. */
export function formatPageNumber(n: number, fmt: Section["pageNumberFormat"]): string {
  if (fmt === "lowerRoman" || fmt === "upperRoman") {
    const r = roman(n);
    return fmt === "lowerRoman" ? r.toLowerCase() : r;
  }
  if (fmt === "lowerLetter" || fmt === "upperLetter") {
    const l = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
    return fmt === "upperLetter" ? l.toUpperCase() : l;
  }
  return String(n);
}
function roman(n: number): string {
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of t) while (n >= v) (out += s), (n -= v);
  return out || "0";
}
