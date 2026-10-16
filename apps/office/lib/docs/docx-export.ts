// Our own .docx writer (WordprocessingML through JSZip), built straight from
// the editor's JSON, the document's styles and its sections. It keeps what
// html-to-docx lost: styles, fonts, sizes, colours and highlight, spacing and
// indents, multilevel numbering, tables with merges, borders and shading,
// sized images, links, page and section breaks, page setup, columns, headers
// and footers with page numbers, comments with replies, and a table of
// contents as a real TOC field. Runs in the browser and in Node (tests).
import JSZip from "jszip";
import { themeXml, themeOf } from "./design";
import { pBdrXml, shdXml, tabsXml, parseJson, dropCapFrameXml, type ParaBorders, type TabStop } from "./para-format";
import { mergeInstr } from "./mail-merge";
import { pgBordersXml, lnNumXml, watermarkVml } from "./page-design";
import { sdtPrXml, protectionXml, blockSdtPrXml, type ControlAttrs, type BlockControlAttrs } from "./protection";
import { tableStyle, tableStyleXml, tblLookXml, lookOf, TABLE_NORMAL_XML } from "./tables";
import {
  type DocSettings,
  type DocStyle,
  type PMNode,
  type RunProps,
  type ParaProps,
  type Section,
  BUILTIN_STYLES,
  BUILTIN_PROPERTIES,
  HIGHLIGHTS,
  WORD_NAMES,
  contentWidth,
  cssLengthPt,
  fontName,
  hexColor,
  mergeStyles,
  parseSection,
} from "./model";
import { fieldIndex, refText, seqText, type FieldIndex, type RefShow } from "./fields";
import { latexToOmml, latexToOmmlInline } from "../slides/math";
import { drawingXml } from "./drawing";
import { buildIndex, indexInstr, xeInstr, type IndexEntryAttrs, type IndexItem } from "./word-index";
import { chartSpaceXml, chartWorkbook, diagramParts, CHART_NS, DIAGRAM_NS, type ChartData, type DiagramData } from "./word-graphics";
import { bibliography, citationOrder, citationText, sourcesXml, CITATION_STYLES, type CitationStyle, type Source } from "./citations";

export type DocxComment = {
  id: string;
  resolved?: boolean;
  messages: { author: string; initials?: string; date?: number; body: string }[];
};

export type LoadedImage = { bytes: Uint8Array; mime: string; width?: number; height?: number; svg?: Uint8Array };

export type DocxInput = {
  doc: PMNode;
  styles?: DocStyle[];
  /** properties of the last section (the sections before it live on sectionBreak nodes) */
  body?: Section;
  settings?: DocSettings;
  comments?: DocxComment[];
  title?: string;
  author?: string;
  /** fetch an image that is not a data: URL */
  loadImage?: (src: string) => Promise<LoadedImage | null>;
  /** page number of each heading, in document order (for the TOC's cached page numbers) */
  headingPages?: (number | string)[];
  /** page label of each bookmark (for PAGEREF cross-references' cached results) */
  bookmarkPages?: Record<string, string>;
  /** the page of each index entry (XE), in document order */
  indexPages?: string[];
  /** draw an SVG picture as PNG (Word wants a raster picture beside the SVG); without it SVG pictures are left out */
  rasterize?: (svg: string, width: number, height: number) => Promise<Uint8Array | null>;
};

/** An SVG's size in px from its width/height or viewBox. */
export function svgSize(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] || "";
  const len = (k: string) => {
    const m = new RegExp(`\\s${k}="([\\d.]+)(px|pt|in|cm|mm)?"`).exec(root);
    if (!m) return 0;
    const v = Number(m[1]);
    return m[2] === "pt" ? (v * 4) / 3 : m[2] === "in" ? v * 96 : m[2] === "cm" ? (v * 96) / 2.54 : m[2] === "mm" ? (v * 96) / 25.4 : v;
  };
  const vb = /\sviewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(root);
  let width = len("width");
  let height = len("height");
  if (vb && !width && !height) {
    width = Number(vb[1]);
    height = Number(vb[2]);
  } else if (vb && width && !height) height = (width * Number(vb[2])) / Number(vb[1]);
  else if (vb && height && !width) width = (height * Number(vb[1])) / Number(vb[2]);
  return { width: Math.round(width) || 300, height: Math.round(height) || 150 };
}

const NS =
  'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w14 w15"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** The tag on the checkbox that starts a task-list item. */
export const TASK_TAG = "synergy:task";
const VML_NS = 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const esc = (s: string) => s.replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tw = (pt: number) => Math.round(pt * 20); // twips
const EMU_PX = 9525;
const hex6 = (c: string | undefined) => (c ? c.replace("#", "").toUpperCase() : undefined);

type Rel = { id: string; type: string; target: string; external?: boolean };
class Part {
  rels: Rel[] = [];
  constructor(public path: string) {}
  rel(type: string, target: string, external = false): string {
    const found = this.rels.find((r) => r.type === type && r.target === target && !!r.external === external);
    if (found) return found.id;
    const id = `rId${this.rels.length + 1}`;
    this.rels.push({ id, type: type.startsWith("http") ? type : `${REL}/${type}`, target, external });
    return id;
  }
  relsXml(): string {
    return (
      HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      this.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("") +
      `</Relationships>`
    );
  }
}

type ListLevel = { fmt: string; text: string; start: number };
type ImgData = { name: string; width: number; height: number; svgRid?: string };

const EXT: Record<string, string> = { "image/x-emf": "emf", "image/x-wmf": "wmf", "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "png" };

function dataUrl(src: string): LoadedImage | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const raw = m[2] ? atobBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return { bytes: raw, mime: m[1].toLowerCase() };
}
function atobBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pixel size of a PNG/JPEG/GIF from its header, when the image itself does not say. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

const markOf = (n: PMNode, t: string) => n.marks?.find((m) => m.type === t);

/** Word underline/border styles for CSS border styles. */
const BORDER_W: Record<string, string> = { solid: "single", dashed: "dashed", dotted: "dotted", double: "double", none: "nil", hidden: "nil" };

export function parseBorders(v: unknown): Record<string, string> {
  if (typeof v !== "string" || !v) return {};
  try {
    const o = JSON.parse(v) as Record<string, string>;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function borderXml(side: string, css: string | undefined): string {
  if (!css) return "";
  const parts = css.trim().split(/\s+/);
  const style = parts.find((p) => p in BORDER_W) || "solid";
  if (style === "none" || style === "hidden" || /^0(px|pt)?$/.test(parts[0])) return `<w:${side} w:val="nil"/>`;
  const width = cssLengthPt(parts.find((p) => /^[\d.]+(px|pt)$/.test(p)) || "1px") ?? 0.75;
  const color = hex6(hexColor(parts.find((p) => p.startsWith("#") || p.startsWith("rgb")))) || "auto";
  return `<w:${side} w:val="${BORDER_W[style]}" w:sz="${Math.max(2, Math.min(96, Math.round(width * 8)))}" w:space="0" w:color="${color}"/>`;
}

export function rPrXml(r: RunProps & { rStyle?: string; vertAlign?: "superscript" | "subscript"; position?: number }): string {
  const x: string[] = [];
  if (r.rStyle) x.push(`<w:rStyle w:val="${esc(r.rStyle)}"/>`);
  if (r.font) {
    const f = esc(r.font);
    x.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`);
  }
  if (r.bold !== undefined) x.push(r.bold ? "<w:b/><w:bCs/>" : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (r.italic !== undefined) x.push(r.italic ? "<w:i/><w:iCs/>" : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  if (r.caps) x.push("<w:caps/>");
  if (r.smallCaps) x.push("<w:smallCaps/>");
  if (r.strike !== undefined) x.push(r.strike ? "<w:strike/>" : '<w:strike w:val="0"/>');
  if (r.color) x.push(`<w:color w:val="${hex6(r.color)}"/>`);
  if (r.charSpacing) x.push(`<w:spacing w:val="${tw(r.charSpacing)}"/>`);
  if (r.position) x.push(`<w:position w:val="${Math.round(r.position)}"/>`);
  if (r.size) x.push(`<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`);
  if (r.highlight) {
    const name = Object.entries(HIGHLIGHTS).find(([, v]) => v === r.highlight)?.[0];
    if (name) x.push(`<w:highlight w:val="${name}"/>`);
  }
  if (r.underline !== undefined) x.push(`<w:u w:val="${r.underline ? "single" : "none"}"/>`);
  if (r.highlight && !Object.values(HIGHLIGHTS).includes(r.highlight)) x.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(r.highlight)}"/>`);
  if (r.vertAlign) x.push(`<w:vertAlign w:val="${r.vertAlign}"/>`);
  return x.length ? `<w:rPr>${x.join("")}</w:rPr>` : "";
}

function spacingXml(p: ParaProps): string {
  const a: string[] = [];
  if (p.spaceBefore !== undefined) a.push(`w:before="${tw(p.spaceBefore)}"`);
  if (p.spaceAfter !== undefined) a.push(`w:after="${tw(p.spaceAfter)}"`);
  const lh = p.lineHeight;
  if (lh) {
    if (lh.endsWith("pt")) {
      const atLeast = lh.startsWith("min");
      a.push(`w:line="${tw(Number(lh.replace(/^min|pt$/g, "")) || 12)}" w:lineRule="${atLeast ? "atLeast" : "exact"}"`);
    } else if (Number(lh) > 0) a.push(`w:line="${Math.round(Number(lh) * 240)}" w:lineRule="auto"`);
  }
  return a.length ? `<w:spacing ${a.join(" ")}/>` : "";
}
function indXml(p: ParaProps): string {
  const a: string[] = [];
  if (p.indentLeft !== undefined) a.push(`w:left="${tw(p.indentLeft)}"`);
  if (p.indentRight !== undefined) a.push(`w:right="${tw(p.indentRight)}"`);
  if (p.indentFirst !== undefined) a.push(p.indentFirst < 0 ? `w:hanging="${tw(-p.indentFirst)}"` : `w:firstLine="${tw(p.indentFirst)}"`);
  return a.length ? `<w:ind ${a.join(" ")}/>` : "";
}
const JC: Record<string, string> = { left: "left", center: "center", right: "right", justify: "both" };

/** pPr children in schema order. */
function pPrXml(o: {
  style?: string;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  numId?: number;
  ilvl?: number;
  pBdrBottom?: boolean;
  tabs?: string;
  framePr?: string;
  para: ParaProps;
  contextual?: boolean;
  sectPr?: string;
}): string {
  const x: string[] = [];
  if (o.style && o.style !== "Normal") x.push(`<w:pStyle w:val="${esc(o.style)}"/>`);
  if (o.keepNext) x.push("<w:keepNext/>");
  if (o.keepLines) x.push("<w:keepLines/>");
  if (o.pageBreakBefore || o.para.pageBreakBefore) x.push("<w:pageBreakBefore/>");
  if (o.framePr) x.push(o.framePr);
  if (o.para.widowControl === false) x.push('<w:widowControl w:val="0"/>');
  if (o.numId !== undefined) x.push(`<w:numPr><w:ilvl w:val="${o.ilvl ?? 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`);
  if (o.pBdrBottom) x.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>');
  else if (o.para.borders) x.push(pBdrXml(o.para.borders));
  if (o.para.shading) x.push(shdXml(o.para.shading));
  if (o.tabs) x.push(o.tabs);
  else if (o.para.tabs) x.push(tabsXml(o.para.tabs));
  x.push(spacingXml(o.para));
  x.push(indXml(o.para));
  if (o.contextual) x.push("<w:contextualSpacing/>");
  if (o.para.align && JC[o.para.align]) x.push(`<w:jc w:val="${JC[o.para.align]}"/>`);
  if (o.sectPr) x.push(o.sectPr);
  const s = x.join("");
  return s ? `<w:pPr>${s}</w:pPr>` : "";
}

/** Direct paragraph formatting carried on a paragraph/heading node. */
export function nodeParaProps(n: PMNode): ParaProps {
  const a = n.attrs || {};
  const p: ParaProps = {};
  const align = a.textAlign as string | undefined;
  if (align && align !== "left" && JC[align]) p.align = align as ParaProps["align"];
  const numAttr = (k: string) => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
  if (numAttr("spaceBefore") !== undefined) p.spaceBefore = numAttr("spaceBefore");
  if (numAttr("spaceAfter") !== undefined) p.spaceAfter = numAttr("spaceAfter");
  if (typeof a.lineHeight === "string" && a.lineHeight) p.lineHeight = a.lineHeight;
  const legacy = Number(a.indent) || 0;
  const left = numAttr("indLeft") ?? (legacy ? legacy * 36 : undefined);
  if (left !== undefined) p.indentLeft = left;
  if (numAttr("indRight") !== undefined) p.indentRight = numAttr("indRight");
  if (numAttr("indFirst") !== undefined) p.indentFirst = numAttr("indFirst");
  if (a.widowControl === false) p.widowControl = false;
  if (a.pageBreakBefore) p.pageBreakBefore = true;
  const borders = parseJson<ParaBorders>(a.borders);
  if (borders) p.borders = borders;
  if (typeof a.shading === "string" && /^#[0-9a-f]{6}$/i.test(a.shading)) p.shading = a.shading;
  const tabs = parseJson<TabStop[]>(a.tabs);
  if (tabs?.length) p.tabs = tabs;
  return p;
}

/** Direct run formatting from a text node's marks. */
export function nodeRunProps(n: PMNode): RunProps & { rStyle?: string; vertAlign?: "superscript" | "subscript" } {
  const r: RunProps & { rStyle?: string; vertAlign?: "superscript" | "subscript" } = {};
  for (const m of n.marks || []) {
    const a = m.attrs || {};
    switch (m.type) {
      case "bold":
        r.bold = true;
        break;
      case "italic":
        r.italic = true;
        break;
      case "underline":
        r.underline = true;
        break;
      case "strike":
        r.strike = true;
        break;
      case "superscript":
        r.vertAlign = "superscript";
        break;
      case "subscript":
        r.vertAlign = "subscript";
        break;
      case "highlight":
        r.highlight = hexColor(a.color) || "#ffff00";
        break;
      case "code":
        r.font = "Consolas";
        break;
      case "textStyle": {
        if (typeof a.fontFamily === "string" && a.fontFamily) r.font = fontName(a.fontFamily);
        const size = cssLengthPt(a.fontSize);
        if (size) r.size = Math.round(size * 2) / 2;
        const c = hexColor(a.color);
        if (c) r.color = c;
        if (typeof a.charStyle === "string" && a.charStyle) r.rStyle = a.charStyle;
        if (a.caps) r.caps = true;
        if (a.smallCaps) r.smallCaps = true;
        if (typeof a.charSpacing === "number" && a.charSpacing) r.charSpacing = a.charSpacing;
        break;
      }
    }
  }
  return r;
}

function sectPrXml(s: Section, refs: string): string {
  const m = s.margins;
  const x = [refs];
  if (s.type && s.type !== "nextPage") x.push(`<w:type w:val="${s.type}"/>`);
  x.push(`<w:pgSz w:w="${tw(s.pageWidth)}" w:h="${tw(s.pageHeight)}"${s.orientation === "landscape" ? ' w:orient="landscape"' : ""}/>`);
  x.push(`<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(m.header)}" w:footer="${tw(m.footer)}" w:gutter="${tw(m.gutter || 0)}"/>`);
  x.push(pgBordersXml(s.pageBorders));
  x.push(lnNumXml(s.lineNumbers));
  if (s.pageNumberStart || (s.pageNumberFormat && s.pageNumberFormat !== "decimal"))
    x.push(`<w:pgNumType${s.pageNumberFormat && s.pageNumberFormat !== "decimal" ? ` w:fmt="${s.pageNumberFormat}"` : ""}${s.pageNumberStart ? ` w:start="${s.pageNumberStart}"` : ""}/>`);
  const c = s.columns;
  x.push(c && c.count > 1 ? `<w:cols w:num="${c.count}" w:space="${tw(c.space)}"${c.separator ? ' w:sep="1"' : ""}/>` : '<w:cols w:space="720"/>');
  if (s.vAlign && s.vAlign !== "top") x.push(`<w:vAlign w:val="${s.vAlign}"/>`);
  if (s.titlePage) x.push("<w:titlePg/>");
  x.push('<w:docGrid w:linePitch="360"/>');
  return `<w:sectPr>${x.join("")}</w:sectPr>`;
}

const BULLETS = ["•", "◦", "▪"];
const ORDERED = ["decimal", "lowerLetter", "lowerRoman"];

class Writer {
  zip = new JSZip();
  doc = new Part("word/document.xml");
  styles: DocStyle[];
  images = new Map<string, LoadedImage | null>();
  media: { path: string; bytes: Uint8Array }[] = [];
  imgByPart = new Map<string, Map<string, ImgData & { rid: string }>>();
  abstractNums: string[] = [];
  nums: string[] = [];
  drawingId = 1;
  headerParts: { path: string; xml: string; part: Part; kind: "header" | "footer" }[] = [];
  commentIndex = new Map<string, number>(); // threadId -> word id of the root
  commentRemaining = new Map<string, number>();
  commentStarted = new Set<string>();
  comments: DocxComment[];
  tocLevels = 0;
  tocBookmarks: { name: string; level: number; text: string }[] = [];
  headingCounter = 0;
  bookmarkId = 1;
  usedSections: Section[] = [];
  origOf = new Map<string, string>();

  constructor(public input: DocxInput) {
    this.styles = mergeStyles(input.styles);
    this.comments = input.comments || [];
  }

  // ---- images ----
  async prepareImages(nodes: PMNode[]) {
    const srcs = new Set<string>();
    const walk = (n: PMNode) => {
      if (n.type === "image" && typeof n.attrs?.src === "string") {
        srcs.add(n.attrs.src);
        // a metafile picture is saved as the original EMF or WMF
        if (typeof n.attrs.orig === "string" && /^data:image\/x-(emf|wmf);base64,/.test(n.attrs.orig)) this.origOf.set(n.attrs.src, n.attrs.orig);
      }
      n.content?.forEach(walk);
    };
    nodes.forEach(walk);
    await Promise.all(
      [...srcs].map(async (src) => {
        let img: LoadedImage | null = null;
        try {
          img = dataUrl(this.origOf.get(src) || src) || (this.input.loadImage ? await this.input.loadImage(src) : null);
        } catch {
          img = null;
        }
        if (img?.mime === "image/svg+xml") {
          // Word shows a PNG and, from 2016, the SVG beside it (asvg:svgBlip)
          const text = new TextDecoder().decode(img.bytes);
          const size = svgSize(text);
          const png = this.input.rasterize ? await this.input.rasterize(text, size.width, size.height).catch(() => null) : null;
          img = png ? { bytes: png, mime: "image/png", width: size.width, height: size.height, svg: img.bytes } : null;
        }
        if (img && !EXT[img.mime]) img = null; // formats Word can't show
        this.images.set(src, img);
      }),
    );
  }

  imageRun(n: PMNode, part: Part): string {
    const src = String(n.attrs?.src || "");
    const img = this.images.get(src);
    if (!img) return "";
    let byPart = this.imgByPart.get(part.path);
    if (!byPart) this.imgByPart.set(part.path, (byPart = new Map()));
    let entry = byPart.get(src);
    if (!entry) {
      let existing = this.media.find((m) => m.bytes === img.bytes);
      if (!existing) {
        existing = { path: `media/image${this.media.length + 1}.${EXT[img.mime]}`, bytes: img.bytes };
        this.media.push(existing);
      }
      const nat = img.svg && img.width && img.height ? { width: img.width, height: img.height } : imageSize(img.bytes) || { width: img.width || 300, height: img.height || 200 };
      let svgRid: string | undefined;
      if (img.svg) {
        let sv = this.media.find((m) => m.bytes === img.svg);
        if (!sv) this.media.push((sv = { path: `media/image${this.media.length + 1}.svg`, bytes: img.svg }));
        svgRid = part.rel("image", sv.path);
      }
      entry = { name: existing.path.split("/").pop()!, width: nat.width, height: nat.height, rid: part.rel("image", existing.path), svgRid };
      byPart.set(src, entry);
    }
    let w = Number(n.attrs?.width) || 0;
    let h = Number(n.attrs?.height) || 0;
    if (w && !h) h = (w * entry.height) / entry.width;
    else if (h && !w) w = (h * entry.width) / entry.height;
    else if (!w && !h) {
      w = entry.width;
      h = entry.height;
      const max = (contentWidth(this.input.body || parseSection(null)) * 4) / 3;
      if (w > max) {
        h = (h * max) / w;
        w = max;
      }
    }
    const cx = Math.round(w * EMU_PX);
    const cy = Math.round(h * EMU_PX);
    const id = this.drawingId++;
    const alt = esc(String(n.attrs?.alt || ""));
    const graphic =
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${esc(entry.name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${entry.rid}">${entry.svgRid ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${entry.svgRid}"/></a:ext></a:extLst>` : ""}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
    const a = n.attrs || {};
    return `<w:r><w:drawing>${drawingXml({ w, h, id, name: `Picture ${id}`, descr: alt, graphic, lockAspect: true, wrap: a.wrap as string, align: a.align as string, offsetX: a.offsetX as number, offsetY: a.offsetY as number, z: 251659264 + id })}</w:drawing></w:r>`;
  }

  /** charts and SmartArt waiting to be written as parts */
  charts: { n: number; data: ChartData }[] = [];
  diagrams: { n: number; parts: ReturnType<typeof diagramParts> }[] = [];
  graphicJson<T>(v: unknown): T | null {
    if (v && typeof v === "object") return v as T;
    try {
      return typeof v === "string" ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }
  /** An inline chart: a c:chart graphic pointing at word/charts/chartN.xml. */
  chartRun(n: PMNode, part: Part): string {
    const data = this.graphicJson<ChartData>(n.attrs?.chart);
    if (!data) return "";
    const k = this.charts.length + 1;
    this.charts.push({ n: k, data });
    const rid = part.rel("chart", `charts/chart${k}.xml`);
    const w = Number(n.attrs?.width) || 480;
    const h = Number(n.attrs?.height) || 288;
    const id = this.drawingId++;
    const graphic = `<a:graphic><a:graphicData uri="${CHART_NS}"><c:chart xmlns:c="${CHART_NS}" r:id="${rid}"/></a:graphicData></a:graphic>`;
    return `<w:r><w:drawing>${drawingXml({ w, h, id, name: `Chart ${id}`, descr: esc(String(n.attrs?.alt || data.title || "")), graphic })}</w:drawing></w:r>`;
  }
  /** An inline SmartArt graphic: dgm:relIds pointing at its data, layout, style and colour parts (and the drawing Word shows). */
  smartArtRun(n: PMNode, part: Part): string {
    const data = this.graphicJson<DiagramData>(n.attrs?.diagram);
    if (!data) return "";
    const k = this.diagrams.length + 1;
    const w = Number(n.attrs?.width) || 576;
    const h = Number(n.attrs?.height) || 320;
    const rel = (type: string, file: string) => part.rel(type, `diagrams/${file}${k}.xml`);
    const dm = rel("diagramData", "data");
    const lo = rel("diagramLayout", "layout");
    const qs = rel("diagramQuickStyle", "quickStyle");
    const cs = rel("diagramColors", "colors");
    const dr = rel("http://schemas.microsoft.com/office/2007/relationships/diagramDrawing", "drawing");
    this.diagrams.push({ n: k, parts: diagramParts(data, w, h, dr) });
    const id = this.drawingId++;
    const graphic = `<a:graphic><a:graphicData uri="${DIAGRAM_NS}"><dgm:relIds xmlns:dgm="${DIAGRAM_NS}" r:dm="${dm}" r:lo="${lo}" r:qs="${qs}" r:cs="${cs}"/></a:graphicData></a:graphic>`;
    return `<w:r><w:drawing>${drawingXml({ w, h, id, name: `Diagram ${id}`, descr: esc(String(n.attrs?.alt || "")), graphic })}</w:drawing></w:r>`;
  }
  async writeGraphics(zip: JSZip, overrides: string[]) {
    for (const c of this.charts) {
      zip.file(`word/charts/chart${c.n}.xml`, chartSpaceXml(c.data, { embedded: true }));
      zip.file(`word/embeddings/Microsoft_Excel_Worksheet${c.n}.xlsx`, await chartWorkbook(c.data));
      zip.file(`word/charts/_rels/chart${c.n}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/package" Target="../embeddings/Microsoft_Excel_Worksheet${c.n}.xlsx"/></Relationships>`);
      overrides.push(`<Override PartName="/word/charts/chart${c.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    }
    for (const d of this.diagrams) {
      const t = (file: string, type: string, xml: string) => {
        zip.file(`word/diagrams/${file}${d.n}.xml`, xml);
        overrides.push(`<Override PartName="/word/diagrams/${file}${d.n}.xml" ContentType="${type}"/>`);
      };
      t("data", "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml", d.parts.data);
      t("layout", "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml", d.parts.layout);
      t("quickStyle", "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml", d.parts.style);
      t("colors", "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml", d.parts.colors);
      t("drawing", "application/vnd.ms-office.drawingml.diagramDrawing+xml", d.parts.drawing);
    }
  }

  /** A shape or text box: a wps:wsp drawing (preset geometry, fill, outline, text) in its own paragraph. */
  runColor: string | null = null;
  /** floating objects waiting for the next paragraph */
  anchors: string[] = [];
  takeAnchors(): string {
    const a = this.anchors.join("");
    this.anchors = [];
    return a;
  }
  shapeRun(n: PMNode, part: Part): string {
    const a = n.attrs || {};
    const w = Number(a.width) || 192;
    const h = Number(a.height) || 0;
    const id = this.drawingId++;
    const hex = (c: string) => c.replace("#", "").toUpperCase().padStart(6, "0").slice(0, 6);
    const fill = String(a.fill || "none");
    const stroke = String(a.stroke || "none");
    const kind = String(a.kind || "rect");
    const spPr =
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(w * EMU_PX)}" cy="${Math.round(h * EMU_PX)}"/></a:xfrm><a:prstGeom prst="${esc(kind)}"><a:avLst/></a:prstGeom>` +
      (fill === "none" || kind === "line" ? "<a:noFill/>" : `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>`) +
      (stroke === "none" ? "<a:ln><a:noFill/></a:ln>" : `<a:ln w="${Math.round((Number(a.strokeWidth) || 0.75) * 12700)}"><a:solidFill><a:srgbClr val="${hex(stroke)}"/></a:solidFill></a:ln>`) +
      `</wps:spPr>`;
    let txbx = "";
    if (kind !== "line") {
      const saved = this.runColor;
      const savedAnchors = this.anchors;
      this.runColor = a.color ? String(a.color) : null;
      this.anchors = [];
      txbx = `<wps:txbx><w:txbxContent>${this.blocks(n.content || [{ type: "paragraph" }], part) || "<w:p/>"}${this.anchors.length ? `<w:p>${this.takeAnchors()}</w:p>` : ""}</w:txbxContent></wps:txbx>`;
      this.runColor = saved;
      this.anchors = savedAnchors;
    }
    const anchor = a.valign === "middle" ? "ctr" : a.valign === "bottom" ? "b" : "t";
    const graphic = `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr${a.textBox ? ' txBox="1"' : ""}/>${spPr}${txbx}<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
    const name = a.textBox ? `Text Box ${id}` : `Shape ${id}`;
    return `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${drawingXml({ w, h, id, name, graphic, wrap: a.wrap as string, align: a.align as string, offsetX: a.offsetX as number, offsetY: a.offsetY as number, z: 251659264 + id })}</w:drawing></mc:Choice></mc:AlternateContent></w:r>`;
  }

  // ---- numbering ----
  listLevels(list: PMNode): ListLevel[] {
    const levels: ListLevel[] = [];
    const walk = (l: PMNode, d: number) => {
      if (d > 8) return;
      if (!levels[d]) {
        const ordered = l.type === "orderedList";
        const a = l.attrs || {};
        const fmt = ordered ? (typeof a.numFmt === "string" && a.numFmt ? a.numFmt : ORDERED[d % 3]) : "bullet";
        const named: Record<string, string> = { disc: "•", circle: "◦", square: "▪" };
        const bullet = typeof a.bullet === "string" ? named[a.bullet] || (a.bullet.length <= 2 ? a.bullet : "") : "";
        const text = ordered ? (typeof a.lvlText === "string" && a.lvlText ? a.lvlText : `%${d + 1}.`) : bullet || BULLETS[d % 3];
        levels[d] = { fmt, text, start: ordered ? Math.max(0, Number(a.start ?? 1)) : 1 };
      }
      for (const item of l.content || []) for (const c of item.content || []) if (c.type === "bulletList" || c.type === "orderedList") walk(c, d + 1);
    };
    walk(list, 0);
    for (let d = 0; d < 9; d++)
      if (!levels[d]) {
        const prevOrdered = levels[d - 1]?.fmt !== "bullet" && d > 0;
        levels[d] = prevOrdered ? { fmt: ORDERED[d % 3], text: `%${d + 1}.`, start: 1 } : { fmt: "bullet", text: BULLETS[d % 3], start: 1 };
      }
    return levels;
  }

  newNum(list: PMNode): number {
    const levels = this.listLevels(list);
    const aid = this.abstractNums.length;
    const lvls = levels
      .map(
        (l, d) =>
          `<w:lvl w:ilvl="${d}"><w:start w:val="${l.start}"/><w:numFmt w:val="${l.fmt}"/><w:lvlText w:val="${esc(l.text)}"/><w:lvlJc w:val="left"/>` +
          `<w:pPr><w:ind w:left="${720 * (d + 1)}" w:hanging="360"/></w:pPr>${l.fmt === "bullet" && l.text === "◦" ? '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr>' : ""}</w:lvl>`,
      )
      .join("");
    this.abstractNums.push(`<w:abstractNum w:abstractNumId="${aid}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls}</w:abstractNum>`);
    const numId = this.nums.length + 1;
    this.nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${aid}"/></w:num>`);
    return numId;
  }

  // ---- comments ----
  countComments(n: PMNode) {
    if (n.type === "text") {
      const c = markOf(n, "comment")?.attrs?.threadId;
      if (typeof c === "string" && this.comments.some((t) => t.id === c)) this.commentRemaining.set(c, (this.commentRemaining.get(c) || 0) + 1);
    }
    n.content?.forEach((k) => this.countComments(k));
  }
  nextCommentId = 0;
  /** Word comment ids for a thread: one per message (replies are comments of their own). */
  commentWordIds(threadId: string): number[] {
    const t = this.comments.find((x) => x.id === threadId)!;
    let base = this.commentIndex.get(threadId);
    if (base === undefined) {
      base = this.nextCommentId;
      this.nextCommentId += Math.max(1, t.messages.length);
      this.commentIndex.set(threadId, base);
    }
    return t.messages.map((_, i) => base! + i);
  }

  // ---- footnotes and endnotes ----
  notes: Record<"footnote" | "endnote", string[]> = { footnote: [], endnote: [] };
  noteParts: Record<"footnote" | "endnote", Part> = { footnote: new Part("word/footnotes.xml"), endnote: new Part("word/endnotes.xml") };
  noteRun(n: PMNode): string {
    const kind = n.attrs?.kind === "endnote" ? "endnote" : "footnote";
    const id = this.notes[kind].length + 1;
    this.notes[kind].push(""); // reserve the id: the note's own content may hold more notes' runs
    let doc: PMNode = { type: "doc", content: [{ type: "paragraph" }] };
    try {
      const v = n.attrs?.content;
      const d = typeof v === "string" ? JSON.parse(v) : v;
      if (d && d.type === "doc") doc = d as PMNode;
    } catch {
      /* empty note */
    }
    const style = kind === "endnote" ? "EndnoteText" : "FootnoteText";
    const refStyle = kind === "endnote" ? "EndnoteReference" : "FootnoteReference";
    const paras = (doc.content || []).length ? doc.content! : [{ type: "paragraph" }];
    let body = this.blocks(
      paras.map((p) => (p.type === "paragraph" && !p.attrs?.styleId ? { ...p, attrs: { ...(p.attrs || {}), styleId: style } } : p)),
      this.noteParts[kind],
    );
    // the note's own number goes at the start of its first paragraph
    const mark = `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${kind}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`;
    body = body.replace(/<w:p>(<w:pPr>.*?<\/w:pPr>)?/, (m, ppr) => `<w:p>${ppr || ""}${mark}`);
    this.notes[kind][id - 1] = `<w:${kind} w:id="${id}">${body}</w:${kind}>`;
    return `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${kind}Reference w:id="${id}"/></w:r>`;
  }
  writeNotes(overrides: string[]) {
    for (const kind of ["footnote", "endnote"] as const) {
      if (!this.notes[kind].length) continue;
      const tag = `${kind}s`;
      const sep = `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
      this.zip.file(`word/${tag}.xml`, `${HEAD}<w:${tag} ${NS}>${sep}${this.notes[kind].join("")}</w:${tag}>`);
      const part = this.noteParts[kind];
      if (part.rels.length) this.zip.file(`word/_rels/${tag}.xml.rels`, part.relsXml());
      this.doc.rel(tag, `${tag}.xml`);
      overrides.push(`<Override PartName="/word/${tag}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tag}+xml"/>`);
    }
  }

  // ---- tracked changes ----
  revisionId = 1;
  /** Wrap run XML in w:ins / w:del when the text carries a tracked change. */
  revision(m: { attrs?: Record<string, unknown> } | undefined, tag: "ins" | "del", xml: string): string {
    if (!m) return xml;
    const a = m.attrs || {};
    const date = typeof a.date === "string" && !Number.isNaN(Date.parse(a.date)) ? ` w:date="${new Date(a.date).toISOString().replace(/\.\d+Z$/, "Z")}"` : "";
    return `<w:${tag} w:id="${this.revisionId++}" w:author="${esc(String(a.author || "Unknown"))}"${date}>${xml}</w:${tag}>`;
  }

  // ---- fields: captions, bookmarks, cross-references ----
  fields: FieldIndex = { bookmarks: new Map(), seq: new Map(), captions: [] };
  seqSeen = new Map<string, number>();
  bookmarksWritten = new Set<string>();
  /** bookmarks open in the current paragraph: those that end after the next SEQ field, and those that run to the paragraph's end */
  openLabel: number[] = [];
  openPara: number[] = [];
  closeBookmarks(): string {
    const ids = [...this.openLabel, ...this.openPara];
    this.openLabel = [];
    this.openPara = [];
    return ids.map((id) => `<w:bookmarkEnd w:id="${id}"/>`).join("");
  }
  complexField(instr: string, rpr: string, result: string): string {
    return `<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r>${instrRuns(` ${instr} `, rpr)}<w:r>${rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr}<w:t xml:space="preserve">${esc(result)}</w:t></w:r><w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>`;
  }
  fieldRun(n: PMNode, rpr: string, part: Part): string {
    const a = n.attrs || {};
    if (n.type === "bookmark") {
      const name = String(a.name || "");
      if (!name || this.bookmarksWritten.has(name)) return "";
      this.bookmarksWritten.add(name);
      const id = this.bookmarkId++;
      (a.span === "label" ? this.openLabel : this.openPara).push(id);
      return `<w:bookmarkStart w:id="${id}" w:name="${esc(name)}"/>`;
    }
    if (n.type === "seqField") {
      const name = String(a.name || "Figure");
      const num = (this.seqSeen.get(name) || 0) + 1;
      this.seqSeen.set(name, num);
      const fmt = a.format ? String(a.format) : "ARABIC";
      const xml = this.complexField(`SEQ ${name} \\* ${fmt}`, rpr, seqText(num, fmt));
      const ends = this.openLabel.map((id) => `<w:bookmarkEnd w:id="${id}"/>`).join("");
      this.openLabel = [];
      return xml + ends;
    }
    // crossRef
    const target = String(a.target || "");
    const show = (a.show as RefShow) || "text";
    const link = a.link !== false ? " \\h" : "";
    const switches = a.switches ? String(a.switches) : null;
    const text = refText(this.fields, target, show, { page: (b) => this.input.bookmarkPages?.[b.name] ?? null, below: part === this.doc ? !this.bookmarksWritten.has(target) : undefined, switches });
    const instr = switches
      ? `${show === "page" ? "PAGEREF" : "REF"} ${target} ${switches}${link}`
      : show === "page" ? `PAGEREF ${target}${link}` : show === "above" ? `REF ${target} \\p${link}` : show === "number" ? `REF ${target} \\r${link}` : `REF ${target}${link}`;
    return this.complexField(instr, rpr, text);
  }

  // ---- citations and bibliography ----
  sdtId = 1000;
  citeOrder: Map<string, number> | undefined;
  get sources(): Source[] {
    return this.input.settings?.sources || [];
  }
  get citeStyle(): CitationStyle {
    return this.input.settings?.citationStyle || "APA";
  }
  citedTags(): string[] {
    const out: string[] = [];
    const walk = (n: PMNode) => {
      if (n.type === "citation") for (const t of String(n.attrs?.tags || "").split(",")) if (t && !out.includes(t)) out.push(t);
      n.content?.forEach(walk);
    };
    walk(this.input.doc);
    return out;
  }
  citationRun(n: PMNode, rpr: string): string {
    const tags = String(n.attrs?.tags || "").split(",").filter(Boolean);
    if (!tags.length) return "";
    const pages = n.attrs?.pages ? String(n.attrs.pages) : "";
    if (this.citeStyle === "IEEE" && !this.citeOrder) this.citeOrder = citationOrder(this.sources, this.citedTags());
    const text = citationText(this.sources, tags, this.citeStyle, pages || undefined, this.citeOrder);
    const instr = `CITATION ${tags[0]} \\l 1033 ${pages ? `\\p ${/\s/.test(pages) ? `"${pages}"` : pages} ` : ""}${tags.slice(1).map((t) => `\\m ${t} `).join("")}`.trim();
    return `<w:sdt><w:sdtPr><w:id w:val="${this.sdtId++}"/><w:citation/></w:sdtPr><w:sdtContent>${this.complexField(instr, rpr, text)}</w:sdtContent></w:sdt>`;
  }
  bibliographyXml(n: PMNode): string {
    const style = this.citeStyle;
    const entries = bibliography(this.sources, style, this.citedTags());
    const title = typeof n.attrs?.title === "string" ? n.attrs.title : CITATION_STYLES.find((c) => c.id === style)?.title || "Bibliography";
    const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> BIBLIOGRAPHY </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const tabs = style === "IEEE" ? `<w:tabs><w:tab w:val="left" w:pos="${tw(36)}"/></w:tabs>` : "";
    const paras = entries.length
      ? entries.map(
          (e, i) =>
            `<w:p><w:pPr><w:pStyle w:val="Bibliography"/>${tabs}</w:pPr>${i === 0 ? begin : ""}${e.segs
              .map((g) => g.text.split("\t").map((t, k) => `${k ? "<w:r><w:tab/></w:r>" : ""}${t ? `<w:r>${g.italic ? "<w:rPr><w:i/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : ""}`).join(""))
              .join("")}${i === entries.length - 1 ? end : ""}</w:p>`,
        )
      : [`<w:p>${begin}<w:r><w:t>There are no sources in the current document.</w:t></w:r>${end}</w:p>`];
    return `<w:sdt><w:sdtPr><w:id w:val="${this.sdtId++}"/><w:docPartObj><w:docPartGallery w:val="Bibliographies"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(title)}</w:t></w:r></w:p>${paras.join("")}</w:sdtContent></w:sdt>`;
  }
  writeSources(overrides: string[]) {
    if (!this.sources.length) return;
    this.zip.file("customXml/item1.xml", sourcesXml(this.sources, this.citeStyle));
    this.zip.file(
      "customXml/itemProps1.xml",
      `${HEAD}<ds:datastoreItem ds:itemID="{6E8B5E0A-3C1D-4B7E-9F51-2A4C8D7E1B90}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>`,
    );
    this.zip.file("customXml/_rels/item1.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/customXmlProps" Target="itemProps1.xml"/></Relationships>`);
    this.doc.rel("customXml", "../customXml/item1.xml");
    overrides.push(`<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>`);
  }

  // ---- inline content ----
  runs(nodes: PMNode[] | undefined, part: Part, opts: { fields?: boolean; baseRun?: RunProps } = {}): string {
    const out: string[] = [];
    let link: string | null = null;
    const closeLink = () => {
      if (link !== null) out.push("</w:hyperlink>");
      link = null;
    };
    let perm: number | null = null;
    const closePerm = () => {
      if (perm !== null) out.push(`<w:permEnd w:id="${perm}"/>`);
      perm = null;
    };
    for (const n of nodes || []) {
      const editable = !!markOf(n, "editableRange");
      if (editable && perm === null) {
        closeLink();
        perm = this.permId++;
        out.push(`<w:permStart w:id="${perm}" w:edGrp="everyone"/>`);
      } else if (!editable && perm !== null) {
        closeLink();
        closePerm();
      }
      if (n.type === "contentControl") {
        closeLink();
        const a = (n.attrs || {}) as ControlAttrs & { placeholder?: string };
        const empty = !(n.content || []).length;
        // a checkbox shows its box as a glyph (Word swaps it when clicked); an empty one gets it here
        const inner = a.kind === "checkbox" && empty ? `<w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>${a.checked ? "☒" : "☐"}</w:t></w:r>` : empty ? `<w:r><w:rPr><w:color w:val="808080"/></w:rPr><w:t xml:space="preserve">${esc(a.placeholder || "Click or tap here to enter text.")}</w:t></w:r>` : this.runs(n.content, part, opts);
        out.push(`<w:sdt>${sdtPrXml(a, this.sdtId++, empty && a.kind !== "checkbox")}<w:sdtContent>${inner}</w:sdtContent></w:sdt>`);
        continue;
      }
      const href = (markOf(n, "link")?.attrs?.href as string) || null;
      const thread = markOf(n, "comment")?.attrs?.threadId as string | undefined;
      const hasThread = !!thread && this.commentRemaining.has(thread);
      if (hasThread && !this.commentStarted.has(thread!)) {
        closeLink();
        this.commentStarted.add(thread!);
        for (const id of this.commentWordIds(thread!)) out.push(`<w:commentRangeStart w:id="${id}"/>`);
      }
      if (href !== link) {
        closeLink();
        if (href) {
          if (href.startsWith("#")) out.push(`<w:hyperlink w:anchor="${esc(href.slice(1))}" w:history="1">`);
          else out.push(`<w:hyperlink r:id="${part.rel("hyperlink", href, true)}" w:history="1">`);
          link = href;
        }
      }
      if (n.type === "text") {
        const r = { ...opts.baseRun, ...nodeRunProps(n) };
        if (this.runColor && !r.color) r.color = this.runColor;
        if (href && !r.rStyle) r.rStyle = "Hyperlink";
        const rpr = rPrXml(r);
        const pieces = (n.text || "").split(/(\t|\n)/);
        const del = markOf(n, "deletion");
        const ins = markOf(n, "insertion");
        const tTag = del ? "w:delText" : "w:t";
        const inner = pieces
          .map((p) => (p === "\t" ? "<w:tab/>" : p === "\n" ? "<w:br/>" : p ? `<${tTag}${/^\s|\s$/.test(p) ? ' xml:space="preserve"' : ""}>${esc(p)}</${tTag}>` : ""))
          .join("");
        if (inner) out.push(this.revision(del || ins, del ? "del" : "ins", `<w:r>${rpr}${inner}</w:r>`));
      } else if (n.type === "hardBreak") out.push("<w:r><w:br/></w:r>");
      else if (n.type === "image") out.push(this.imageRun(n, part));
      else if (n.type === "wordChart") out.push(this.chartRun(n, part));
      else if (n.type === "indexEntry") out.push(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(xeInstr(n.attrs as IndexEntryAttrs))} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`);
      else if (n.type === "smartArt") out.push(this.smartArtRun(n, part));
      else if (n.type === "noteRef") out.push(this.noteRun(n));
      else if (n.type === "equation") {
        const latex = String(n.attrs?.latex || "");
        const font = `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>`;
        if (latex) out.push(n.attrs?.display ? latexToOmml(latex, font).replace(/ xmlns:m="[^"]*"/, "") : latexToOmmlInline(latex, font));
      } else if (n.type === "citation") out.push(this.citationRun(n, rPrXml({ ...opts.baseRun, ...nodeRunProps(n) })));
      else if (n.type === "bookmark" || n.type === "seqField" || n.type === "crossRef") out.push(this.fieldRun(n, rPrXml({ ...opts.baseRun, ...nodeRunProps(n) }), part));
      else if (n.type === "docField") out.push(this.complexField(String(n.attrs?.instr || "DATE"), rPrXml({ ...opts.baseRun, ...nodeRunProps(n) }), String(n.attrs?.result || "")));
      else if (n.type === "mergeField") out.push(this.complexField(mergeInstr(String(n.attrs?.name || "")), rPrXml({ ...opts.baseRun, ...nodeRunProps(n) }), `«${n.attrs?.name || ""}»`));
      else if (n.type === "pageField") {
        const kind = n.attrs?.kind === "pages" ? "NUMPAGES" : n.attrs?.kind === "sectionPages" ? "SECTIONPAGES" : "PAGE";
        const rpr = rPrXml({ ...opts.baseRun, ...nodeRunProps(n) });
        out.push(`<w:fldSimple w:instr=" ${kind} \\* MERGEFORMAT "><w:r>${rpr}<w:t>1</w:t></w:r></w:fldSimple>`);
      }
      if (hasThread) {
        const left = (this.commentRemaining.get(thread!) || 1) - 1;
        this.commentRemaining.set(thread!, left);
        if (left === 0) {
          closeLink();
          for (const id of this.commentWordIds(thread!)) out.push(`<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`);
        }
      }
    }
    closeLink();
    closePerm();
    return out.join("");
  }
  permId = 1;

  // ---- blocks ----
  paragraph(n: PMNode, part: Part, o: { numId?: number; ilvl?: number; style?: string; indentLeft?: number; fields?: boolean } = {}): string {
    const a = n.attrs || {};
    let style = o.style || (n.type === "heading" ? `Heading${Math.min(6, Math.max(1, Number(a.level) || 1))}` : (a.styleId as string) || undefined);
    if (style && !this.styles.some((s) => s.id === style)) style = undefined;
    const para = nodeParaProps(n);
    if (o.indentLeft !== undefined && para.indentLeft === undefined) para.indentLeft = o.indentLeft;
    let bookmark = "";
    const counted = n.type === "heading" && part === this.doc;
    if (counted && this.tocLevels && Number(a.level) <= this.tocLevels) {
      const name = `_Toc${String(100000000 + this.headingCounter).slice(1)}`;
      this.tocBookmarks.push({ name, level: Number(a.level), text: textOf(n) });
      const id = this.bookmarkId++;
      bookmark = `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`;
      this.headingCounter++;
      return `<w:p>${pPrXml({ style, para, numId: o.numId, ilvl: o.ilvl, keepNext: !!a.keepNext, keepLines: !!a.keepLines })}${this.takeAnchors()}${bookmark}${this.runs(n.content, part, o)}${this.closeBookmarks()}<w:bookmarkEnd w:id="${id}"/></w:p>`;
    }
    if (counted) this.headingCounter++;
    // a drop cap is its own framed paragraph holding the first letter
    let drop = "";
    let content = n.content;
    const dc = /^(drop|margin):(\d+)$/.exec(String(a.dropCap || ""));
    const first = content?.[0];
    if (dc && first?.type === "text" && first.text) {
      const letter = [...first.text][0];
      const lines = Number(dc[2]);
      const rest = first.text.slice(letter.length);
      content = [...(rest ? [{ ...first, text: rest }] : []), ...content!.slice(1)];
      const size = Math.round(lines * 13.2 * 2);
      const r = rPrXml({ ...nodeRunProps(first), size: size / 2, position: -lines * 2 });
      drop = `<w:p><w:pPr>${style ? `<w:pStyle w:val="${esc(style)}"/>` : ""}${dropCapFrameXml(lines, dc[1] === "margin")}<w:spacing w:after="0" w:line="${Math.round(lines * 13.2 * 20)}" w:lineRule="exact"/></w:pPr><w:r>${r}<w:t>${esc(letter)}</w:t></w:r></w:p>`;
    }
    return `${drop}<w:p>${pPrXml({ style, para, numId: o.numId, ilvl: o.ilvl, keepNext: !!a.keepNext, keepLines: !!a.keepLines, contextual: o.numId !== undefined })}${this.takeAnchors()}${this.runs(content, part, o)}${this.closeBookmarks()}</w:p>`;
  }

  list(n: PMNode, part: Part, numId: number, level: number, fields?: boolean): string {
    const out: string[] = [];
    for (const item of n.content || []) {
      let first = true;
      for (const c of item.content || []) {
        if (c.type === "bulletList" || c.type === "orderedList") out.push(this.list(c, part, numId, Math.min(8, level + 1), fields));
        else if (c.type === "paragraph" || c.type === "heading") {
          out.push(first ? this.paragraph(c, part, { numId, ilvl: level, style: c.type === "paragraph" && !c.attrs?.styleId ? "ListParagraph" : undefined, fields }) : this.paragraph(c, part, { style: "ListParagraph", indentLeft: 36 * (level + 1), fields }));
          first = false;
        } else out.push(this.blocks([c], part, fields));
      }
      if (first) out.push(`<w:p>${pPrXml({ style: "ListParagraph", numId, ilvl: level, para: {}, contextual: true })}</w:p>`);
    }
    return out.join("");
  }

  table(n: PMNode, part: Part, fields?: boolean): string {
    const rows = n.content || [];
    // place cells on the grid, following rowspans
    const occupied: number[] = []; // remaining rows covered, per grid column
    type Placed = { cell: PMNode; col: number; span: number; cont: boolean };
    const grid: Placed[][] = [];
    let cols = 0;
    for (const row of rows) {
      const placed: Placed[] = [];
      let col = 0;
      const cells = row.content || [];
      let ci = 0;
      const covering = new Map<number, Placed>();
      for (let r = grid.length - 1; r >= 0; r--) for (const p of grid[r]) if (!p.cont && (Number(p.cell.attrs?.rowspan) || 1) > grid.length - r && !covering.has(p.col)) covering.set(p.col, p);
      while (ci < cells.length || occupied.slice(col).some((x) => x > 0)) {
        if (occupied[col] > 0) {
          const origin = covering.get(col);
          const span = origin?.span || 1;
          placed.push({ cell: origin?.cell || cells[0], col, span, cont: true });
          for (let k = 0; k < span; k++) occupied[col + k]--;
          col += span;
          continue;
        }
        if (ci >= cells.length) {
          col++;
          continue;
        }
        const cell = cells[ci++];
        const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
        const rs = Math.max(1, Number(cell.attrs?.rowspan) || 1);
        placed.push({ cell, col, span, cont: false });
        for (let k = 0; k < span; k++) occupied[col + k] = rs - 1;
        col += span;
      }
      cols = Math.max(cols, col);
      grid.push(placed);
    }
    // column widths (px) from cells that span one column
    const widths: (number | undefined)[] = new Array(cols).fill(undefined);
    for (const row of grid)
      for (const p of row) {
        const cw = p.cell.attrs?.colwidth as number[] | null | undefined;
        if (Array.isArray(cw)) cw.forEach((w, k) => w && widths[p.col + k] === undefined && (widths[p.col + k] = w));
      }
    const totalPt = contentWidth(this.input.body || parseSection(null));
    const known = widths.filter((w): w is number => !!w).reduce((s, w) => s + w * 0.75, 0);
    const unknown = widths.filter((w) => !w).length;
    const each = unknown ? Math.max(36, (totalPt - known) / unknown) : 0;
    const colTw = widths.map((w) => tw(w ? w * 0.75 : each));
    const total = colTw.reduce((s, w) => s + w, 0);
    const out: string[] = [];
    const tstyle = tableStyle(n.attrs?.tableStyle);
    const look = lookOf(n.attrs?.look);
    const align = n.attrs?.align === "center" || n.attrs?.align === "right" ? `<w:jc w:val="${n.attrs.align === "center" ? "center" : "right"}"/>` : "";
    out.push(
      `<w:tbl><w:tblPr>${tstyle ? `<w:tblStyle w:val="${tstyle.id}"/>` : ""}<w:tblW w:w="${total}" w:type="dxa"/>${align}` +
        (tstyle ? "" : "<w:tblBorders>" + ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join("") + "</w:tblBorders>") +
        `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>${tblLookXml(look)}</w:tblPr>`,
    );
    out.push(`<w:tblGrid>${colTw.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`);
    grid.forEach((row, ri) => {
      const header = (rows[ri].content || []).length > 0 && (rows[ri].content || []).every((c) => c.type === "tableHeader");
      const height = Number(rows[ri].attrs?.height) || 0;
      const trPr = [height ? `<w:trHeight w:val="${tw(height * 0.75)}"/>` : "", header ? "<w:tblHeader/>" : ""].join("");
      out.push(`<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ""}`);
      for (const p of row) {
        const a = p.cell.attrs || {};
        const w = colTw.slice(p.col, p.col + p.span).reduce((s, x) => s + x, 0);
        const tc: string[] = [`<w:tcW w:w="${w}" w:type="dxa"/>`];
        if (p.span > 1) tc.push(`<w:gridSpan w:val="${p.span}"/>`);
        if (p.cont) tc.push("<w:vMerge/>");
        else if ((Number(a.rowspan) || 1) > 1) tc.push('<w:vMerge w:val="restart"/>');
        const b = parseBorders(a.borders);
        const bx = ["top", "left", "bottom", "right"].map((s) => borderXml(s, b[s])).join("");
        if (bx) tc.push(`<w:tcBorders>${bx}</w:tcBorders>`);
        const bg = hexColor(a.background);
        if (bg) tc.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(bg)}"/>`);
        const va = a.valign as string | undefined;
        if (va === "middle" || va === "bottom") tc.push(`<w:vAlign w:val="${va === "middle" ? "center" : "bottom"}"/>`);
        let content = p.cont ? "<w:p/>" : this.blocks(p.cell.content || [], part, fields);
        if (!content.endsWith("</w:p>") && !content.endsWith("<w:p/>")) content += "<w:p/>";
        out.push(`<w:tc><w:tcPr>${tc.join("")}</w:tcPr>${content}</w:tc>`);
      }
      out.push("</w:tr>");
    });
    out.push("</w:tbl>");
    return out.join("");
  }

  toc(n: PMNode): string {
    if (n.attrs?.caption) return this.tableOfFigures(n, String(n.attrs.caption));
    const levels = this.tocLevels;
    const width = contentWidth(this.input.body || parseSection(null));
    const title = typeof n.attrs?.title === "string" ? n.attrs.title : "";
    const pages = this.input.headingPages || [];
    // the headings it lists are those after the TOC's bookmarks are assigned: precompute from the doc
    const entries = this.tocEntries;
    const tabs = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tw(width) - 10}"/></w:tabs>`;
    const paras: string[] = [];
    if (title) paras.push(`<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>${esc(title)}</w:t></w:r></w:p>`);
    const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="false"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${levels}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    if (!entries.length) {
      paras.push(`<w:p>${begin}<w:r><w:t>No table of contents entries found.</w:t></w:r>${end}</w:p>`);
    } else
      entries.forEach((e, i) => {
        const page = pages[e.index] ?? "";
        paras.push(
          `<w:p><w:pPr><w:pStyle w:val="TOC${Math.min(3, e.level) === e.level ? e.level : 3}"/>${tabs}</w:pPr>${i === 0 ? begin : ""}` +
            `<w:hyperlink w:anchor="${e.name}" w:history="1"><w:r><w:t xml:space="preserve">${esc(e.text)}</w:t></w:r><w:r><w:tab/></w:r>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF ${e.name} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${page}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>` +
            `${i === entries.length - 1 ? end : ""}</w:p>`,
        );
      });
    return `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${paras.join("")}</w:sdtContent></w:sdt>`;
  }
  tocEntries: { name: string; level: number; text: string; index: number }[] = [];

  /** The index (an INDEX field) with its entries as Word would show them after an update. */
  indexBlock(n: PMNode): string {
    const o = { columns: Number(n.attrs?.columns) || 1, rightAlign: !!n.attrs?.rightAlign, headings: n.attrs?.headings !== false };
    const entries: (IndexEntryAttrs & { page: string })[] = [];
    let k = 0;
    const walk = (x: PMNode) => {
      if (x.type === "indexEntry") entries.push({ ...(x.attrs as IndexEntryAttrs), page: this.input.indexPages?.[k++] ?? "1" });
      x.content?.forEach(walk);
    };
    walk(this.input.doc);
    const groups = buildIndex(entries);
    const width = contentWidth(this.input.body || parseSection(null)) / o.columns - 12;
    const tabs = o.rightAlign ? `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tw(width)}"/></w:tabs>` : "";
    const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="false"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(indexInstr(o))} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const paras: string[] = [];
    const line = (it: IndexItem, level: number) => {
      const pages = it.see
        ? `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">See </w:t></w:r><w:r><w:t>${esc(it.see)}</w:t></w:r>`
        : it.pages.map((p, i) => `${i ? '<w:r><w:t xml:space="preserve">, </w:t></w:r>' : ""}<w:r>${p.bold || p.italic ? `<w:rPr>${p.bold ? "<w:b/>" : ""}${p.italic ? "<w:i/>" : ""}</w:rPr>` : ""}<w:t>${esc(p.label)}</w:t></w:r>`).join("");
      const sep = it.see || it.pages.length ? (o.rightAlign && !it.see ? "<w:r><w:tab/></w:r>" : '<w:r><w:t xml:space="preserve">, </w:t></w:r>') : "";
      paras.push(`<w:p><w:pPr><w:pStyle w:val="Index${Math.min(3, level)}"/>${tabs}</w:pPr><w:r><w:t xml:space="preserve">${esc(it.text)}</w:t></w:r>${sep}${pages}</w:p>`);
      for (const s of it.subs) line(s, level + 1);
    };
    for (const g of groups) {
      if (o.headings) paras.push(`<w:p><w:pPr><w:pStyle w:val="IndexHeading"/></w:pPr><w:r><w:t>${esc(g.letter === "*" ? "Symbols" : g.letter === "#" ? "Numbers" : g.letter)}</w:t></w:r></w:p>`);
      for (const it of g.items) line(it, 1);
    }
    if (!paras.length) return `<w:p>${begin}<w:r><w:t>No index entries found.</w:t></w:r>${end}</w:p>`;
    // the field starts in the first paragraph and ends in the last
    paras[0] = paras[0].replace(/(<\/w:pPr>)/, `$1${begin}`);
    paras[paras.length - 1] = paras[paras.length - 1].replace(/<\/w:p>$/, `${end}</w:p>`);
    return paras.join("");
  }

  /** Table of figures (TOC \\c "Figure"): one line per caption with that label. */
  tableOfFigures(n: PMNode, label: string): string {
    const width = contentWidth(this.input.body || parseSection(null));
    const tabs = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tw(width) - 10}"/></w:tabs>`;
    const entries = this.fields.captions.filter((c) => c.label === label);
    const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="false"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\h \\z \\c "${esc(label)}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const title = typeof n.attrs?.title === "string" && n.attrs.title ? `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>${esc(n.attrs.title)}</w:t></w:r></w:p>` : "";
    if (!entries.length) return `${title}<w:p>${begin}<w:r><w:t>No table of figures entries found.</w:t></w:r>${end}</w:p>`;
    return (
      title +
      entries
        .map((e, i) => {
          const page = (e.bookmark && this.input.bookmarkPages?.[e.bookmark]) || "";
          const inner = `<w:r><w:t xml:space="preserve">${esc(e.text)}</w:t></w:r><w:r><w:tab/></w:r>` + (e.bookmark ? this.complexField(`PAGEREF ${e.bookmark} \\h`, "", page) : `<w:r><w:t>${esc(page)}</w:t></w:r>`);
          return `<w:p><w:pPr><w:pStyle w:val="TableofFigures"/>${tabs}</w:pPr>${i === 0 ? begin : ""}${e.bookmark ? `<w:hyperlink w:anchor="${esc(e.bookmark)}" w:history="1">${inner}</w:hyperlink>` : inner}${i === entries.length - 1 ? end : ""}</w:p>`;
        })
        .join("")
    );
  }

  blocks(nodes: PMNode[], part: Part, fields?: boolean): string {
    const out: string[] = [];
    for (const n of nodes) {
      switch (n.type) {
        case "paragraph":
        case "heading":
          out.push(this.paragraph(n, part, { fields }));
          break;
        case "bulletList":
        case "orderedList":
          out.push(this.list(n, part, this.newNum(n), 0, fields));
          break;
        case "taskList":
          // each task starts with a Word checkbox control, tagged so it comes back as a task
          for (const item of n.content || []) {
            const box: PMNode = { type: "contentControl", attrs: { kind: "checkbox", checked: !!item.attrs?.checked, tag: TASK_TAG } };
            (item.content || []).forEach((c, i) => {
              if (c.type === "paragraph") out.push(this.paragraph({ ...c, content: i === 0 ? [box, { type: "text", text: " " }, ...(c.content || [])] : c.content }, part, { indentLeft: 18 }));
              else out.push(this.blocks([c], part, fields));
            });
          }
          break;
        case "blockquote":
          for (const c of n.content || []) out.push(c.type === "paragraph" ? this.paragraph(c, part, { style: "Quote" }) : this.blocks([c], part, fields));
          break;
        case "codeBlock": {
          const text = (n.content || []).map((t) => t.text || "").join("");
          out.push(`<w:p>${pPrXml({ style: "Code", para: {} })}${this.runs([{ type: "text", text }], part)}</w:p>`);
          break;
        }
        case "horizontalRule":
          out.push(`<w:p>${pPrXml({ pBdrBottom: true, para: {} })}</w:p>`);
          break;
        case "image":
        case "shape": {
          const inline = !n.attrs?.wrap || n.attrs.wrap === "inline";
          // a floating object is anchored in the paragraph it floats beside (an empty paragraph of its own would add a line)
          const next = nodes[nodes.indexOf(n) + 1];
          if (!inline && n.attrs?.wrap !== "topBottom" && next && (next.type === "paragraph" || next.type === "heading")) {
            this.anchors.push(n.type === "image" ? this.imageRun(n, part) : this.shapeRun(n, part));
            break;
          }
          const align = inline ? (n.attrs?.align as ParaProps["align"] | undefined) : undefined;
          out.push(`<w:p>${pPrXml({ para: align ? { align } : {} })}${n.type === "image" ? this.imageRun(n, part) : this.shapeRun(n, part)}</w:p>`);
          break;
        }
        case "table":
          out.push(this.table(n, part, fields));
          break;
        case "pageBreak":
          out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
          break;
        case "sectionBreak": {
          const s = parseSection(n.attrs?.section);
          out.push(`<w:p>${pPrXml({ para: {}, sectPr: this.sectPr(s) })}</w:p>`);
          break;
        }
        case "wordIndex":
          out.push(this.indexBlock(n));
          break;
        case "tableOfContents":
          out.push(this.toc(n));
          break;
        case "bibliography":
          out.push(this.bibliographyXml(n));
          break;
        case "blockControl":
          out.push(`<w:sdt>${blockSdtPrXml((n.attrs || {}) as Partial<BlockControlAttrs>, this.sdtId++)}<w:sdtContent>${this.blocks(n.content?.length ? n.content : [{ type: "paragraph" }], part, fields)}</w:sdtContent></w:sdt>`);
          break;
        default:
          if (n.content) out.push(this.blocks(n.content, part, fields));
      }
    }
    return out.join("");
  }

  // ---- sections, headers, footers ----
  sectPr(s: Section): string {
    const refs: string[] = [];
    if (this.watermarkHeaderNeeded && !s.headers?.default) s = { ...s, headers: { ...(s.headers || {}), default: { type: "doc", content: [{ type: "paragraph" }] } } };
    this.watermarkHeaderNeeded = false;
    const add = (kind: "header" | "footer", set: Section["headers"]) => {
      if (!set) return;
      for (const t of ["default", "first", "even"] as const) {
        const d = set[t];
        if (!d) continue;
        const idx = this.headerParts.filter((h) => h.kind === kind).length + 1;
        const path = `word/${kind}${idx}.xml`;
        const part = new Part(path);
        const tag = kind === "header" ? "w:hdr" : "w:ftr";
        let body = this.blocks(d.content || [], part, true);
        if (!body.endsWith("</w:p>") && !body.endsWith("<w:p/>")) body += "<w:p/>";
        body = body.replace(/<w:p>(?!<w:pPr>)/g, `<w:p><w:pPr><w:pStyle w:val="${kind === "header" ? "Header" : "Footer"}"/></w:pPr>`);
        const wm = kind === "header" ? this.input.settings?.watermark : undefined;
        if (wm) {
          let rid: string | undefined;
          if (wm.kind === "picture" && wm.image) {
            const img = dataUrl(wm.image);
            if (img) {
              const name = `media/watermark${this.media.length + 1}.${EXT[img.mime] || "png"}`;
              this.media.push({ path: name, bytes: img.bytes });
              rid = part.rel("image", name);
            }
          }
          const shape = watermarkVml(wm, contentWidth(s), rid, this.headerParts.length + 1);
          // the shape sits in a run of the header's first paragraph
          body = body.replace(/(<w:p>(?:<w:pPr>.*?<\/w:pPr>)?)|<w:p\/>/, (m0, open) => (open ? open + shape : `<w:p>${shape}</w:p>`));
        }
        this.headerParts.push({ path, part, kind, xml: `${HEAD}<${tag} ${NS} ${VML_NS}>${body}</${tag}>` });
        refs.push(`<w:${kind}Reference w:type="${t}" r:id="${this.doc.rel(kind, `${kind}${idx}.xml`)}"/>`);
      }
    };
    add("header", s.headers);
    add("footer", s.footers);
    // headerReference elements come before footerReference ones
    refs.sort((x, y) => Number(x.startsWith("<w:footer")) - Number(y.startsWith("<w:footer")));
    return sectPrXml(s, refs.join(""));
  }

  stylesXml(): string {
    const out: string[] = [];
    out.push(
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`,
    );
    out.push('<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>');
    for (const s of this.styles) {
      const name = WORD_NAMES[s.id] || s.name;
      const attrs = `w:type="${s.type}"${s.id === "Normal" ? ' w:default="1"' : ""}${s.builtin || BUILTIN_STYLES.some((b) => b.id === s.id) ? "" : ' w:customStyle="1"'} w:styleId="${esc(s.id)}"`;
      const x: string[] = [`<w:name w:val="${esc(name)}"/>`];
      if (s.basedOn && this.styles.some((b) => b.id === s.basedOn)) x.push(`<w:basedOn w:val="${esc(s.basedOn)}"/>`);
      if (s.next && this.styles.some((b) => b.id === s.next)) x.push(`<w:next w:val="${esc(s.next)}"/>`);
      if (s.hidden) x.push("<w:semiHidden/><w:unhideWhenUsed/>");
      if (s.gallery) x.push("<w:qFormat/>");
      if (s.type === "paragraph") {
        const p = s.para || {};
        const h = /^Heading([1-6])$/.exec(s.id);
        let ppr = pPrXml({ keepNext: p.keepNext, keepLines: p.keepLines, pageBreakBefore: p.pageBreakBefore, para: p, contextual: s.id === "ListParagraph" });
        if (h) ppr = ppr ? ppr.replace("</w:pPr>", `<w:outlineLvl w:val="${Number(h[1]) - 1}"/></w:pPr>`) : `<w:pPr><w:outlineLvl w:val="${Number(h[1]) - 1}"/></w:pPr>`;
        x.push(ppr);
      }
      x.push(rPrXml(s.run || {}));
      out.push(`<w:style ${attrs}>${x.join("")}</w:style>`);
    }
    out.push(TABLE_NORMAL_XML);
    const used = new Set<string>();
    const scan = (n: PMNode) => {
      if (n.type === "table" && tableStyle(n.attrs?.tableStyle)) used.add(String(n.attrs!.tableStyle));
      (n.content || []).forEach(scan);
    };
    scan(this.input.doc);
    for (const id of used) out.push(tableStyleXml(tableStyle(id)!));
    return `${HEAD}<w:styles ${NS}>${out.join("")}</w:styles>`;
  }

  async build(): Promise<Uint8Array> {
    const { doc } = this.input;
    const body = parseSection(this.input.body || null);
    const nodes = doc.content || [];
    // images anywhere: body, headers and footers of every section
    const hf: PMNode[] = [];
    const collectHF = (s: Section) => [s.headers, s.footers].forEach((set) => set && Object.values(set).forEach((d) => d && hf.push(d)));
    for (const n of nodes) if (n.type === "sectionBreak") collectHF(parseSection(n.attrs?.section));
    collectHF(body);
    await this.prepareImages([...nodes, ...hf]);
    // comments: only threads that are anchored in the document
    for (const n of nodes) this.countComments(n);
    this.fields = fieldIndex(doc as never);
    // table of contents
    const toc = findNode(doc, "tableOfContents", (n) => !n.attrs?.caption);
    if (toc) {
      this.tocLevels = Math.min(9, Math.max(1, Number(toc.attrs?.levels) || 3));
      let i = 0;
      let k = 0;
      const walk = (n: PMNode) => {
        if (n.type === "heading") {
          if (Number(n.attrs?.level) <= this.tocLevels) this.tocEntries.push({ name: `_Toc${String(100000000 + k).slice(1)}`, level: Number(n.attrs?.level), text: textOf(n), index: i });
          k++;
          i++;
          return;
        }
        n.content?.forEach(walk);
      };
      walk(doc);
    }
    const st = this.input.settings || {};
    if (st.watermark && (st.watermark.text || st.watermark.image)) {
      const all = [...nodes.filter((n) => n.type === "sectionBreak").map((n) => parseSection(n.attrs?.section)), body];
      this.watermarkHeaderNeeded = !all.some((x) => x.headers?.default);
    }
    let bodyXml = this.blocks(nodes, this.doc);
    if (!nodes.length || nodes[nodes.length - 1].type === "table") bodyXml += "<w:p/>";
    const finalSect = this.sectPr(body);
    const zip = this.zip;
    const bg = st.pageColor && /^#[0-9a-f]{6}$/i.test(st.pageColor) ? `<w:background w:color="${st.pageColor.slice(1).toUpperCase()}"/>` : "";
    zip.file("word/document.xml", `${HEAD}<w:document ${NS}>${bg}<w:body>${bodyXml}${finalSect}</w:body></w:document>`);

    // parts the document points to
    this.doc.rel("styles", "styles.xml");
    this.doc.rel("settings", "settings.xml");
    this.doc.rel("fontTable", "fontTable.xml");
    this.doc.rel("theme", "theme/theme1.xml");
    zip.file("word/theme/theme1.xml", themeXml(themeOf(this.input.settings?.theme)));
    if (this.nums.length) {
      this.doc.rel("numbering", "numbering.xml");
      zip.file("word/numbering.xml", `${HEAD}<w:numbering ${NS}>${this.abstractNums.join("")}${this.nums.join("")}</w:numbering>`);
    }
    zip.file("word/styles.xml", this.stylesXml());
    zip.file(
      "word/settings.xml",
      this.settingsXml(),
    );
    zip.file("word/fontTable.xml", `${HEAD}<w:fonts ${NS}>${this.fontsUsed().map((f) => `<w:font w:name="${esc(f)}"/>`).join("")}</w:fonts>`);
    const overrides: string[] = [];
    const ct = (path: string, type: string) => overrides.push(`<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`);
    for (const h of this.headerParts) {
      zip.file(h.path, h.xml);
      if (h.part.rels.length) zip.file(h.path.replace("word/", "word/_rels/") + ".rels", h.part.relsXml());
      ct(h.path, h.kind);
    }
    this.writeComments(overrides);
    this.writeNotes(overrides);
    this.writeSources(overrides);
    for (const m of this.media) zip.file(`word/${m.path}`, m.bytes);
    await this.writeGraphics(zip, overrides);
    zip.file("word/_rels/document.xml.rels", this.doc.relsXml());
    ct("word/document.xml", "document.main");
    ct("word/styles.xml", "styles");
    ct("word/settings.xml", "settings");
    ct("word/fontTable.xml", "fontTable");
    overrides.push('<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>');
    if (this.nums.length) ct("word/numbering.xml", "numbering");
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const props = this.input.settings?.properties || {};
    const propXml = (part: "core" | "app") => BUILTIN_PROPERTIES.filter((b) => b.part === part && props[b.name]).map((b) => `<${b.tag}>${esc(props[b.name])}</${b.tag}>`).join("");
    zip.file(
      "docProps/core.xml",
      `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(this.input.title || "")}</dc:title><dc:creator>${esc(this.input.author || "")}</dc:creator>${propXml("core")}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    );
    zip.file(
      "docProps/app.xml",
      `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Synergy Docs</Application>${propXml("app")}</Properties>`,
    );
    const custom = Object.entries(this.input.settings?.customProperties || {});
    if (custom.length)
      zip.file(
        "docProps/custom.xml",
        `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${custom.map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(k)}"><vt:lpwstr>${esc(v)}</vt:lpwstr></property>`).join("")}</Properties>`,
    );
    zip.file(
      "_rels/.rels",
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>${custom.length ? `<Relationship Id="rId4" Type="${REL}/custom-properties" Target="docProps/custom.xml"/>` : ""}</Relationships>`,
    );
    const defaults = [...new Set(this.media.map((m) => m.path.split(".").pop()!))]
      .map((e) => `<Default Extension="${e}" ContentType="image/${e === "jpg" ? "jpeg" : e === "emf" || e === "wmf" ? `x-${e}` : e === "svg" ? "svg+xml" : e}"/>`)
      .join("");
    const xlsxDefault = this.charts.length ? '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>' : "";
    zip.file(
      "[Content_Types].xml",
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}${xlsxDefault}${overrides.join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${custom.length ? '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' : ""}</Types>`,
    );
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  /** settings.xml, its children in schema order. */
  settingsXml(): string {
    const st = this.input.settings || {};
    const x: string[] = ['<w:zoom w:percent="100"/>'];
    if (st.pageColor) x.push("<w:displayBackgroundShape/>");
    if (st.mirrorMargins) x.push("<w:mirrorMargins/>");
    if (st.trackRevisions) x.push("<w:trackRevisions/>");
    x.push(...this.protectionXml());
    x.push('<w:defaultTabStop w:val="720"/>');
    if (st.autoHyphenation) x.push("<w:autoHyphenation/>");
    if (st.evenAndOddHeaders) x.push("<w:evenAndOddHeaders/>");
    x.push('<w:characterSpacingControl w:val="doNotCompress"/>');
    x.push(...this.settingsExtra);
    if (this.notes.footnote.length) x.push('<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>');
    if (this.notes.endnote.length) x.push('<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>');
    x.push('<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>');
    return `${HEAD}<w:settings ${NS}>${x.join("")}</w:settings>`;
  }
  /** w:documentProtection (restrict editing), set later */
  protectionXml(): string[] {
    const p = this.input.settings?.protection;
    return p ? [protectionXml(p)] : [];
  }
  /** settings children that go between characterSpacingControl and compat (footnotePr, endnotePr) */
  settingsExtra: string[] = [];
  /** a watermark needs a header: the first section written gets an empty one if it has none */
  watermarkHeaderNeeded = false;

  fontsUsed(): string[] {
    const set = new Set<string>(["Calibri", "Calibri Light"]);
    for (const s of this.styles) if (s.run?.font) set.add(s.run.font);
    const walk = (n: PMNode) => {
      for (const m of n.marks || []) if (m.type === "textStyle" && typeof m.attrs?.fontFamily === "string" && m.attrs.fontFamily) set.add(fontName(m.attrs.fontFamily));
      n.content?.forEach(walk);
    };
    walk(this.input.doc);
    return [...set];
  }

  writeComments(overrides: string[]) {
    if (!this.commentIndex.size) return;
    const items: string[] = [];
    const ext: string[] = [];
    let para = 0x10000001;
    for (const [threadId, base] of this.commentIndex) {
      const t = this.comments.find((x) => x.id === threadId);
      if (!t) continue;
      let rootPara = "";
      t.messages.forEach((m, i) => {
        const pid = (para++).toString(16).toUpperCase().padStart(8, "0");
        if (i === 0) rootPara = pid;
        const date = m.date ? ` w:date="${new Date(m.date).toISOString().replace(/\.\d+Z$/, "Z")}"` : "";
        const initials = m.initials || initialsOf(m.author);
        const lines = String(m.body || "").split("\n");
        const ps = lines
          .map((line, li) => `<w:p w14:paraId="${li === lines.length - 1 ? pid : (para++).toString(16).toUpperCase().padStart(8, "0")}" w14:textId="77777777">${li === 0 ? "<w:r><w:annotationRef/></w:r>" : ""}<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
          .join("");
        items.push(`<w:comment w:id="${base + i}" w:author="${esc(m.author || "Unknown")}"${date} w:initials="${esc(initials)}">${ps}</w:comment>`);
        ext.push(`<w15:commentEx w15:paraId="${pid}"${i > 0 ? ` w15:paraIdParent="${rootPara}"` : ""} w15:done="${t.resolved ? 1 : 0}"/>`);
      });
    }
    this.zip.file("word/comments.xml", `${HEAD}<w:comments ${NS}>${items.join("")}</w:comments>`);
    this.zip.file("word/commentsExtended.xml", `${HEAD}<w15:commentsEx ${NS}>${ext.join("")}</w15:commentsEx>`);
    this.doc.rel("comments", "comments.xml");
    this.doc.rel("http://schemas.microsoft.com/office/2011/relationships/commentsExtended", "commentsExtended.xml");
    overrides.push(`<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`);
    overrides.push(`<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>`);
  }
}

function initialsOf(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 3);
}

export function textOf(n: PMNode): string {
  if (n.type === "text") return n.text || "";
  return (n.content || []).map(textOf).join("");
}

function findNode(n: PMNode, type: string, ok: (n: PMNode) => boolean = () => true): PMNode | undefined {
  if (n.type === type && ok(n)) return n;
  for (const c of n.content || []) {
    const f = findNode(c, type, ok);
    if (f) return f;
  }
  return undefined;
}

/** Build a .docx from the editor's JSON and the document's styles and sections. */
export async function buildDocx(input: DocxInput): Promise<Uint8Array> {
  return new Writer(input).build();
}

/** A field instruction as runs, with fields nested in it ({ ... }) written as fields of their own. */
export function instrRuns(instr: string, rpr: string): string {
  let out = "";
  let text = "";
  const flush = () => {
    if (text) out += `<w:r>${rpr}<w:instrText xml:space="preserve">${esc(text)}</w:instrText></w:r>`;
    text = "";
  };
  for (let i = 0; i < instr.length; i++) {
    if (instr[i] === "{") {
      let depth = 0;
      let j = i;
      for (; j < instr.length; j++) {
        if (instr[j] === "{") depth++;
        else if (instr[j] === "}" && --depth === 0) break;
      }
      if (j < instr.length) {
        flush();
        out += `<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r>${instrRuns(instr.slice(i + 1, j), rpr)}<w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>`;
        i = j;
        continue;
      }
    }
    text += instr[i];
  }
  flush();
  return out;
}
