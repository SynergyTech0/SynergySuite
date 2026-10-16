// OpenDocument Presentation (.odp) export. Each slide becomes a draw:page with
// its master/layout objects drawn on it (so it looks the same in any viewer):
// title and outline frames, text boxes, shapes (rectangles, ellipses, lines
// and every other preset or freeform as a custom shape with its own path),
// pictures, tables (merged cells, fills, borders), charts and equations as
// embedded chart/formula objects, groups, backgrounds, hidden slides and
// speaker notes. Objects carry their ids in draw:name (syn-el-<id>) and our
// shape kind in a foreign attribute, so our importer reads them back exactly.
import { groupPath } from "./selection";
import { croppedPicture } from "./crop";
import JSZip from "jszip";
import { CHART_COLORS, seriesType, applyMaster, isCustomKey, masterFor, bodyBox, layoutBoxes, layoutKeyOf, bodyPt, titleBox, titlePt, toHtml, type ChartEl, type Gradient, type MathEl, type ShapeEl, type Slide, type SlideElement, type TableEl, type TextEl, type SlotKind } from "./model";
import { effectiveTheme, type ThemeColors } from "./themes";
import { isLineShape, shapePath } from "./shapes";
import { normalizePath } from "./svgpath";
import { parseD, scaledD } from "./freeform";
import { cellHtml, fractions, gridCols, normalizeTable, DEFAULT_BORDER } from "./table";
import { styledRows } from "./table-style";
import { latexToMathml } from "./math";
import { validGradient } from "./effects";
import type { HeaderFooter, Masters } from "./model";
import { ANIM_NS, addAnimIds, smilXml } from "./odp-anim";
import { ZOOM_PLACEHOLDER, mastersProp } from "./pptx-export";

export const ODP_MIME = "application/vnd.oasis.opendocument.presentation";
export const SYN_NS = "urn:synergy:office:1";

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  'xmlns:math="http://www.w3.org/1998/Math/MathML"',
  'xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0"',
  `xmlns:syn="${SYN_NS}"`,
  ANIM_NS,
].join(" ");

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cm = (px: number) => `${Math.round((px * 2.54 * 10000) / 96) / 10000}cm`;
const pt = (n: number) => `${Math.round(n * 10) / 10}pt`;
const hex = (c: string | undefined | null) => `#${(c || "000000").toLowerCase()}`;

export type OdpDeck = {
  name: string;
  w: number;
  h: number;
  theme: string;
  colors?: ThemeColors;
  font?: string;
  headFont?: string;
  hf?: HeaderFooter;
  masters?: Masters;
};

/** Automatic styles, deduplicated by their XML. */
class Styles {
  /** `pre` keeps the names of styles.xml's automatic styles apart from content.xml's */
  constructor(private pre = "") {}
  private map = new Map<string, string>();
  private counters: Record<string, number> = {};
  list: string[] = [];
  add(prefix: string, family: string, props: string, extra = ""): string {
    const key = `${family}|${extra}|${props}`;
    let name = this.map.get(key);
    if (!name) {
      this.counters[prefix] = (this.counters[prefix] || 0) + 1;
      name = `${this.pre}${prefix}${this.counters[prefix]}`;
      this.map.set(key, name);
      this.list.push(`<style:style style:name="${name}" style:family="${family}"${extra}>${props}</style:style>`);
    }
    return name;
  }
}

type Ctx = {
  st: Styles;
  zip: JSZip;
  pics: Map<string, string>;
  manifest: string[];
  gradients: Map<string, string>;
  objects: number;
  textColor: string;
  /** theme accent and background (table styles) */
  accent?: string;
  bg?: string;
  font: string;
  warnings: Set<string>;
  /** draw:name of each slide id's page, when it is unique (zoom click actions jump by name) */
  pageNames?: Map<string, string>;
};

/** A page's draw:name. */
const pageName = (s: Slide, i: number) => s.title.split("\n")[0].slice(0, 60) || `Slide ${i + 1}`;

// ---------------------------------------------------------------- text

type Run = { b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string; size?: string; font?: string; bg?: string; pos?: "super" | "sub" };

function textStyle(c: Ctx, r: Run): string {
  const p: string[] = [];
  if (r.b) p.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"');
  if (r.i) p.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"');
  if (r.u) p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
  if (r.s) p.push('style:text-line-through-style="solid"');
  if (r.color) p.push(`fo:color="${hex(r.color)}"`);
  if (r.size) p.push(`fo:font-size="${r.size}" style:font-size-asian="${r.size}" style:font-size-complex="${r.size}"`);
  if (r.font) p.push(`fo:font-family="${esc(r.font)}"`);
  if (r.bg) p.push(`fo:background-color="${hex(r.bg)}"`);
  if (r.pos) p.push(`style:text-position="${r.pos} 58%"`);
  return p.length ? c.st.add("T", "text", `<style:text-properties ${p.join(" ")}/>`) : "";
}

const cssHex = (v: string): string | undefined => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  const h = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim());
  if (h) return h[1].length === 3 ? h[1].split("").map((x) => x + x).join("") : h[1];
  return undefined;
};

/** Inline content as ODF runs. A link goes inside each styled span (LibreOffice drops spans nested in links). */
function inline(c: Ctx, node: Node, run: Run, href?: string): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      const t = (n.textContent || "").replace(/\s+/g, " ");
      if (!t) return;
      const text = esc(t).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
      const body = href ? `<text:a xlink:type="simple" xlink:href="${esc(href)}">${text}</text:a>` : text;
      const s = textStyle(c, run);
      out += s ? `<text:span text:style-name="${s}">${body}</text:span>` : body;
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      out += "<text:line-break/>";
      return;
    }
    if (tag === "ul" || tag === "ol") return;
    const r: Run = { ...run };
    if (tag === "strong" || tag === "b") r.b = true;
    if (tag === "em" || tag === "i") r.i = true;
    if (tag === "u") r.u = true;
    if (tag === "s" || tag === "strike" || tag === "del") r.s = true;
    if (tag === "sup") r.pos = "super";
    if (tag === "sub") r.pos = "sub";
    if (tag === "mark") r.bg = cssHex(el.style.backgroundColor || "") || "ffff00";
    const st = el.style;
    if (st) {
      if (st.color) r.color = cssHex(st.color) || r.color;
      if (st.fontSize) r.size = /pt$/.test(st.fontSize) ? st.fontSize : `${Math.round(parseFloat(st.fontSize) * 0.75 * 10) / 10}pt`;
      if (st.fontFamily) r.font = st.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      if (st.backgroundColor) r.bg = cssHex(st.backgroundColor) || r.bg;
      if (st.fontWeight === "bold" || Number(st.fontWeight) >= 600) r.b = true;
      if (st.fontStyle === "italic") r.i = true;
      if (/underline/.test(st.textDecoration || "")) r.u = true;
      if (/line-through/.test(st.textDecoration || "")) r.s = true;
    }
    out += inline(c, el, r, (tag === "a" && el.getAttribute("href")) || href);
  });
  return out;
}

function paraStyle(c: Ctx, align: string | undefined, extra = ""): string {
  // "left" is written out: placeholders would otherwise take the other application's default (a centred title)
  const a = align === "center" ? "center" : align === "right" ? "end" : align === "justify" ? "justify" : align === "left" ? "start" : "";
  if (!a && !extra) return "";
  return c.st.add("P", "paragraph", `<style:paragraph-properties${a ? ` fo:text-align="${a}"` : ""}${extra}/>`);
}

function para(c: Ctx, el: Element, base: Run, defaultAlign?: string): string {
  const align = (el as HTMLElement).style?.textAlign || defaultAlign;
  const ps = paraStyle(c, align);
  return `<text:p${ps ? ` text:style-name="${ps}"` : ""}>${inline(c, el, base)}</text:p>`;
}

/** `levels[k]`: the look of outline level k (0-based) over the level above's. */
function list(c: Ctx, el: Element, base: Run, level: number, defaultAlign?: string, levels?: Run[]): string {
  const ordered = el.tagName.toLowerCase() === "ol";
  const items = [...el.children].filter((x) => x.tagName.toLowerCase() === "li");
  const body = items
    .map((li) => {
      let inner = "";
      let loose = "";
      li.childNodes.forEach((n) => {
        if (n.nodeType === 1 && ["ul", "ol"].includes((n as Element).tagName.toLowerCase())) inner += list(c, n as Element, { ...base, ...(levels?.[level + 1] || {}) }, level + 1, defaultAlign, levels);
        else if (n.nodeType === 1 && (n as Element).tagName.toLowerCase() === "p") inner += para(c, n as Element, base, defaultAlign);
        else loose += n.nodeType === 3 ? esc(n.textContent || "") : n.nodeType === 1 ? inline(c, { childNodes: [n] } as unknown as Node, base) : "";
      });
      if (loose.trim()) inner = `<text:p>${loose}</text:p>${inner}`;
      return `<text:list-item>${inner || "<text:p/>"}</text:list-item>`;
    })
    .join("");
  return `<text:list${level === 0 ? ` text:style-name="${ordered ? "L2" : "L1"}"` : ""}>${body}</text:list>`;
}

/** Rich text HTML -> ODF paragraphs and lists. */
export function htmlToOdf(c: Ctx, html: string, base: Run = {}, defaultAlign?: string, levels?: Run[]): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let out = "";
  let loose: Node[] = [];
  const flush = () => {
    if (loose.length) {
      const wrap = doc.createElement("p");
      loose.forEach((n) => wrap.appendChild(n.cloneNode(true)));
      if ((wrap.textContent || "").trim()) out += para(c, wrap, base, defaultAlign);
      loose = [];
    }
  };
  doc.body.childNodes.forEach((n) => {
    const tag = n.nodeType === 1 ? (n as Element).tagName.toLowerCase() : "";
    if (tag === "p" || /^h[1-6]$/.test(tag) || tag === "div") {
      flush();
      out += para(c, n as Element, tag.startsWith("h") ? { ...base, b: true } : base, defaultAlign);
    } else if (tag === "ul" || tag === "ol") {
      flush();
      out += list(c, n as Element, base, 0, defaultAlign, levels);
    } else loose.push(n);
  });
  flush();
  return out;
}

const plainParas = (t: string) => t.split("\n").map((l) => `<text:p>${esc(l)}</text:p>`).join("");

// ---------------------------------------------------------------- geometry

/** svg:x/y/width/height, or the rotation transform PowerPoint-style rotations need. */
function frameGeom(e: { x: number; y: number; w: number; h: number; rot?: number }): string {
  const size = `svg:width="${cm(Math.max(0, e.w))}" svg:height="${cm(Math.max(0, e.h))}"`;
  if (!e.rot) return `${size} svg:x="${cm(e.x)}" svg:y="${cm(e.y)}"`;
  const t = (e.rot * Math.PI) / 180;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const tx = cx + (-e.w / 2) * Math.cos(t) - (-e.h / 2) * Math.sin(t);
  const ty = cy + (-e.w / 2) * Math.sin(t) + (-e.h / 2) * Math.cos(t);
  return `${size} draw:transform="rotate (${Math.round(-t * 1e6) / 1e6}) translate (${cm(tx)} ${cm(ty)})"`;
}

/** A path in a w x h box as an enhanced-path (absolute M L C Z N; quadratics as cubics). */
export function enhancedPath(d: string): string {
  const cmds = parseD(normalizePath(d));
  const out: string[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const r = (n: number) => String(Math.round(n * 100) / 100);
  for (const k of cmds) {
    const p = k.p;
    if (k.c === "M") { out.push(`M ${r(p[0])} ${r(p[1])}`); [cx, cy, sx, sy] = [p[0], p[1], p[0], p[1]]; }
    else if (k.c === "L") { out.push(`L ${r(p[0])} ${r(p[1])}`); [cx, cy] = [p[0], p[1]]; }
    else if (k.c === "C") { out.push(`C ${p.map(r).join(" ")}`); [cx, cy] = [p[4], p[5]]; }
    else if (k.c === "Q") {
      const c1 = [cx + (2 / 3) * (p[0] - cx), cy + (2 / 3) * (p[1] - cy)], c2 = [p[2] + (2 / 3) * (p[0] - p[2]), p[3] + (2 / 3) * (p[1] - p[3])];
      out.push(`C ${[...c1, ...c2, p[2], p[3]].map(r).join(" ")}`);
      [cx, cy] = [p[2], p[3]];
    } else if (k.c === "Z") { out.push("Z"); [cx, cy] = [sx, sy]; }
  }
  return `${out.join(" ")} N`;
}

function gradientName(c: Ctx, g: Gradient): string {
  const st = [...g.stops].sort((a, b) => a.pos - b.pos);
  const a = st[0]?.color || "FFFFFF", b = st[st.length - 1]?.color || a;
  // ODF angles turn counter-clockwise from "top to bottom"; OOXML's turn clockwise from "left to right"
  const angle = Math.round((((90 - g.angle) % 360) + 360) % 360) * 10;
  const key = `${g.kind}|${a}|${b}|${angle}`;
  let name = c.gradients.get(key);
  if (!name) {
    name = `Gradient_${c.gradients.size + 1}`;
    c.gradients.set(key, name);
  }
  return name;
}

function gradientDefs(c: Ctx): string {
  return [...c.gradients].map(([key, name]) => {
    const [kind, a, b, angle] = key.split("|");
    return kind === "radial"
      ? `<draw:gradient draw:name="${name}" draw:style="radial" draw:cx="50%" draw:cy="50%" draw:start-color="#${a.toLowerCase()}" draw:end-color="#${b.toLowerCase()}" draw:start-intensity="100%" draw:end-intensity="100%" draw:border="0%"/>`
      : `<draw:gradient draw:name="${name}" draw:style="linear" draw:start-color="#${a.toLowerCase()}" draw:end-color="#${b.toLowerCase()}" draw:start-intensity="100%" draw:end-intensity="100%" draw:angle="${angle}" draw:border="0%"/>`;
  }).join("");
}

type GraphicOpts = { cols?: number; colGap?: number; fill?: string | null; fillA?: number; grad?: Gradient; line?: string | null; lineW?: number; lineA?: number; shadow?: ShapeEl["shadow"]; valign?: "top" | "middle" | "bottom"; arrow?: boolean; text?: boolean; autogrow?: boolean; pad?: boolean };

/** A graphic style; placeholders (title, outline, subtitle) take the "presentation" family. */
function graphicStyle(c: Ctx, o: GraphicOpts, family: "graphic" | "presentation" = "graphic"): string {
  const p: string[] = [];
  if (o.grad && validGradient(o.grad)) p.push(`draw:fill="gradient" draw:fill-gradient-name="${gradientName(c, o.grad)}"`);
  else if (o.fill) p.push(`draw:fill="solid" draw:fill-color="${hex(o.fill)}"`);
  else p.push('draw:fill="none"');
  if ((o.fill || o.grad) && o.fillA !== undefined && o.fillA < 1) p.push(`draw:opacity="${Math.round(Math.max(0, o.fillA) * 100)}%"`);
  if (o.line) {
    p.push(`draw:stroke="solid" svg:stroke-color="${hex(o.line)}" svg:stroke-width="${cm(o.lineW ?? 1.33)}"`);
    if (o.lineA !== undefined && o.lineA < 1) p.push(`svg:stroke-opacity="${Math.round(o.lineA * 100)}%"`);
  } else p.push('draw:stroke="none"');
  if (o.arrow) p.push('draw:marker-end="Arrow" draw:marker-end-width="0.3cm"');
  if (o.shadow) {
    const t = (o.shadow.dir * Math.PI) / 180;
    p.push(`draw:shadow="visible" draw:shadow-offset-x="${cm(Math.cos(t) * o.shadow.dist)}" draw:shadow-offset-y="${cm(Math.sin(t) * o.shadow.dist)}" draw:shadow-color="${hex(o.shadow.color)}" draw:shadow-opacity="${Math.round(o.shadow.alpha * 100)}%"`);
  }
  if (o.text) {
    p.push(`draw:textarea-vertical-align="${o.valign === "middle" ? "middle" : o.valign === "bottom" ? "bottom" : "top"}"`);
    p.push(`draw:auto-grow-height="${o.autogrow ? "true" : "false"}"`);
    p.push(`fo:padding-top="${cm(4.8)}" fo:padding-bottom="${cm(4.8)}" fo:padding-left="${cm(9.6)}" fo:padding-right="${cm(9.6)}"`);
  }
  // text columns (LibreOffice 7.2+)
  const cols = o.cols && o.cols > 1 ? `<style:columns fo:column-count="${Math.min(16, Math.round(o.cols))}" fo:column-gap="${cm(o.colGap ?? 24)}"/>` : "";
  return c.st.add(family === "presentation" ? "pr" : "gr", family, cols ? `<style:graphic-properties ${p.join(" ")}>${cols}</style:graphic-properties>` : `<style:graphic-properties ${p.join(" ")}/>`);
}

const name = (id: string) => `syn-el-${id}`;

/** Presentation page layouts per slide layout: with them other applications treat the title and body as placeholders. */
const PAGE_LAYOUT: Partial<Record<Slide["layout"], string>> = { title: "AL1T0", content: "AL2T1", titleOnly: "AL3T19" };
function pageLayouts(W: number, H: number): string {
  const ph = (obj: string, b: { x: number; y: number; w: number; h: number } | undefined) =>
    b ? `<presentation:placeholder presentation:object="${obj}" svg:x="${cm(b.x)}" svg:y="${cm(b.y)}" svg:width="${cm(b.w)}" svg:height="${cm(b.h)}"/>` : "";
  return (Object.entries(PAGE_LAYOUT) as [Slide["layout"], string][])
    .map(([layout, nm]) => {
      const b = layoutBoxes(layout, W, H);
      return `<style:presentation-page-layout style:name="${nm}">${ph("title", b.title)}${layout === "title" ? ph("subtitle", b.body) : layout === "content" ? ph("outline", b.body) : ""}</style:presentation-page-layout>`;
    })
    .join("");
}

// ---------------------------------------------------------------- objects

const MEDIA_EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "weba", "video/x-ms-wmv": "wmv", "video/x-msvideo": "avi", "audio/x-ms-wma": "wma" };

const picture = (c: Ctx, src: string) => embed(c, src, "Pictures", "image/png");

/** A picture or media file in the package (fetched when it is a URL); its path, or null. */
async function embed(c: Ctx, src: string, folder: "Pictures" | "Media" | "Models", fallbackMime: string): Promise<string | null> {
  if (c.pics.has(src)) return c.pics.get(src)!;
  let bytes: Uint8Array | null = null;
  let mime = fallbackMime;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  try {
    if (m) {
      mime = m[1];
      bytes = m[2] ? Uint8Array.from(atob(m[3]), (ch) => ch.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    } else if (typeof fetch !== "undefined") {
      const r = await fetch(src, { credentials: "same-origin" });
      if (r.ok) {
        mime = (r.headers.get("content-type") || mime).split(";")[0];
        if (mime === "application/octet-stream") mime = fallbackMime;
        bytes = new Uint8Array(await r.arrayBuffer());
      }
    }
  } catch {
    bytes = null;
  }
  if (!bytes) return null;
  if (folder === "Models") mime = "model/gltf-binary";
  const ext = folder === "Models" ? "glb" : folder === "Media" ? MEDIA_EXT[mime] || "bin" : ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp", "image/bmp": "bmp" } as Record<string, string>)[mime] || "png";
  const path = `${folder}/${c.pics.size + 1}.${ext}`;
  c.zip.file(path, bytes);
  c.manifest.push(`<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${mime}"/>`);
  c.pics.set(src, path);
  return path;
}

function tableXml(c: Ctx, e: TableEl): string {
  const rows = styledRows(e, c.accent || "4472C4", c.textColor, c.bg);
  const n = gridCols(rows);
  const cw = fractions(e.colW, n).map((f) => f * e.w);
  const rh = fractions(e.rowH, rows.length).map((f) => f * e.h);
  const border = e.border || DEFAULT_BORDER;
  const side = (b: { c: string; w: number } | undefined) => (b ? (b.w > 0 ? `${cm(b.w)} solid ${hex(b.c)}` : "none") : `${cm(1)} solid ${hex(border)}`);
  const cols = cw.map((w) => `<table:table-column table:style-name="${c.st.add("co", "table-column", `<style:table-column-properties style:column-width="${cm(w)}"/>`)}"/>`).join("");
  const body = rows
    .map((row, r) => {
      const rs = c.st.add("ro", "table-row", `<style:table-row-properties style:row-height="${cm(rh[r])}"/>`);
      const cells = row
        .map((cell) => {
          if (cell.merged) return "<table:covered-table-cell/>";
          const props = [
            cell.fill ? `fo:background-color="${hex(cell.fill)}"` : 'fo:background-color="transparent"',
            `fo:border-top="${side(cell.bd?.t)}" fo:border-bottom="${side(cell.bd?.b)}" fo:border-left="${side(cell.bd?.l)}" fo:border-right="${side(cell.bd?.r)}"`,
            `style:vertical-align="${cell.valign === "middle" ? "middle" : cell.valign === "bottom" ? "bottom" : "top"}"`,
            `fo:padding="${cm(4.8)}"`,
          ].join(" ");
          const cs = c.st.add("ce", "table-cell", `<style:table-cell-properties ${props}/>`);
          const span = `${(cell.cs || 1) > 1 ? ` table:number-columns-spanned="${cell.cs}"` : ""}${(cell.rs || 1) > 1 ? ` table:number-rows-spanned="${cell.rs}"` : ""}`;
          const base: Run = { ...(cell.bold ? { b: true } : {}), ...(cell.color ? { color: cell.color } : {}), size: pt(e.fontSize || 14) };
          const content = htmlToOdf(c, cellHtml(cell), base, cell.align) || "<text:p/>";
          return `<table:table-cell table:style-name="${cs}"${span} office:value-type="string">${content}</table:table-cell>`;
        })
        .join("");
      return `<table:table-row table:style-name="${rs}">${cells}</table:table-row>`;
    })
    .join("");
  return `<table:table>${cols}${body}</table:table>`;
}

const CHART_CLASS: Record<ChartEl["chartType"], string> = { bar: "chart:bar", line: "chart:line", area: "chart:area", pie: "chart:circle", doughnut: "chart:ring", scatter: "chart:scatter" };

function colLetter(i: number): string {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/**
 * An Excel-style number format code (its first section) as an ODF number
 * style: literal text, thousands grouping, decimals, a /1000 scale, percent
 * and scientific notation. Undefined for General or a code we cannot express.
 */
export function odfNumberStyle(name: string, code: string | undefined): string | undefined {
  if (!code || code === "General") return undefined;
  // the first section, without colour/condition brackets; [$€-407] is a currency symbol
  let sec = "";
  for (let i = 0, q = false; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') q = !q;
    if (ch === ";" && !q) break;
    sec += ch;
  }
  sec = sec.replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, (_, sym) => `"${sym}"`).replace(/\[[^\]]*\]/g, "");
  const parts: { text?: string; num?: string }[] = [];
  const re = /"([^"]*)"|\\(.)|([#0?,.]+(?:E[+-]0+)?)|(.)/g;
  for (let m; (m = re.exec(sec)); ) {
    const lit = m[1] ?? m[2] ?? m[4];
    if (lit !== undefined) {
      const last = parts[parts.length - 1];
      if (last?.text !== undefined) last.text += lit;
      else parts.push({ text: lit });
    } else if (/[0#]/.test(m[3])) parts.push({ num: m[3] });
    else parts.push({ text: m[3] });
  }
  const nums = parts.filter((p) => p.num);
  if (nums.length !== 1) return undefined;
  const pat = nums[0].num!;
  const sci = /E[+-](0+)$/.exec(pat);
  const body = pat.replace(/E[+-]0+$/, "");
  const scale = /,+$/.exec(body)?.[0].length || 0;
  const core = body.replace(/,+$/, "");
  const [int, dec = ""] = core.split(".");
  const minInt = (int.match(/0/g) || []).length;
  const minDec = (dec.match(/0/g) || []).length;
  const decs = (dec.match(/[0#]/g) || []).length;
  const percent = parts.some((p) => p.text?.includes("%"));
  const numEl = sci
    ? `<number:scientific-number number:decimal-places="${decs}" number:min-integer-digits="${Math.max(1, minInt)}" number:min-exponent-digits="${sci[1].length}"/>`
    : `<number:number number:decimal-places="${decs}" number:min-decimal-places="${minDec}" number:min-integer-digits="${minInt}"${int.includes(",") ? ' number:grouping="true"' : ""}${scale ? ` number:display-factor="${1000 ** scale}"` : ""}/>`;
  const inner = parts.map((p) => (p.num ? numEl : `<number:text>${esc(p.text!)}</number:text>`)).join("");
  return `<number:${percent ? "percentage" : "number"}-style style:name="${name}">${inner}</number:${percent ? "percentage" : "number"}-style>`;
}

/** An ODF chart document for a chart element (with its data as the chart's local table). */
export function chartDoc(e: ChartEl, font: string): string {
  const round = e.chartType === "pie" || e.chartType === "doughnut";
  const series = round ? e.series.slice(0, 1) : e.series;
  const n = e.categories.length;
  const styles: string[] = [];
  const style = (nm: string, inner: string, dataStyle?: string) => {
    styles.push(`<style:style style:name="${nm}" style:family="chart"${dataStyle ? ` style:data-style-name="${dataStyle}"` : ""}>${inner}</style:style>`);
    return nm;
  };
  // axis number formats: a number style each (unlinked from the data's own format)
  const numStyle = (nm: string, code: string | undefined) => {
    const xml = odfNumberStyle(nm, code);
    if (!xml) return undefined;
    styles.push(xml);
    return nm;
  };
  const plotProps = [
    e.chartType === "bar" && e.barDir === "bar" ? 'chart:vertical="true"' : "",
    e.stacked && !round && e.chartType !== "scatter" ? (e.percent ? 'chart:percentage="true"' : 'chart:stacked="true"') : "",
    e.dataLabels ? 'chart:data-label-number="value"' : "",
    e.chartType === "line" ? 'chart:symbol-type="automatic"' : "",
    e.chartType === "scatter" ? 'chart:symbol-type="automatic"' : "",
  ].filter(Boolean).join(" ");
  style("plot", `<style:chart-properties ${plotProps} chart:right-angled-axes="true"/>`);
  const v = e.valAx || {};
  const axProps = (a: typeof v) => [a.min !== undefined ? `chart:minimum="${a.min}" chart:auto-minimum="false"` : "", a.max !== undefined ? `chart:maximum="${a.max}" chart:auto-maximum="false"` : "", a.major ? `chart:interval-major="${a.major}"` : "", a.minor && a.major ? `chart:interval-minor-divisor="${Math.max(1, Math.round(a.major / a.minor))}"` : "", 'chart:display-label="true"'].filter(Boolean).join(" ");
  const yFmt = numStyle("Ny", v.fmt);
  const xFmt = e.chartType === "scatter" ? numStyle("Nx", e.catAx?.fmt) : undefined;
  const unlink = (f: string | undefined) => (f ? ' chart:link-data-style-to-source="false"' : "");
  style("axy", `<style:chart-properties ${axProps(v)}${unlink(yFmt)}/><style:text-properties fo:font-size="10pt"/>`, yFmt);
  style("axx", `<style:chart-properties ${e.chartType === "scatter" ? axProps(e.catAx || {}) : 'chart:display-label="true"'}${unlink(xFmt)}/><style:text-properties fo:font-size="10pt"/>`, xFmt);
  const serStyles = series.map((s, i) => {
    const col = /^[0-9a-f]{6}$/i.test(s.color || "") ? s.color! : CHART_COLORS[i % CHART_COLORS.length];
    const line = e.chartType === "line" || e.chartType === "scatter";
    return style(`ser${i}`, `<style:chart-properties${e.dataLabels ? ' chart:data-label-number="value"' : ""}${e.chartType === "scatter" ? ' chart:symbol-type="automatic"' : ""}/><style:graphic-properties draw:fill="solid" draw:fill-color="${hex(col)}" svg:stroke-color="${hex(col)}"${line ? ' svg:stroke-width="0.08cm"' : ""}${e.chartType === "scatter" ? ' draw:stroke="none"' : ""}/>`);
  });
  const trendStyles = series.map((s, i) => (s.trend ? style(`tr${i}`, `<style:chart-properties chart:regression-type="${s.trend.type === "poly" ? "polynomial" : s.trend.type === "exp" ? "exponential" : s.trend.type === "log" ? "logarithmic" : s.trend.type === "movingAvg" ? "moving-average" : s.trend.type}"${s.trend.type === "poly" ? ` chart:regression-max-degree="${s.trend.order || 2}"` : ""}${s.trend.type === "movingAvg" ? ` chart:regression-period="${s.trend.period || 2}"` : ""}/>`) : ""));
  const last = n + 1;
  const tableRows = [
    `<table:table-header-rows><table:table-row><table:table-cell><text:p/></table:table-cell>${series.map((s) => `<table:table-cell office:value-type="string"><text:p>${esc(s.name)}</text:p></table:table-cell>`).join("")}</table:table-row></table:table-header-rows>`,
    `<table:table-rows>${e.categories
      .map((cat, r) => {
        const x = e.chartType === "scatter" && Number.isFinite(Number(cat)) ? `<table:table-cell office:value-type="float" office:value="${Number(cat)}"><text:p>${esc(cat)}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${esc(cat)}</text:p></table:table-cell>`;
        return `<table:table-row>${x}${series.map((s) => `<table:table-cell office:value-type="float" office:value="${Number.isFinite(s.values[r]) ? s.values[r] : 0}"><text:p>${Number.isFinite(s.values[r]) ? s.values[r] : 0}</text:p></table:table-cell>`).join("")}</table:table-row>`;
      })
      .join("")}</table:table-rows>`,
  ].join("");
  const range = (col: number, r0: number, r1: number) => `local-table.$${colLetter(col)}$${r0}:.$${colLetter(col)}$${r1}`;
  const legendPos = ({ b: "bottom", t: "top", r: "end", l: "start" } as const)[e.legendPos || "b"];
  const title = (t: string | undefined) => (t ? `<chart:title><text:p>${esc(t)}</text:p></chart:title>` : "");
  const seriesXml = series
    .map((s, i) => {
      const domain = e.chartType === "scatter" ? `<chart:domain table:cell-range-address="${range(0, 2, last)}"/>` : "";
      const t = s.trend;
      const eq = t && (t.eq || t.r2) ? `<chart:equation chart:display-equation="${t.eq ? "true" : "false"}" chart:display-r-square="${t.r2 ? "true" : "false"}"/>` : "";
      const trend = trendStyles[i] ? `<chart:regression-curve chart:style-name="${trendStyles[i]}">${eq}</chart:regression-curve>` : "";
      // combo charts: each series' own class, and the secondary axis
      const cls = CHART_CLASS[seriesType(e, s)];
      return `<chart:series chart:style-name="${serStyles[i]}" chart:class="${cls}"${s.y2 && !round ? ' chart:attached-axis="secondary-y"' : ""} chart:values-cell-range-address="${range(i + 1, 2, last)}" chart:label-cell-address="local-table.$${colLetter(i + 1)}$1">${domain}${trend}${round ? e.categories.map((_, k) => `<chart:data-point chart:style-name="${style(`pt${k}`, `<style:graphic-properties draw:fill="solid" draw:fill-color="${hex(CHART_COLORS[k % CHART_COLORS.length])}"/>`)}"/>`).join("") : ""}</chart:series>`;
    })
    .join("");
  const axes = round
    ? ""
    : `<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="axx"${e.chartType === "scatter" && e.catAx?.fmt ? ` syn:fmt="${esc(e.catAx.fmt)}"` : ""}>${title(e.catAx?.title)}${e.chartType === "scatter" ? "" : `<chart:categories table:cell-range-address="${range(0, 2, last)}"/>`}${e.catAx?.grid ? '<chart:grid chart:class="major"/>' : ""}</chart:axis><chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="axy"${v.fmt ? ` syn:fmt="${esc(v.fmt)}"` : ""}>${title(v.title)}${v.grid !== false ? '<chart:grid chart:class="major"/>' : ""}${v.minorGrid ? '<chart:grid chart:class="minor"/>' : ""}</chart:axis>${series.some((s) => s.y2) ? '<chart:axis chart:dimension="y" chart:name="secondary-y" chart:style-name="axy"/>' : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2"><office:automatic-styles>${styles.join("")}</office:automatic-styles><office:body><office:chart><chart:chart svg:width="${cm(e.w)}" svg:height="${cm(e.h)}" chart:class="${CHART_CLASS[e.chartType]}">${title(e.title)}${e.showLegend !== false ? `<chart:legend chart:legend-position="${legendPos}"/>` : ""}<chart:plot-area chart:style-name="plot" table:cell-range-address="local-table.$A$1:.$${colLetter(series.length)}$${last}" chart:data-source-has-labels="both">${axes}${seriesXml}</chart:plot-area><table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column table:number-columns-repeated="${series.length}"/></table:table-columns>${tableRows}</table:table></chart:chart></office:chart></office:body></office:document-content>`.replace(/font-family="[^"]*"/g, `font-family="${esc(font)}"`);
}

function embedObject(c: Ctx, kind: "chart" | "formula", content: string): string {
  const dir = `Object ${++c.objects}`;
  c.zip.file(`${dir}/content.xml`, content);
  c.manifest.push(`<manifest:file-entry manifest:full-path="${dir}/" manifest:media-type="application/vnd.oasis.opendocument.${kind}"/>`);
  c.manifest.push(`<manifest:file-entry manifest:full-path="${dir}/content.xml" manifest:media-type="text/xml"/>`);
  return `<draw:object xlink:href="./${dir}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`;
}

function mathDoc(e: MathEl): string {
  const mml = latexToMathml(e.latex).replace(/^<math[^>]*>/, "").replace(/<\/math>$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow>${mml}</mrow><annotation encoding="application/x-tex">${esc(e.latex)}</annotation></semantics></math>`;
}

/** What ODF has no place for (animations, picture crop), kept for our own importer. */
function extras(e: SlideElement): string {
  const j = extrasJson(e);
  return j ? ` syn:x="${esc(j)}"` : "";
}
function extrasJson(e: SlideElement): string {
  const x: Record<string, unknown> = {};
  if (e.anim) x.anim = e.anim;
  if (e.fx?.length) x.fx = e.fx;
  if (e.type === "image" && e.crop) x.crop = e.crop;
  if ((e.type === "text" || e.type === "shape") && e.wa) x.wa = e.wa;
  if ((e.type === "text" || e.type === "shape") && e.warp) x.warp = e.warp;
  if ((e.type === "text" || e.type === "shape") && e.cols && e.cols > 1) Object.assign(x, { cols: e.cols, ...(e.colGap !== undefined ? { colGap: e.colGap } : {}) });
  if (e.alt && e.type !== "image") x.alt = e.alt;
  if (e.deco) x.deco = true;
  if (e.slot) x.slot = e.slot;
  if (e.ph) x.ph = e.ph;
  return Object.keys(x).length ? JSON.stringify(x) : "";
}

const ODF_SLOT: Record<SlotKind, string> = { obj: "object", text: "text", pic: "graphic", chart: "chart", tbl: "table", media: "object", dgm: "orgchart" };

async function elementXml(c: Ctx, e: SlideElement, layer?: "master" | "layout"): Promise<string> {
  const id = ` draw:name="${name(e.id)}"${extras(e)}${layer ? ` syn:layer="${layer}"` : ""}`;
  if (e.type === "text") {
    const t = e as TextEl;
    const gs = graphicStyle(c, { text: true, valign: t.valign, autogrow: t.autofit === "resize", cols: t.cols, colGap: t.colGap });
    // a layout placeholder slot: an ODF presentation placeholder of its class, holding its prompt
    const slot = t.slot ? ` presentation:class="${ODF_SLOT[t.slot]}" presentation:placeholder="true" presentation:user-transformed="true"` : "";
    return `<draw:frame draw:style-name="${gs}"${id}${slot} ${frameGeom(e)}${t.autofit === "shrink" ? ' syn:autofit="shrink"' : ""}><draw:text-box>${htmlToOdf(c, t.html, { color: c.textColor, size: "18pt" }) || "<text:p/>"}</draw:text-box></draw:frame>`;
  }
  if (e.type === "image") {
    // other applications get the cropped picture; ours reads the whole one (syn:x orig) and its crop back
    const cut = e.crop ? await croppedPicture(e.src, e.crop) : null;
    const whole = await picture(c, e.src);
    const href = cut ? await picture(c, cut) : whole;
    if (!href) return "";
    if (e.crop && !cut) c.warnings.add("Picture crops were exported uncropped.");
    const xj = extrasJson(e);
    const x = cut && whole ? JSON.stringify({ ...(xj ? JSON.parse(xj) : {}), orig: whole }) : xj;
    const id = ` draw:name="${name(e.id)}"${x ? ` syn:x="${esc(x)}"` : ""}${layer ? ` syn:layer="${layer}"` : ""}`;
    const gs = graphicStyle(c, { shadow: e.shadow });
    return `<draw:frame draw:style-name="${gs}"${id} ${frameGeom(e)}><draw:image xlink:href="${href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${e.alt ? `<svg:desc>${esc(e.alt)}</svg:desc>` : ""}</draw:frame>`;
  }
  if (e.type === "table") {
    const gs = graphicStyle(c, {});
    return `<draw:frame draw:style-name="${gs}"${id} ${frameGeom(e)}>${tableXml(c, e)}</draw:frame>`;
  }
  if (e.type === "chart") {
    const gs = graphicStyle(c, {});
    return `<draw:frame draw:style-name="${gs}"${id} ${frameGeom(e)}>${embedObject(c, "chart", chartDoc(e, c.font))}</draw:frame>`;
  }
  if (e.type === "math") {
    const gs = graphicStyle(c, {});
    return `<draw:frame draw:style-name="${gs}"${id} ${frameGeom(e)} syn:math-size="${e.size || 28}"${e.color ? ` syn:math-color="${e.color}"` : ""}>${embedObject(c, "formula", mathDoc(e))}</draw:frame>`;
  }
  if (e.type === "zoom") {
    // a picture that jumps to the slide (LibreOffice's click action); the zoom itself rides in syn:zoom
    const href = await picture(c, ZOOM_PLACEHOLDER);
    const target = c.pageNames?.get(e.target);
    const click = target ? `<office:event-listeners><presentation:event-listener script:event-name="dom:click" presentation:action="show" xlink:href="#${esc(target)}" xlink:type="simple"/></office:event-listeners>` : "";
    const zoom = ` syn:zoom="${esc(JSON.stringify({ kind: e.kind, target: e.target, ...(e.ret ? { ret: true } : {}), ...(e.border === false ? { border: false } : {}) }))}"`;
    return `<draw:frame${id}${zoom} ${frameGeom(e)}>${href ? `<draw:image xlink:href="${href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` : ""}${click}</draw:frame>`;
  }
  if (e.type === "model3d") {
    // ODF has no 3D models: the picture of the model, with the model file kept in the package (syn:model3d)
    const poster = await picture(c, e.poster || ZOOM_PLACEHOLDER);
    const file = await embed(c, e.src, "Models", "model/gltf-binary");
    if (!file) c.warnings.add("Some 3D models could not be read and were kept as pictures.");
    const info = file ? ` syn:model3d="${esc(JSON.stringify({ file, ...(e.rx ? { rx: e.rx } : {}), ...(e.ry ? { ry: e.ry } : {}), ...(e.rz ? { rz: e.rz } : {}), ...(e.name ? { name: e.name } : {}) }))}"` : "";
    return `<draw:frame${id}${info} ${frameGeom(e)}>${poster ? `<draw:image xlink:href="${poster}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` : ""}${e.alt && !e.deco ? `<svg:desc>${esc(e.alt)}</svg:desc>` : ""}</draw:frame>`;
  }
  if (e.type === "media") {
    // embedded as a plug-in (how ODF applications keep audio and video), with its poster as the picture shown
    const file = await embed(c, e.src, "Media", e.mime || (e.kind === "audio" ? "audio/mpeg" : "video/mp4"));
    const poster = e.poster ? await picture(c, e.poster) : null;
    const img = poster ? `<draw:image xlink:href="${poster}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` : "";
    if (!file) {
      c.warnings.add("Some audio or video could not be read and was left out (its poster picture is kept).");
      return img ? `<draw:frame${id} ${frameGeom(e)}>${img}</draw:frame>` : "";
    }
    const mime = /Media\/\d+\.(\w+)$/.exec(file)?.[1];
    const type = Object.entries(MEDIA_EXT).find(([, x]) => x === mime)?.[0] || e.mime || "";
    const media = ` syn:media="${esc(JSON.stringify({ kind: e.kind, ...(e.autoplay ? { autoplay: true } : {}), ...(e.name ? { name: e.name } : {}) }))}"`;
    return `<draw:frame${id}${media} ${frameGeom(e)}><draw:plugin xlink:href="${file}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${esc(type)}"><draw:param draw:name="Loop" draw:value="${e.loop ? "true" : "false"}"/><draw:param draw:name="Mute" draw:value="false"/></draw:plugin>${img}</draw:frame>`;
  }
  // shapes
  const s = e as ShapeEl;
  const text = s.html ? htmlToOdf(c, s.html, { color: c.textColor, size: "18pt" }, "center") : "";
  const line = isLineShape(s.shape);
  const gs = graphicStyle(c, { cols: s.cols, colGap: s.colGap, fillA: s.fillA, fill: line ? null : s.fill, grad: line ? undefined : s.grad, line: s.line ?? (line ? "000000" : null), lineW: s.lineW, lineA: s.lineA, shadow: s.shadow, valign: s.valign || "middle", text: !line, arrow: s.shape === "lineArrow" });
  const syn = ` syn:shape="${esc(s.shape)}"`;
  if (line) {
    // a line runs corner to corner of its box; flips swap the ends
    const [x1, x2] = s.flipH ? [s.x + s.w, s.x] : [s.x, s.x + s.w];
    const [y1, y2] = s.flipV ? [s.y + s.h, s.y] : [s.y, s.y + s.h];
    return `<draw:line draw:style-name="${gs}"${id}${syn} svg:x1="${cm(x1)}" svg:y1="${cm(y1)}" svg:x2="${cm(x2)}" svg:y2="${cm(y2)}"><text:p/></draw:line>`;
  }
  if (s.shape === "rect" && !s.flipH && !s.flipV) return `<draw:rect draw:style-name="${gs}"${id}${syn} ${frameGeom(s)}>${text}</draw:rect>`;
  if (s.shape === "ellipse") return `<draw:ellipse draw:style-name="${gs}"${id}${syn} ${frameGeom(s)}>${text}</draw:ellipse>`;
  const W = Math.max(1, Math.round(s.w)), H = Math.max(1, Math.round(s.h));
  const d = s.shape === "freeform" && s.geom ? scaledD(s.geom, W, H) : shapePath(s.shape, W, H);
  const geomAttr = s.shape === "freeform" && s.geom ? ` syn:geom="${esc(JSON.stringify(s.geom))}"` : "";
  const mirror = `${s.flipH ? ' draw:mirror-horizontal="true"' : ""}${s.flipV ? ' draw:mirror-vertical="true"' : ""}`;
  return `<draw:custom-shape draw:style-name="${gs}"${id}${syn}${geomAttr} ${frameGeom(s)}>${text}<draw:enhanced-geometry svg:viewBox="0 0 ${W} ${H}" draw:type="non-primitive"${mirror} draw:enhanced-path="${enhancedPath(d)}"/></draw:custom-shape>`;
}

async function pageElements(c: Ctx, els: SlideElement[], layer?: "master" | "layout", depth = 0): Promise<string> {
  const sorted = [...els].sort((a, b) => a.z - b.z);
  let out = "";
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const g = groupPath(e)[depth];
    if (g) {
      // a group (and the groups inside it) as nested draw:g
      const members: SlideElement[] = [];
      while (i < sorted.length && groupPath(sorted[i])[depth] === g) members.push(sorted[i++]);
      i--;
      const inner = await pageElements(c, members, undefined, depth + 1);
      out += `<draw:g syn:group="${esc(g)}"${layer ? ` syn:layer="${layer}"` : ""}>${inner}</draw:g>`;
    } else out += await elementXml(c, e, layer);
  }
  return out;
}

/** The slide's own settings that ODF has no place for (layout choice, placeholder overrides, transition, effects), for our importer. */
const SLIDE_PROPS = ["layout", "clayout", "hideUnder", "tbox", "bbox", "tstyle", "bstyle", "bodyValign", "bodyFit", "trans", "tanim", "banim", "tfx", "bfx", "thtml"] as const;
function slideProps(s: Slide): string {
  const o: Record<string, unknown> = {};
  for (const k of SLIDE_PROPS) if (s[k] !== undefined && s[k] !== "") o[k] = s[k];
  // the page background is written resolved; this says whether it is the slide's own
  if (s.bg || s.bgImg || s.bgGrad) o.ownBg = true;
  return ` syn:props="${esc(JSON.stringify(o))}"`;
}

/** Build the .odp package. */
export async function buildOdp(slides: Slide[], deck: OdpDeck): Promise<{ data: Uint8Array; warnings: string[] }> {
  const zip = new JSZip();
  zip.file("mimetype", ODP_MIME, { compression: "STORE" });
  const theme = effectiveTheme(deck.theme, deck.colors);
  const font = deck.font || theme.font.split(",")[0].replace(/['"]/g, "").trim();
  const headFont = deck.headFont || font;
  const c: Ctx = { st: new Styles(), zip, pics: new Map(), manifest: [], gradients: new Map(), objects: 0, textColor: theme.text, accent: theme.accent, bg: theme.bg, font, warnings: new Set() };
  const pages: string[] = [];
  // one master page per layout in use, holding the slide master's and the layout's objects
  // (in styles.xml, with styles of its own)
  const mc: Ctx = { ...c, st: new Styles("M") };
  const masterPages = new Map<string, string>();
  const masterPage = async (raw: Slide): Promise<string> => {
    const key = deck.masters ? layoutKeyOf(raw, deck.masters) : raw.layout;
    const nm = `syn-m-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    if (masterPages.has(nm)) return nm;
    masterPages.set(nm, "");
    const L = deck.masters?.[key];
    const M = masterFor(key, deck.masters);
    mc.objects = c.objects; // embedded objects are numbered across both files
    let objs = "";
    if (theme.bar) objs += `<draw:rect draw:style-name="${graphicStyle(mc, { fill: theme.accent })}" draw:name="syn-bar" svg:x="0cm" svg:y="0cm" svg:width="${cm(deck.w)}" svg:height="${cm(8)}"/>`;
    if (!L?.hideUnder && M?.elements.length) objs += await pageElements(mc, M.elements, "master");
    if (L && L !== M && L.elements.length) objs += await pageElements(mc, L.elements, "layout");
    c.objects = mc.objects;
    masterPages.set(nm, `<style:master-page style:name="${nm}" syn:key="${esc(key)}" style:page-layout-name="PM1" draw:style-name="Mdp1">${objs}</style:master-page>`);
    return nm;
  };
  const names = slides.map((x, i) => pageName(x, i));
  c.pageNames = new Map(slides.flatMap((x, i) => (names.indexOf(names[i]) === names.lastIndexOf(names[i]) ? [[x.id, names[i]] as [string, string]] : [])));
  for (const [i, raw] of slides.entries()) {
    const s = applyMaster(raw, deck.masters, i + 1);
    const mpName = await masterPage(raw);
    // the page background: gradient, picture or colour (the slide's own, else its layout's, else the theme's)
    let bg: string;
    if (s.bgGrad && validGradient(s.bgGrad)) bg = `draw:fill="gradient" draw:fill-gradient-name="${gradientName(c, s.bgGrad)}"`;
    else if (s.bgImg) {
      const href = await picture(c, s.bgImg);
      if (href) {
        const nm = `Bitmap_${c.pics.size}`;
        c.gradients.set(`img|${nm}|${href}`, nm);
        bg = `draw:fill="bitmap" draw:fill-image-name="${nm}" style:repeat="stretch"`;
      } else bg = `draw:fill="solid" draw:fill-color="${hex(s.bg || theme.bg)}"`;
    } else bg = `draw:fill="solid" draw:fill-color="${hex(s.bg || theme.bg)}"`;
    const dp = c.st.add("dp", "drawing-page", `<style:drawing-page-properties ${bg} presentation:background-visible="true" presentation:background-objects-visible="${raw.hideUnder ? "false" : "true"}"${s.hidden ? ' presentation:visibility="hidden"' : ""}${s.trans?.advAfter ? ` presentation:transition-type="automatic" presentation:duration="PT${(s.trans.advAfter / 1000).toFixed(3)}S"` : ""}/>`);
    let body = "";
    // the master's and layout's objects are on the master page; objects sent behind the placeholders come first
    body += await pageElements(c, s.elements.filter((e) => e.z < 0));
    const tb = titleBox(s, deck.w, deck.h);
    if (tb && s.title) {
      const ts = s.tstyle || {};
      const run: Run = { size: pt(titlePt(s)), color: ts.color || theme.title, font: ts.font || headFont, ...(ts.bold === false ? {} : { b: true }) };
      const ps = paraStyle(c, ts.align || (s.layout === "title" ? "center" : "left"));
      const tp = s.title.split("\n").map((l) => `<text:p${ps ? ` text:style-name="${ps}"` : ""}>${l ? `<text:span text:style-name="${textStyle(c, run)}">${esc(l)}</text:span>` : ""}</text:p>`).join("");
      const gs = graphicStyle(c, { text: true, valign: s.layout === "title" ? "bottom" : "middle" }, "presentation");
      body += `<draw:frame presentation:class="title" presentation:style-name="${gs}" draw:layer="layout" presentation:user-transformed="true" draw:name="syn-title" ${frameGeom(tb)}><draw:text-box>${tp}</draw:text-box></draw:frame>`;
    }
    const bb = bodyBox(s, deck.w, deck.h);
    if (bb && s.body && s.body.replace(/<[^>]+>/g, "").trim()) {
      const bs = s.bstyle || {};
      const gs = graphicStyle(c, { text: true, valign: s.bodyValign || "top" }, "presentation");
      const cls = s.layout === "title" ? "subtitle" : "outline";
      body += `<draw:frame presentation:class="${cls}" presentation:style-name="${gs}" draw:layer="layout" presentation:user-transformed="true" draw:name="syn-body" ${frameGeom(bb)}${s.bodyFit === "none" ? "" : ' syn:autofit="shrink"'}><draw:text-box>${htmlToOdf(c, toHtml(s.body), { size: pt(bodyPt(s)), color: bs.color || theme.text, font: bs.font || font }, s.layout === "title" ? "center" : undefined, [{}, ...(bs.lv || []).map((l): Run => ({ ...(l?.size ? { size: pt(l.size) } : {}), ...(l?.color ? { color: l.color } : {}), ...(l?.font ? { font: l.font } : {}) }))])}</draw:text-box></draw:frame>`;
    }
    body += await pageElements(c, s.elements.filter((e) => e.z >= 0));
    // the animations as ODF SMIL, for other applications (ours reads syn:x)
    const hasTitle = !!(tb && s.title), hasBody = body.includes('draw:name="syn-body"');
    const smil = smilXml(s, (k) => (k === "title" ? hasTitle : k === "body" ? hasBody : s.elements.some((e) => e.id === k)));
    if (smil.xml) body = addAnimIds(body, smil.targets) + smil.xml;
    // a presentation style marks the frame as the notes placeholder for other applications
    const notesStyle = c.st.add("pr", "presentation", '<style:graphic-properties draw:fill="none" draw:stroke="none"/>');
    const notes = s.notes.trim()
      ? `<presentation:notes><draw:page-thumbnail presentation:class="page" svg:x="2cm" svg:y="2cm" svg:width="17cm" svg:height="${(17 * deck.h) / deck.w}cm" draw:page-number="${i + 1}"/><draw:frame presentation:style-name="${notesStyle}" draw:layer="layout" presentation:class="notes" presentation:user-transformed="true" svg:x="2cm" svg:y="${3 + (17 * deck.h) / deck.w}cm" svg:width="17cm" svg:height="10cm"><draw:text-box>${plainParas(s.notes)}</draw:text-box></draw:frame></presentation:notes>`
      : "";
    pages.push(`<draw:page draw:name="${esc(pageName(s, i))}" draw:style-name="${dp}" draw:master-page-name="${mpName}"${PAGE_LAYOUT[s.layout] ? ` presentation:presentation-page-layout-name="${PAGE_LAYOUT[s.layout]}"` : ""}${s.sec ? ` syn:section="${esc(s.sec)}"` : ""} syn:id="${esc(raw.id)}"${slideProps(raw)}>${body}${notes}</draw:page>`);
  }
  // custom layouts no slide uses keep their objects (and an added master's) on master pages of their own
  for (const [k, L] of Object.entries(deck.masters || {})) if (isCustomKey(k) && L) await masterPage({ ...L, id: "", clayout: k.slice(2) });
  const lists = `<text:list-style style:name="L1">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<text:list-level-style-bullet text:level="${l}" text:bullet-char="${l % 2 ? "•" : "–"}"><style:list-level-properties text:space-before="${(l - 1) * 0.8}cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet>`).join("")}</text:list-style><text:list-style style:name="L2">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<text:list-level-style-number text:level="${l}" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="${(l - 1) * 0.8}cm" text:min-label-width="0.6cm"/></text:list-level-style-number>`).join("")}</text:list-style>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2"><office:automatic-styles>${c.st.list.join("")}${lists}</office:automatic-styles><office:body><office:presentation>${pages.join("")}</office:presentation></office:body></office:document-content>`;
  const fills = [...c.gradients].filter(([k]) => k.startsWith("img|")).map(([k, nm]) => `<draw:fill-image draw:name="${nm}" xlink:href="${esc(k.split("|")[2])}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`).join("");
  for (const k of [...c.gradients.keys()]) if (k.startsWith("img|")) c.gradients.delete(k);
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.2"><office:styles>${gradientDefs(c)}${fills}<draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0l-10 30h20z"/><style:default-style style:family="graphic"><style:graphic-properties draw:fill-color="#4472c4" svg:stroke-color="#2f528f"/><style:paragraph-properties fo:text-align="start"/><style:text-properties fo:font-family="${esc(font)}" fo:font-size="18pt" fo:color="${hex(theme.text)}"/></style:default-style><style:style style:name="standard" style:family="graphic"/>${pageLayouts(deck.w, deck.h)}</office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${cm(deck.w)}" fo:page-height="${cm(deck.h)}" style:print-orientation="${deck.w >= deck.h ? "landscape" : "portrait"}"/></style:page-layout><style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="${hex(theme.bg)}"/></style:style>${mc.st.list.join("")}${lists}</office:automatic-styles><office:master-styles>${masterPages.size ? [...masterPages.values()].join("") : '<style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1"/>'}</office:master-styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.2"><office:meta><meta:generator>Synergy Office</meta:generator><dc:title>${esc(deck.name)}</dc:title><meta:user-defined meta:name="SynergyTheme">${esc(deck.theme)}</meta:user-defined>${deck.colors ? `<meta:user-defined meta:name="SynergyColors">${esc(JSON.stringify(deck.colors))}</meta:user-defined>` : ""}${[["SynergyFont", deck.font], ["SynergyHeadFont", deck.headFont], ["SynergyHF", deck.hf && JSON.stringify(deck.hf)], ["SynergyMasters", mastersProp(deck.masters)]].map(([k, v]) => (v ? `<meta:user-defined meta:name="${k}">${esc(v)}</meta:user-defined>` : "")).join("")}</office:meta></office:document-meta>`;
  zip.file("content.xml", content);
  zip.file("styles.xml", styles);
  zip.file("meta.xml", meta);
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODP_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${c.manifest.join("")}</manifest:manifest>`,
  );
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: ODP_MIME });
  return { data, warnings: [...c.warnings] };
}
