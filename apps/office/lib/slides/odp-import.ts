// OpenDocument Presentation (.odp) import: pages, title/outline/subtitle
// placeholders, text boxes with rich text and lists, rectangles, ellipses,
// lines, paths, polygons and custom shapes (preset types, or their path when
// it has no formulas), pictures, tables (spans, fills, borders), groups,
// charts and formulas (embedded objects), backgrounds, hidden pages and
// speaker notes. Styles are resolved through their parent chains and the
// default styles, as in LibreOffice and other ODF writers.
import { validWarp } from "./warp";
import JSZip from "jszip";
import { parseXml, child, kids, descendants, type XEl } from "./xml";
import { cleanHf, cleanLevels, masterKeyOf, genId, escapeHtml, masterLayout, type MasterKey, type Masters, type MediaEl, type ChartEl, type ChartSeries, type Gradient, type MathEl, type Shadow, type ShapeEl, type Slide, type SlideElement, type TableCell, type TableEl, type TextEl, type Trendline, isSlotKind } from "./model";
import { SHAPES } from "./shapes";
import { normalizePath } from "./svgpath";
import { parseD } from "./freeform";
import { themeById, themeColors } from "./themes";
import { normalizeTable } from "./table";
import { readSmil } from "./odp-anim";
import { readMasters, type ImportedDeck } from "./pptx-import";

type Props = Record<string, string>;
type StyleDef = { name: string; family: string; parent?: string; dataStyle?: string; props: Record<string, Props> };

const PROP_KINDS: Record<string, string> = {
  "graphic-properties": "graphic", "paragraph-properties": "paragraph", "text-properties": "text", "drawing-page-properties": "page",
  "table-cell-properties": "cell", "table-column-properties": "column", "table-row-properties": "row", "chart-properties": "chart",
};

const a = (el: XEl | undefined, qname: string): string | undefined => el?.attrs[qname];
const els = (el: XEl | undefined) => (el ? el.children.filter((c) => c.local !== "#text") : []);

/** A length (cm, mm, in, pt, pc, px) in px; plain numbers are px. */
export function lenPx(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+(?:e-?\d+)?)\s*(cm|mm|in|pt|pc|px)?$/i.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const u = (m[2] || "px").toLowerCase();
  return n * ({ cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 } as Record<string, number>)[u];
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const hexOf = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.slice(1).toUpperCase() : undefined);
const pctOf = (v: string | undefined) => (v && /%$/.test(v) ? Number(v.slice(0, -1)) / 100 : undefined);

class StyleSheet {
  styles = new Map<string, StyleDef>(); // family|name
  defaults = new Map<string, Record<string, Props>>();
  lists = new Map<string, boolean>(); // list style -> ordered
  gradients = new Map<string, XEl>();
  fillImages = new Map<string, string>();
  pageLayouts = new Map<string, Props>();
  masters = new Map<string, { layout?: string; style?: string }>();
  dataStyles = new Map<string, XEl>(); // number formats

  read(root: XEl | undefined) {
    if (!root) return;
    for (const sec of els(root)) {
      if (!["styles", "automatic-styles", "master-styles"].includes(sec.local)) continue;
      for (const s of els(sec)) {
        if (s.local === "style") {
          const props: Record<string, Props> = {};
          for (const p of els(s)) if (PROP_KINDS[p.local]) props[PROP_KINDS[p.local]] = { ...p.attrs };
          this.styles.set(`${a(s, "style:family")}|${a(s, "style:name")}`, { name: a(s, "style:name") || "", family: a(s, "style:family") || "", parent: a(s, "style:parent-style-name"), dataStyle: a(s, "style:data-style-name"), props });
        } else if (s.local === "default-style") {
          const props: Record<string, Props> = {};
          for (const p of els(s)) if (PROP_KINDS[p.local]) props[PROP_KINDS[p.local]] = { ...p.attrs };
          this.defaults.set(a(s, "style:family") || "", props);
        } else if (s.local === "list-style") {
          const first = els(s)[0];
          this.lists.set(a(s, "style:name") || "", first?.local === "list-level-style-number");
        } else if (s.local === "gradient") this.gradients.set(a(s, "draw:name") || "", s);
        else if (s.local === "fill-image") this.fillImages.set(a(s, "draw:name") || "", a(s, "xlink:href") || "");
        else if (s.local === "page-layout") this.pageLayouts.set(a(s, "style:name") || "", { ...(child(s, "page-layout-properties")?.attrs || {}) });
        else if (s.local === "number-style" || s.local === "percentage-style" || s.local === "currency-style") this.dataStyles.set(a(s, "style:name") || "", s);
        else if (s.local === "master-page") this.masters.set(a(s, "style:name") || "", { layout: a(s, "style:page-layout-name"), style: a(s, "draw:style-name") });
      }
    }
  }

  /** One kind of properties of a style, its parents and the family's default style merged (nearest wins). */
  props(family: string, name: string | undefined, kind: string): Props {
    const chain: Props[] = [];
    let cur = name;
    for (let guard = 0; cur && guard < 20; guard++) {
      const s = this.styles.get(`${family}|${cur}`);
      if (!s) break;
      if (s.props[kind]) chain.push(s.props[kind]);
      cur = s.parent;
    }
    const d = this.defaults.get(family)?.[kind];
    if (d) chain.push(d);
    return Object.assign({}, ...chain.reverse());
  }
}

type Ctx = {
  zip: JSZip;
  ss: StyleSheet;
  warnings: Set<string>;
  pics: Map<string, string>;
  textColor: string;
  font: string;
};

// ---------------------------------------------------------------- text

type Run = { b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string; size?: number; font?: string; bg?: string; pos?: "sup" | "sub" };
type TextDefaults = { size?: number; color?: string; font?: string };

function runOf(t: Props, base: Run): Run {
  const r: Run = { ...base };
  if (t["fo:font-weight"]) r.b = t["fo:font-weight"] === "bold" || Number(t["fo:font-weight"]) >= 600;
  if (t["fo:font-style"]) r.i = t["fo:font-style"] === "italic" || t["fo:font-style"] === "oblique";
  if (t["style:text-underline-style"]) r.u = t["style:text-underline-style"] !== "none";
  if (t["style:text-line-through-style"]) r.s = t["style:text-line-through-style"] !== "none";
  if (hexOf(t["fo:color"])) r.color = hexOf(t["fo:color"]);
  const fs = t["fo:font-size"];
  if (fs && !fs.endsWith("%")) {
    const px = lenPx(fs);
    if (px) r.size = Math.round((px * 72) / 96 * 10) / 10;
  } else if (fs && r.size) r.size = Math.round(r.size * (pctOf(fs) || 1) * 10) / 10;
  const font = t["fo:font-family"] || t["style:font-name"];
  if (font) r.font = font.replace(/['"]/g, "").trim();
  if (hexOf(t["fo:background-color"])) r.bg = hexOf(t["fo:background-color"]);
  const pos = t["style:text-position"];
  if (pos) {
    // "0% 100%" (no shift) is common; only a raise or a drop is a superscript or subscript
    const v = pos.trim().split(/\s+/)[0];
    const n = parseFloat(v);
    r.pos = v === "super" || n > 0 ? "sup" : v === "sub" || n < 0 ? "sub" : undefined;
    if (!r.pos) delete r.pos;
  }
  return r;
}

function wrapRun(text: string, r: Run, d: TextDefaults): string {
  if (!text) return "";
  let h = text;
  const css: string[] = [];
  if (r.color && r.color !== d.color) css.push(`color: #${r.color.toLowerCase()}`);
  if (r.size && r.size !== d.size) css.push(`font-size: ${r.size}pt`);
  if (r.font && r.font !== d.font) css.push(`font-family: ${r.font}`);
  if (css.length) h = `<span style="${css.join("; ")}">${h}</span>`;
  if (r.bg) h = `<mark data-color="#${r.bg.toLowerCase()}" style="background-color: #${r.bg.toLowerCase()}">${h}</mark>`;
  if (r.pos === "sup") h = `<sup>${h}</sup>`;
  if (r.pos === "sub") h = `<sub>${h}</sub>`;
  if (r.s) h = `<s>${h}</s>`;
  if (r.u) h = `<u>${h}</u>`;
  if (r.i) h = `<em>${h}</em>`;
  if (r.b) h = `<strong>${h}</strong>`;
  return h;
}

type Stat = { runs: Run[] };

function inlineHtml(c: Ctx, el: XEl, base: Run, d: TextDefaults, stat: Stat): string {
  let out = "";
  for (const n of el.children) {
    if (n.local === "#text") {
      const t = n.text.replace(/[\r\n\t ]+/g, " ");
      if (t) {
        stat.runs.push(base);
        out += wrapRun(escapeHtml(t), base, d);
      }
    } else if (n.local === "span") out += inlineHtml(c, n, runOf(c.ss.props("text", a(n, "text:style-name"), "text"), base), d, stat);
    else if (n.local === "a") {
      const href = a(n, "xlink:href") || "";
      const inner = inlineHtml(c, n, base, d, stat);
      out += /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    } else if (n.local === "line-break") out += "<br>";
    else if (n.local === "s") out += wrapRun(" ".repeat(Math.min(50, Number(a(n, "text:c")) || 1)), base, d);
    else if (n.local === "tab") out += wrapRun("\t", base, d);
    else if (n.local !== "annotation" && n.local !== "note") out += inlineHtml(c, n, base, d, stat);
  }
  return out;
}

const ALIGN: Record<string, string> = { center: "center", end: "right", right: "right", justify: "justify" };

function paraHtml(c: Ctx, p: XEl, base: Run, d: TextDefaults, stat: Stat, defaultAlign?: string): string {
  const ps = a(p, "text:style-name");
  const run = runOf(c.ss.props("paragraph", ps, "text"), base);
  const align = ALIGN[c.ss.props("paragraph", ps, "paragraph")["fo:text-align"] || ""] || defaultAlign;
  const inner = inlineHtml(c, p, p.local === "h" ? { ...run, b: true } : run, d, stat);
  return `<p${align && align !== defaultAlign ? ` style="text-align: ${align}"` : ""}>${inner}</p>`;
}

function listHtml(c: Ctx, list: XEl, base: Run, d: TextDefaults, stat: Stat, ordered: boolean, defaultAlign?: string): string {
  const ls = a(list, "text:style-name");
  const ord = ls && c.ss.lists.has(ls) ? c.ss.lists.get(ls)! : ordered;
  const items = kids(list, "list-item").concat(kids(list, "list-header"))
    .map((li) => `<li>${els(li).map((n) => (n.local === "list" ? listHtml(c, n, base, d, stat, ord, defaultAlign) : n.local === "p" || n.local === "h" ? paraHtml(c, n, base, d, stat, defaultAlign) : "")).join("") || "<p></p>"}</li>`)
    .join("");
  return items ? `<${ord ? "ol" : "ul"}>${items}</${ord ? "ol" : "ul"}>` : "";
}

/** The paragraphs and lists of a text box / shape as our rich text HTML. */
function blockHtml(c: Ctx, box: XEl, base: Run, d: TextDefaults, defaultAlign?: string, bullets = false): { html: string; stat: Stat } {
  const stat: Stat = { runs: [] };
  const parts = els(box).map((n) => {
    if (n.local === "p" || n.local === "h") {
      const h = paraHtml(c, n, base, d, stat, defaultAlign);
      return bullets && h !== "<p></p>" ? `<ul><li>${h}</li></ul>` : h;
    }
    if (n.local === "list") return listHtml(c, n, base, d, stat, false, defaultAlign);
    return "";
  });
  return { html: parts.join("").replace(/<\/ul><ul>/g, ""), stat };
}

const plainOf = (box: XEl | undefined): string => {
  if (!box) return "";
  const lines: string[] = [];
  const walk = (n: XEl): string => n.children.map((k) => (k.local === "#text" ? k.text : k.local === "line-break" ? "\n" : k.local === "s" ? " ".repeat(Number(a(k, "text:c")) || 1) : k.local === "tab" ? "\t" : walk(k))).join("");
  for (const p of descendants(box, "p").concat(descendants(box, "h"))) lines.push(walk(p).replace(/[ \t\r]+/g, (m) => (m.includes("\t") ? "\t" : " ")));
  return lines.join("\n").trim();
};

/** The most common value of a run property (to make it the box's default). */
function common<K extends keyof Run>(runs: Run[], k: K): Run[K] | undefined {
  const count = new Map<Run[K], number>();
  for (const r of runs) if (r[k] !== undefined) count.set(r[k], (count.get(r[k]) || 0) + 1);
  let best: Run[K] | undefined, n = 0;
  for (const [v, m] of count) if (m > n) [best, n] = [v, m];
  return best;
}

// ---------------------------------------------------------------- geometry

type Geo = { x: number; y: number; w: number; h: number; rot?: number };

function geometry(el: XEl): Geo {
  const w = lenPx(a(el, "svg:width")) ?? 0, h = lenPx(a(el, "svg:height")) ?? 0;
  const t = a(el, "draw:transform");
  if (t) {
    const rot = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/.exec(t);
    const tr = /translate\s*\(\s*([^\s,)]+)[\s,]+([^\s,)]+)\s*\)/.exec(t);
    const th = rot ? -Number(rot[1]) : 0; // ODF turns counter-clockwise
    const tx = tr ? lenPx(tr[1]) ?? 0 : lenPx(a(el, "svg:x")) ?? 0, ty = tr ? lenPx(tr[2]) ?? 0 : lenPx(a(el, "svg:y")) ?? 0;
    const cx = tx + (w / 2) * Math.cos(th) - (h / 2) * Math.sin(th);
    const cy = ty + (w / 2) * Math.sin(th) + (h / 2) * Math.cos(th);
    let deg = ((th * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    return { x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h), ...(Math.abs(deg) > 0.01 && Math.abs(deg - 360) > 0.01 ? { rot: r2(deg) } : {}) };
  }
  return { x: r2(lenPx(a(el, "svg:x")) ?? 0), y: r2(lenPx(a(el, "svg:y")) ?? 0), w: r2(w), h: r2(h) };
}

const ODF_TYPES: Record<string, string> = {
  rectangle: "rect", "round-rectangle": "roundRect", ellipse: "ellipse", circle: "ellipse", "isosceles-triangle": "triangle", "right-triangle": "rtTriangle",
  diamond: "diamond", parallelogram: "parallelogram", trapezoid: "trapezoid", pentagon: "pentagon", hexagon: "hexagon", octagon: "octagon",
  star5: "star5", "right-arrow": "rightArrow", "left-arrow": "leftArrow", "up-arrow": "upArrow", "down-arrow": "downArrow", chevron: "chevron",
  "pentagon-right": "homePlate", cross: "plus", "rectangular-callout": "wedgeRectCallout",
};
const SHAPE_IDS = new Set(SHAPES.map((s) => s.id));

function gradientOf(c: Ctx, nm: string | undefined): Gradient | undefined {
  const g = nm ? c.ss.gradients.get(nm) : undefined;
  if (!g) return undefined;
  const s = hexOf(a(g, "draw:start-color")) || "FFFFFF", e = hexOf(a(g, "draw:end-color")) || "000000";
  const style = a(g, "draw:style") || "linear";
  const raw = a(g, "draw:angle") || "0";
  const deg = /deg$/.test(raw) ? parseFloat(raw) : /rad$/.test(raw) ? (parseFloat(raw) * 180) / Math.PI : parseFloat(raw) / 10;
  const angle = Math.round((((90 - deg) % 360) + 360) % 360);
  if (style === "radial" || style === "ellipsoid" || style === "square" || style === "rectangular") return { kind: "radial", angle: 0, stops: [{ pos: 0, color: s }, { pos: 100, color: e }] };
  if (style === "axial") return { kind: "linear", angle, stops: [{ pos: 0, color: e }, { pos: 50, color: s }, { pos: 100, color: e }] };
  return { kind: "linear", angle, stops: [{ pos: 0, color: s }, { pos: 100, color: e }] };
}

function look(c: Ctx, g: Props) {
  const fillKind = g["draw:fill"] || "solid";
  const fill = fillKind === "none" ? null : fillKind === "gradient" ? hexOf(c.ss.gradients.get(g["draw:fill-gradient-name"] || "")?.attrs["draw:start-color"]) || null : hexOf(g["draw:fill-color"]) || (fillKind === "solid" ? "729FCF" : null);
  const grad = fillKind === "gradient" ? gradientOf(c, g["draw:fill-gradient-name"]) : undefined;
  const strokeKind = g["draw:stroke"] || "solid";
  const line = strokeKind === "none" ? null : hexOf(g["svg:stroke-color"]) || "000000";
  const lw = lenPx(g["svg:stroke-width"]);
  const lineA = pctOf(g["svg:stroke-opacity"]);
  const fillA = fill ? pctOf(g["draw:opacity"]) : undefined;
  let shadow: Shadow | undefined;
  if (g["draw:shadow"] === "visible") {
    const dx = lenPx(g["draw:shadow-offset-x"]) ?? 3, dy = lenPx(g["draw:shadow-offset-y"]) ?? 3;
    shadow = { color: hexOf(g["draw:shadow-color"]) || "000000", blur: lenPx(g["draw:shadow-blur"]) ?? 4, dist: r2(Math.hypot(dx, dy)), dir: r2((((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360), alpha: pctOf(g["draw:shadow-opacity"]) ?? 0.4 };
  }
  const va = g["draw:textarea-vertical-align"];
  return {
    fill,
    grad,
    line,
    lineW: line ? r2(lw && lw > 0 ? lw : 1) : undefined,
    ...(lineA !== undefined && lineA < 1 ? { lineA } : {}),
    ...(fillA !== undefined && fillA < 1 ? { fillA } : {}),
    shadow,
    valign: (va === "middle" ? "middle" : va === "bottom" ? "bottom" : va === "top" ? "top" : undefined) as ShapeEl["valign"],
    arrow: !!g["draw:marker-end"],
  };
}

// ---------------------------------------------------------------- pictures, tables, objects

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" };

const MEDIA_MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", weba: "audio/webm" };

/** Audio or video embedded as a plug-in: a media element (its file as a data: URL, uploaded by the editor). */
async function readMedia(c: Ctx, el: XEl, plugin: XEl, geo: Geo): Promise<MediaEl | null> {
  const path = (a(plugin, "xlink:href") || "").replace(/^\.\//, "");
  const f = path ? c.zip.file(path) : null;
  if (!f) {
    if (path) c.warnings.add("Audio or video linked from outside the file was left out.");
    return null;
  }
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const mime = (a(plugin, "draw:mime-type") || "").split(";")[0] || MEDIA_MIME[ext];
  if (!mime || !/^(audio|video)\//.test(mime)) {
    c.warnings.add("Some embedded media in a format browsers cannot play was left out.");
    return null;
  }
  const info = json(a(el, "syn:media"));
  const o = isObj(info) ? info : {};
  const param = (n: string) => kids(plugin, "param").find((p) => a(p, "draw:name") === n);
  const loop = a(param("Loop"), "draw:value") === "true";
  const poster = await pictureUrl(c, a(child(el, "image"), "xlink:href"));
  return {
    id: "",
    z: 0,
    ...geo,
    type: "media",
    kind: o.kind === "audio" || o.kind === "video" ? o.kind : mime.startsWith("audio/") ? "audio" : "video",
    src: `data:${mime};base64,${await f.async("base64")}`,
    mime,
    ...(poster ? { poster } : {}),
    ...(typeof o.name === "string" ? { name: o.name } : {}),
    ...(o.autoplay === true ? { autoplay: true } : {}),
    ...(loop ? { loop: true } : {}),
  };
}

async function pictureUrl(c: Ctx, href: string | undefined): Promise<string | null> {
  if (!href) return null;
  const path = href.replace(/^\.\//, "");
  if (c.pics.has(path)) return c.pics.get(path)!;
  const f = c.zip.file(path);
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (!f || !MIME[ext]) {
    if (f) c.warnings.add("Some pictures use formats browsers cannot show (WMF/EMF/SVM) and were left out.");
    return null;
  }
  const url = `data:${MIME[ext]};base64,${await f.async("base64")}`;
  c.pics.set(path, url);
  return url;
}

function borderOf(v: string | undefined): { c: string; w: number } | undefined {
  if (!v) return undefined;
  if (v === "none" || v === "hidden") return { c: "000000", w: 0 };
  const w = /(-?[\d.]+(?:cm|mm|in|pt|px))/.exec(v);
  const col = /#[0-9a-f]{6}/i.exec(v);
  return { c: col ? col[0].slice(1).toUpperCase() : "000000", w: r2(Math.max(0, lenPx(w?.[1]) ?? 1)) };
}

function readTable(c: Ctx, t: XEl, geo: Geo): TableEl {
  const colW: number[] = [];
  for (const col of descendants(t, "table-column")) {
    const n = Math.min(100, Number(a(col, "table:number-columns-repeated")) || 1);
    const w = lenPx(c.ss.props("table-column", a(col, "table:style-name"), "column")["style:column-width"]) ?? 0;
    for (let k = 0; k < n; k++) colW.push(w);
  }
  const rows: TableCell[][] = [];
  const rowH: number[] = [];
  const sides: { c: string; w: number }[] = [];
  for (const tr of descendants(t, "table-row").slice(0, 200)) {
    const n = Math.min(100, Number(a(tr, "table:number-rows-repeated")) || 1);
    const h = lenPx(c.ss.props("table-row", a(tr, "table:style-name"), "row")["style:row-height"] || c.ss.props("table-row", a(tr, "table:style-name"), "row")["style:min-row-height"]) ?? 0;
    const row: TableCell[] = [];
    for (const tc of els(tr)) {
      const rep = Math.min(100, Number(a(tc, "table:number-columns-repeated")) || 1);
      for (let k = 0; k < rep; k++) {
        if (tc.local === "covered-table-cell") {
          row.push({ text: "", merged: true });
          continue;
        }
        if (tc.local !== "table-cell") continue;
        const cp = c.ss.props("table-cell", a(tc, "table:style-name"), "cell");
        const box = blockHtml(c, tc, {}, { size: 14, color: c.textColor });
        const cell: TableCell = { text: plainOf(tc) };
        const allBold = box.stat.runs.length > 0 && box.stat.runs.every((r) => r.b);
        let html = box.html;
        if (allBold) {
          cell.bold = true;
          html = html.replace(/<\/?strong>/g, "");
        }
        const col = common(box.stat.runs, "color");
        if (col && box.stat.runs.every((r) => r.color === col)) {
          cell.color = col;
          html = html.replace(new RegExp(`<span style="color: #${col.toLowerCase()}">([^<]*)</span>`, "g"), "$1");
        }
        const pAlign = /^<p style="text-align: (\w+)">/.exec(html)?.[1];
        if (pAlign === "center" || pAlign === "right") cell.align = pAlign;
        const plain = cell.text.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join("");
        if (html && html !== plain && html.replace(/ style="text-align: \w+"/g, "") !== plain) cell.html = html;
        const bg = hexOf(cp["fo:background-color"]);
        if (bg) cell.fill = bg;
        const va = cp["style:vertical-align"];
        if (va === "middle" || va === "bottom") cell.valign = va;
        const cs = Number(a(tc, "table:number-columns-spanned")) || 1, rs = Number(a(tc, "table:number-rows-spanned")) || 1;
        if (cs > 1) cell.cs = cs;
        if (rs > 1) cell.rs = rs;
        const all = cp["fo:border"];
        const bd = { t: borderOf(cp["fo:border-top"] || all), r: borderOf(cp["fo:border-right"] || all), b: borderOf(cp["fo:border-bottom"] || all), l: borderOf(cp["fo:border-left"] || all) };
        for (const s of Object.values(bd)) if (s) sides.push(s);
        (cell as TableCell & { _bd?: typeof bd })._bd = bd;
        row.push(cell);
      }
    }
    for (let k = 0; k < n; k++) {
      rows.push(k ? row.map((x) => ({ ...x })) : row);
      rowH.push(h);
    }
  }
  // the most common thin border becomes the table's; other sides are kept per cell
  const thin = sides.filter((s) => s.w > 0 && s.w <= 1.5);
  const counts = new Map<string, number>();
  for (const s of thin) counts.set(s.c, (counts.get(s.c) || 0) + 1);
  const border = [...counts].sort((p, q) => q[1] - p[1])[0]?.[0];
  for (const row of rows)
    for (const cell of row) {
      const bd = (cell as TableCell & { _bd?: Record<string, { c: string; w: number } | undefined> })._bd;
      delete (cell as TableCell & { _bd?: unknown })._bd;
      if (!bd) continue;
      const own: NonNullable<TableCell["bd"]> = {};
      for (const k of ["t", "r", "b", "l"] as const) {
        const s = bd[k];
        if (!s) own[k] = { c: "000000", w: 0 };
        else if (!(s.w > 0 && s.w <= 1.5 && s.c === border)) own[k] = s;
      }
      if (Object.keys(own).length) cell.bd = own;
    }
  const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
  return {
    id: "", z: 0, type: "table", ...geo,
    rows: normalizeTable(rows),
    ...(border ? { border } : {}),
    ...(colW.length && sum(colW) > 0 ? { colW: colW.map(r2) } : {}),
    ...(rowH.length && sum(rowH) > 0 && rowH.every((h) => h > 0) ? { rowH: rowH.map(r2) } : {}),
  };
}

const CHART_TYPES: Record<string, ChartEl["chartType"]> = { "chart:bar": "bar", "chart:line": "line", "chart:area": "area", "chart:circle": "pie", "chart:ring": "doughnut", "chart:scatter": "scatter", "chart:bubble": "scatter", "chart:radar": "line", "chart:filled-radar": "area", "chart:stock": "line" };
const REGRESSION: Record<string, Trendline["type"]> = { linear: "linear", polynomial: "poly", exponential: "exp", logarithmic: "log", power: "power", "moving-average": "movingAvg" };

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** An ODF number style as an Excel-style format code (the common parts: text, grouping, decimals, scale, percent, scientific). */
export function numberStyleCode(st: XEl | undefined): string | undefined {
  if (!st) return undefined;
  const textOf = (k: XEl) => (k.children.some((x) => x.local === "#text") ? k.children.map((x) => (x.local === "#text" ? x.text || "" : "")).join("") : k.text || "");
  let code = "";
  for (const k of els(st)) {
    if (k.local === "text") {
      const t = textOf(k);
      code += /^[$€£¥%\-+() ]*$/.test(t) ? t : `"${t.replace(/"/g, "")}"`;
    } else if (k.local === "number" || k.local === "scientific-number") {
      const minInt = Math.max(1, Number(a(k, "number:min-integer-digits") ?? 1) || 1);
      const decs = Math.max(0, Math.min(15, Number(a(k, "number:decimal-places")) || 0));
      const minDec = Math.min(decs, Number(a(k, "number:min-decimal-places") ?? decs) || 0);
      const int = a(k, "number:grouping") === "true" ? `#,${"#".repeat(Math.max(0, 3 - minInt))}${"0".repeat(minInt)}`.replace(/^#,#*(0{4,})$/, "$1") : "0".repeat(minInt);
      code += int + (decs ? "." + "0".repeat(minDec) + "#".repeat(decs - minDec) : "");
      const factor = Number(a(k, "number:display-factor")) || 1;
      if (factor >= 1000) code += ",".repeat(Math.round(Math.log10(factor) / 3));
      if (k.local === "scientific-number") code += "E+" + "0".repeat(Math.max(1, Number(a(k, "number:min-exponent-digits")) || 2));
    } else if (k.local === "currency-symbol") code += textOf(k) === "$" ? "$" : `[$${textOf(k)}]`;
  }
  return code && /[0#]/.test(code) ? code : undefined;
}

function readChart(c: Ctx, doc: XEl, geo: Geo): ChartEl | null {
  const chart = descendants(doc, "chart").find((x) => x.name.endsWith("chart:chart") || a(x, "chart:class"));
  if (!chart) return null;
  const ss = new StyleSheet();
  ss.read(doc);
  const chartType = CHART_TYPES[a(chart, "chart:class") || ""] || "bar";
  // the local table as a grid of strings, rows numbered from 1 like the cell addresses
  const grid: string[][] = [];
  const table = descendants(chart, "table")[0];
  for (const tr of descendants(table, "table-row")) {
    const row: string[] = [];
    for (const tc of els(tr)) {
      const rep = Math.min(50, Number(a(tc, "table:number-columns-repeated")) || 1);
      const v = a(tc, "office:value") ?? plainOf(tc);
      for (let k = 0; k < rep; k++) row.push(v);
    }
    grid.push(row);
  }
  const rangeOf = (addr: string | undefined): string[] => {
    const m = /\.\$?([A-Z]+)\$?(\d+)(?::[^.]*\.\$?([A-Z]+)\$?(\d+))?/i.exec(addr || "");
    if (!m) return [];
    const c0 = colIndex(m[1]), r0 = Number(m[2]) - 1, c1 = m[3] ? colIndex(m[3]) : c0, r1 = m[4] ? Number(m[4]) - 1 : r0;
    const out: string[] = [];
    for (let r = r0; r <= r1; r++) for (let k = c0; k <= c1; k++) out.push(grid[r]?.[k] ?? "");
    return out;
  };
  const plot = child(chart, "plot-area");
  const plotProps = ss.props("chart", a(plot, "chart:style-name"), "chart");
  const axes = kids(plot, "axis");
  const ax = (dim: string) => axes.find((x) => a(x, "chart:dimension") === dim);
  const xAx = ax("x"), yAx = ax("y");
  let categories = rangeOf(a(child(xAx, "categories"), "table:cell-range-address"));
  const series: ChartSeries[] = kids(plot, "series").slice(0, 20).map((s, i) => {
    const vals = rangeOf(a(s, "chart:values-cell-range-address")).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
    const label = rangeOf(a(s, "chart:label-cell-address"))[0] || `Series ${i + 1}`;
    const g = ss.props("chart", a(s, "chart:style-name"), "graphic");
    const color = hexOf(g["draw:fill-color"]) || hexOf(g["svg:stroke-color"]);
    if (chartType === "scatter" && !categories.length) categories = rangeOf(a(child(s, "domain"), "table:cell-range-address"));
    const rc = child(s, "regression-curve");
    const rp = rc ? ss.props("chart", a(rc, "chart:style-name"), "chart") : {};
    const tt = rc ? REGRESSION[rp["chart:regression-type"] || "linear"] : undefined;
    const eqEl = child(rc, "equation");
    const trend: Trendline | undefined = tt
      ? {
          type: tt,
          ...(tt === "poly" ? { order: Number(rp["chart:regression-max-degree"]) || 2 } : {}),
          ...(tt === "movingAvg" ? { period: Number(rp["chart:regression-period"]) || 2 } : {}),
          ...(a(eqEl, "chart:display-equation") === "true" ? { eq: true } : {}),
          ...(a(eqEl, "chart:display-r-square") === "true" ? { r2: true } : {}),
        }
      : undefined;
    // combo charts: a series of another class (bar, line or area), or on the secondary axis
    const cls = ({ "chart:bar": "bar", "chart:line": "line", "chart:area": "area" } as Record<string, "bar" | "line" | "area">)[a(s, "chart:class") || ""];
    const own = cls && cls !== chartType && (chartType === "bar" || chartType === "line" || chartType === "area") ? cls : undefined;
    const y2 = a(s, "chart:attached-axis") === "secondary-y";
    return { name: label, values: vals, ...(color ? { color } : {}), ...(trend ? { trend } : {}), ...(own ? { type: own } : {}), ...(y2 ? { y2: true } : {}) };
  });
  if (!series.length) return null;
  const n = Math.max(categories.length, ...series.map((s) => s.values.length));
  if (!categories.length) categories = Array.from({ length: n }, (_, k) => grid[k + 1]?.[0] || `Category ${k + 1}`);
  const title = plainOf(child(chart, "title")) || undefined;
  const legend = child(chart, "legend");
  const lp = a(legend, "chart:legend-position") || "end";
  const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  /** Bounds, units and number format of a value axis (the scatter X axis too). */
  const scaleOf = (axEl: XEl | undefined) => {
    const p = ss.props("chart", a(axEl, "chart:style-name"), "chart");
    const major = num(p["chart:interval-major"]);
    const div = num(p["chart:interval-minor-divisor"]);
    const ds = ss.styles.get(`chart|${a(axEl, "chart:style-name")}`)?.dataStyle;
    const fmt = a(axEl, "syn:fmt") || (p["chart:link-data-style-to-source"] === "false" && ds ? numberStyleCode(ss.dataStyles.get(ds)) : undefined);
    return {
      ...(p["chart:auto-minimum"] !== "true" && num(p["chart:minimum"]) !== undefined ? { min: num(p["chart:minimum"]) } : {}),
      ...(p["chart:auto-maximum"] !== "true" && num(p["chart:maximum"]) !== undefined ? { max: num(p["chart:maximum"]) } : {}),
      ...(major ? { major } : {}),
      ...(major && div && div > 1 ? { minor: Math.round((major / div) * 1e9) / 1e9 } : {}),
      ...(fmt ? { fmt } : {}),
    };
  };
  const valAx = {
    ...scaleOf(yAx),
    ...(kids(yAx, "grid").some((g) => a(g, "chart:class") !== "minor") ? {} : { grid: false }),
    ...(kids(yAx, "grid").some((g) => a(g, "chart:class") === "minor") ? { minorGrid: true } : {}),
    ...(plainOf(child(yAx, "title")) ? { title: plainOf(child(yAx, "title")) } : {}),
  };
  const catAx = {
    ...(chartType === "scatter" ? scaleOf(xAx) : {}),
    ...(kids(xAx, "grid").length ? { grid: true } : {}),
    ...(plainOf(child(xAx, "title")) ? { title: plainOf(child(xAx, "title")) } : {}),
  };
  const round = chartType === "pie" || chartType === "doughnut";
  return {
    id: "", z: 0, type: "chart", ...geo, chartType,
    ...(title ? { title } : {}),
    categories: categories.slice(0, 100),
    series: series.map((s) => ({ ...s, values: categories.slice(0, 100).map((_, k) => s.values[k] ?? 0) })),
    showLegend: !!legend,
    ...(legend ? { legendPos: (lp === "bottom" ? "b" : lp === "top" ? "t" : lp === "start" ? "l" : "r") as ChartEl["legendPos"] } : {}),
    ...(chartType === "bar" && plotProps["chart:vertical"] === "true" ? { barDir: "bar" as const } : {}),
    ...(plotProps["chart:stacked"] === "true" || plotProps["chart:percentage"] === "true" ? { stacked: true } : {}),
    ...(plotProps["chart:percentage"] === "true" ? { percent: true } : {}),
    ...(plotProps["chart:data-label-number"] && plotProps["chart:data-label-number"] !== "none" ? { dataLabels: true } : {}),
    ...(!round && Object.keys(valAx).length ? { valAx } : {}),
    ...(!round && Object.keys(catAx).length ? { catAx } : {}),
  };
}

const MO: Record<string, string> = { "±": "\\pm", "×": "\\times", "÷": "\\div", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "∞": "\\infty", "→": "\\to", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∂": "\\partial", "·": "\\cdot", "−": "-", "∈": "\\in", "⋅": "\\cdot" };
const GREEK: Record<string, string> = { α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", θ: "theta", λ: "lambda", μ: "mu", π: "pi", σ: "sigma", φ: "phi", ω: "omega", Δ: "Delta", Σ: "Sigma", Ω: "Omega", Π: "Pi" };

/** Presentation MathML -> LaTeX (the common elements). */
export function mathmlToLatex(el: XEl): string {
  const ch = els(el);
  const g = (e: XEl | undefined) => (e ? mathmlToLatex(e) : "");
  const br = (e: XEl | undefined) => `{${g(e)}}`;
  const tok = (t: string) => [...t].map((x) => (MO[x] ? `${MO[x]} ` : GREEK[x] ? `\\${GREEK[x]} ` : x)).join("").trim();
  switch (el.local) {
    case "math": case "mrow": case "mstyle": case "mpadded": case "mphantom": case "menclose": case "merror":
      return ch.map(mathmlToLatex).join("");
    case "semantics":
      return g(ch.find((x) => x.local !== "annotation" && x.local !== "annotation-xml"));
    case "mi": case "mn": case "mo":
      return tok(el.text.trim());
    case "mtext":
      return `\\text{${el.text}}`;
    case "mspace":
      return "\\ ";
    case "mfrac":
      return `\\frac${br(ch[0])}${br(ch[1])}`;
    case "msqrt":
      return `\\sqrt{${ch.map(mathmlToLatex).join("")}}`;
    case "mroot":
      return `\\sqrt[${g(ch[1])}]${br(ch[0])}`;
    case "msup":
      return `${g(ch[0])}^${br(ch[1])}`;
    case "msub":
      return `${g(ch[0])}_${br(ch[1])}`;
    case "msubsup":
      return `${g(ch[0])}_${br(ch[1])}^${br(ch[2])}`;
    case "munder":
      return `${g(ch[0])}_${br(ch[1])}`;
    case "mover": {
      const acc = ch[1]?.text.trim();
      if (acc === "¯" || acc === "‾" || acc === "―") return `\\overline${br(ch[0])}`;
      if (acc === "→" || acc === "⃗") return `\\vec${br(ch[0])}`;
      if (acc === "^" || acc === "ˆ") return `\\hat${br(ch[0])}`;
      return `${g(ch[0])}^${br(ch[1])}`;
    }
    case "munderover":
      return `${g(ch[0])}_${br(ch[1])}^${br(ch[2])}`;
    case "mfenced": {
      const open = a(el, "open") ?? "(", close = a(el, "close") ?? ")";
      return `\\left${open === "{" ? "\\{" : open || "."}${ch.map(mathmlToLatex).join(",")}\\right${close === "}" ? "\\}" : close || "."}`;
    }
    case "mtable":
      return `\\begin{matrix}${kids(el, "mtr").map((r) => kids(r, "mtd").map(mathmlToLatex).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
    case "mtd":
      return ch.map(mathmlToLatex).join("");
    default:
      return ch.map(mathmlToLatex).join("");
  }
}

function readMath(doc: XEl): string | null {
  const math = doc.local === "math" ? doc : descendants(doc, "math")[0];
  if (!math) return null;
  const tex = descendants(math, "annotation").find((x) => /x-tex|latex/i.test(a(x, "encoding") || ""));
  if (tex) return tex.text.trim();
  const out = mathmlToLatex(math).replace(/\s+/g, " ").trim();
  return out || null;
}

// ---------------------------------------------------------------- pages

type PageOut = {
  title?: string;
  tbox?: Geo;
  tstyle?: Slide["tstyle"];
  body?: string;
  bbox?: Geo;
  bstyle?: Slide["bstyle"];
  bodyClass?: string;
  bodyFit?: boolean;
  elements: SlideElement[];
  /** xml:id / draw:id of the page's objects -> element id, "title" or "body" */
  ids?: Map<string, string>;
};

/** A title, outline (body) or subtitle placeholder: its text becomes the slide's title or body. */
function placeholder(c: Ctx, el: XEl, box: XEl, cls: string, geo: Geo, g: Record<string, string>, out: PageOut): void {
  if (cls === "title") {
    const st: Stat = { runs: [] };
    for (const p of descendants(box, "p")) inlineHtml(c, p, runOf(c.ss.props("presentation", a(el, "presentation:style-name"), "text"), {}), {}, st);
    out.title = plainOf(box);
    out.tbox = geo;
    const r = st.runs;
    const align = ALIGN[c.ss.props("paragraph", a(descendants(box, "p")[0], "text:style-name"), "paragraph")["fo:text-align"] || ""];
    const size = common(r, "size"), color = common(r, "color"), font = common(r, "font");
    out.tstyle = { ...(size ? { size } : {}), ...(color ? { color } : {}), ...(font ? { font } : {}), ...(r.length && r.every((x) => !x.b) ? { bold: false } : {}), ...(align ? { align: align as "center" | "right" } : align === undefined ? {} : {}) };
    return;
  }
  const baseRun = runOf(c.ss.props("presentation", a(el, "presentation:style-name"), "text"), {});
  const first = blockHtml(c, box, baseRun, {}, cls === "subtitle" ? "center" : undefined, cls === "outline");
  const size = common(first.stat.runs, "size"), color = common(first.stat.runs, "color"), font = common(first.stat.runs, "font");
  const d: TextDefaults = { size, color, font };
  out.body = blockHtml(c, box, baseRun, d, cls === "subtitle" ? "center" : undefined, cls === "outline").html;
  out.bbox = geo;
  out.bodyClass = cls;
  out.bodyFit = a(el, "syn:autofit") === "shrink" || g["draw:fit-to-size"] === "shrink-to-fit" || g["style:shrink-to-fit"] === "true";
  out.bstyle = { ...(size ? { size } : {}), ...(color ? { color } : {}), ...(font ? { font } : {}) };
}

async function readShape(c: Ctx, el: XEl, out: PageOut, group: string | undefined, skipBar: boolean): Promise<void> {
  const nm = a(el, "draw:name") || "";
  if (skipBar && nm.startsWith("syn-bar")) return;
  const id = /^syn-el-(.+)$/.exec(nm)?.[1] || genId("e");
  const gs = c.ss.props("graphic", a(el, "draw:style-name"), "graphic");
  const ps = c.ss.props("presentation", a(el, "presentation:style-name"), "graphic");
  const g = { ...ps, ...gs };
  const base = { id, z: out.elements.length + 1, ...(group ? { group } : {}) };
  const textDefaults: TextDefaults = { size: 18, color: c.textColor };
  const extra = extrasOf(a(el, "syn:x"));
  const push = (e: SlideElement) => out.elements.push(extra ? ({ ...e, ...extra } as SlideElement) : e);
  const tag = el.local;

  if (tag === "g") {
    const gid = a(el, "syn:group") || genId("g");
    const before = out.elements.length;
    for (const k of els(el)) await readShape(c, k, out, undefined, skipBar);
    // a group inside this one stays a group inside it
    for (let j = before; j < out.elements.length; j++) {
      const e = out.elements[j];
      if (e.group) e.sub = [e.group, ...(e.sub || [])];
      e.group = gid;
    }
    return;
  }
  // our own title and body, written as plain shapes by another application (from our .pptx)
  const ownCls = nm.startsWith("syn-title") ? "title" : nm === "syn-body" ? "outline" : undefined;
  if (ownCls && (tag === "frame" || tag === "custom-shape" || tag === "rect") && !(ownCls === "title" ? out.tbox : out.bbox)) {
    const holder = tag === "frame" ? child(el, "text-box") : el;
    if (holder && descendants(holder, "p").length) return placeholder(c, el, holder, ownCls, geometry(el), g, out);
  }
  if (tag === "frame" && a(el, "syn:model3d")) {
    const m = json(a(el, "syn:model3d"));
    const file = isObj(m) && typeof m.file === "string" && /^Models\/[\w.-]+\.glb$/.test(m.file) ? c.zip.file(m.file) : null;
    if (file && isObj(m)) {
      const poster = await pictureUrl(c, a(child(el, "image"), "xlink:href"));
      const deg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-180, Math.min(180, v)) : 0);
      push({ ...base, type: "model3d", src: `data:model/gltf-binary;base64,${await file.async("base64")}`, ...(poster ? { poster } : {}), ...(deg(m.rx) ? { rx: deg(m.rx) } : {}), ...(deg(m.ry) ? { ry: deg(m.ry) } : {}), ...(deg(m.rz) ? { rz: deg(m.rz) } : {}), ...(typeof m.name === "string" ? { name: m.name.slice(0, 120) } : {}), ...geometry(el) } as SlideElement);
      return;
    }
  }
  if (tag === "frame" && a(el, "syn:zoom")) {
    const z = json(a(el, "syn:zoom"));
    if (isObj(z) && typeof z.target === "string" && (z.kind === "slide" || z.kind === "section")) {
      push({ ...base, type: "zoom", kind: z.kind, target: z.target, ...(z.ret === true ? { ret: true } : {}), ...(z.border === false ? { border: false } : {}), ...geometry(el) } as SlideElement);
      return;
    }
  }
  if (tag === "frame") {
    const cls = a(el, "presentation:class");
    const geo = geometry(el);
    const box = child(el, "text-box");
    if ((cls === "title" || cls === "outline" || cls === "subtitle") && box) return placeholder(c, el, box, cls, geo, g, out);
    if (cls === "notes" || cls === "page-number" || cls === "footer" || cls === "date-time" || cls === "header") return;
    const lk = look(c, g);
    const img = child(el, "image");
    const obj = child(el, "object");
    const tbl = child(el, "table");
    const plugin = child(el, "plugin");
    if (plugin) {
      const m = await readMedia(c, el, plugin, geo);
      if (m) {
        push({ ...m, ...base });
        return;
      }
    }
    if (tbl) {
      push({ ...readTable(c, tbl, geo), ...base });
      return;
    }
    if (obj) {
      const dir = (a(obj, "xlink:href") || "").replace(/^\.\//, "").replace(/\/$/, "");
      const xml = await c.zip.file(`${dir}/content.xml`)?.async("string");
      const doc = xml ? parseXml(xml, { mixed: true }) : undefined;
      if (doc && descendants(doc, "chart").length && doc.local !== "math") {
        const ch = readChart(c, doc, geo);
        if (ch) {
          push({ ...ch, ...base });
          return;
        }
      }
      if (doc) {
        const latex = readMath(doc);
        if (latex) {
          const size = Number(a(el, "syn:math-size")) || Math.max(12, Math.min(72, Math.round((geo.h * 72) / 96 / 2)));
          const color = a(el, "syn:math-color");
          push({ ...base, ...geo, type: "math", latex, size, ...(color ? { color } : {}) } as MathEl);
          return;
        }
      }
      // anything else: its preview picture
      const rep = kids(el, "image").map((x) => a(x, "xlink:href"));
      for (const href of rep) {
        const url = await pictureUrl(c, href);
        if (url) {
          push({ ...base, ...geo, type: "image", src: url });
          return;
        }
      }
      c.warnings.add("Embedded objects other than charts and formulas were left out.");
      return;
    }
    if (img) {
      for (const im of kids(el, "image")) {
        // our own export: the picture before its crop (the frame shows it cropped for other applications)
        const orig = isObj(json(a(el, "syn:x"))) ? (json(a(el, "syn:x")) as Record<string, unknown>).orig : undefined;
        const url = (typeof orig === "string" && extra && "crop" in extra ? await pictureUrl(c, orig) : null) || (await pictureUrl(c, a(im, "xlink:href")));
        if (url) {
          const alt = child(el, "desc")?.text || child(el, "title")?.text;
          push({ ...base, ...geo, type: "image", src: url, ...(alt ? { alt } : {}), ...(lk.shadow ? { shadow: lk.shadow } : {}) });
          return;
        }
      }
      return;
    }
    if (box) {
      const { html } = blockHtml(c, box, runOf(c.ss.props("presentation", a(el, "presentation:style-name"), "text"), {}), textDefaults);
      const autofit = a(el, "syn:autofit") === "shrink" ? "shrink" : g["draw:auto-grow-height"] === "true" ? "resize" : undefined;
      const t: TextEl = { ...base, ...geo, type: "text", html, ...(lk.valign && lk.valign !== "top" ? { valign: lk.valign } : {}), ...(autofit ? { autofit } : {}) };
      push(t);
      // a filled or outlined text frame keeps its look as a shape behind the text
      if (lk.fill && g["draw:fill"] && g["draw:fill"] !== "none") {
        out.elements.pop();
        push({ ...base, ...geo, type: "shape", shape: "rect", fill: lk.fill, line: lk.line, ...(lk.lineW ? { lineW: lk.lineW } : {}), html, valign: lk.valign || "top" });
      }
    }
    return;
  }

  const textHtml = () => (els(el).some((k) => k.local === "p" || k.local === "list") ? blockHtml(c, el, {}, textDefaults, "center").html : "");
  const lk = look(c, g);
  const style = { fill: lk.fill, ...(lk.fillA !== undefined ? { fillA: lk.fillA } : {}), line: lk.line, ...(lk.lineW ? { lineW: lk.lineW } : {}), ...(lk.lineA !== undefined ? { lineA: lk.lineA } : {}), ...(lk.grad ? { grad: lk.grad } : {}), ...(lk.shadow ? { shadow: lk.shadow } : {}) };
  const synShape = a(el, "syn:shape");

  if (tag === "line" || tag === "connector") {
    const x1 = lenPx(a(el, "svg:x1")) ?? 0, y1 = lenPx(a(el, "svg:y1")) ?? 0, x2 = lenPx(a(el, "svg:x2")) ?? 0, y2 = lenPx(a(el, "svg:y2")) ?? 0;
    const shape = synShape && /^line/.test(synShape) ? synShape : lk.arrow ? "lineArrow" : "line";
    push({ ...base, type: "shape", shape, x: r2(Math.min(x1, x2)), y: r2(Math.min(y1, y2)), w: r2(Math.abs(x2 - x1)), h: r2(Math.abs(y2 - y1)), ...(x2 < x1 ? { flipH: true } : {}), ...(y2 < y1 ? { flipV: true } : {}), fill: null, line: lk.line || "000000", lineW: lk.lineW || 1, ...(lk.lineA !== undefined ? { lineA: lk.lineA } : {}) });
    return;
  }
  const geo = geometry(el);
  const html = textHtml();
  const shapeEl = (shape: string, extra: Partial<ShapeEl> = {}): ShapeEl => ({ ...base, ...geo, type: "shape", shape, ...style, ...(html ? { html, valign: lk.valign || "middle" } : {}), ...extra });
  if (tag === "rect") return void push(shapeEl(synShape && SHAPE_IDS.has(synShape) ? synShape : a(el, "draw:corner-radius") ? "roundRect" : "rect"));
  if (tag === "ellipse" || tag === "circle") return void push(shapeEl("ellipse"));
  if (tag === "path" || tag === "polygon" || tag === "polyline") {
    const vb = (a(el, "svg:viewBox") || "").split(/[\s,]+/).map(Number);
    const vw = vb[2] || geo.w || 1, vh = vb[3] || geo.h || 1;
    let d = "";
    if (tag === "path") d = normalizePath(a(el, "svg:d") || "");
    else {
      const pts = (a(el, "draw:points") || "").trim().split(/[\s,]+/).map(Number);
      for (let k = 0; k + 1 < pts.length; k += 2) d += `${k ? " L" : "M"}${pts[k] - (vb[0] || 0)} ${pts[k + 1] - (vb[1] || 0)}`;
      if (tag === "polygon") d += " Z";
    }
    if (!parseD(d).length) return;
    const closed = /Z\s*$/i.test(d.trim());
    return void push(shapeEl("freeform", { geom: { w: r2(vw), h: r2(vh), d }, ...(closed ? {} : { fill: null }) }));
  }
  if (tag === "custom-shape") {
    const eg = child(el, "enhanced-geometry");
    const type = a(eg, "draw:type") || "";
    const mirror = { ...(a(eg, "draw:mirror-horizontal") === "true" ? { flipH: true } : {}), ...(a(eg, "draw:mirror-vertical") === "true" ? { flipV: true } : {}) };
    const synGeom = a(el, "syn:geom");
    if (synShape === "freeform" && synGeom) {
      try {
        return void push(shapeEl("freeform", { geom: JSON.parse(synGeom), ...mirror }));
      } catch {
        // fall through to the path
      }
    }
    if (synShape && SHAPE_IDS.has(synShape)) return void push(shapeEl(synShape, mirror));
    const mapped = ODF_TYPES[type] || (type.startsWith("ooxml-") && SHAPE_IDS.has(type.slice(6)) ? type.slice(6) : undefined);
    if (mapped) return void push(shapeEl(mapped, mirror));
    const ep = a(eg, "draw:enhanced-path") || "";
    if (ep && !/[?$]/.test(ep)) {
      const vb = (a(eg, "svg:viewBox") || "0 0 21600 21600").split(/[\s,]+/).map(Number);
      // enhanced paths use M L C Q Z N (and F/S for fill/stroke-less parts)
      const d = ep.replace(/[NFS]/g, " ").replace(/\s+/g, " ").trim();
      const cmds = parseD(d);
      if (cmds.length > 1) {
        const shifted = cmds.map((k) => ({ c: k.c, p: k.p.map((v, j) => v - (j % 2 ? vb[1] : vb[0])) }));
        const dd = shifted.map((k) => (k.c === "Z" ? "Z" : `${k.c}${k.p.join(" ")}`)).join(" ");
        return void push(shapeEl("freeform", { geom: { w: vb[2] || 1, h: vb[3] || 1, d: dd }, ...mirror }));
      }
    }
    c.warnings.add("Some shapes with formula-driven outlines were imported as rectangles.");
    return void push(shapeEl("rect", mirror));
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const json = (v: string | undefined): unknown => {
  if (!v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};

/** Animations and picture crop written by our exporter (syn:x). */
function extrasOf(v: string | undefined): Partial<SlideElement> | undefined {
  const x = json(v);
  if (!isObj(x)) return undefined;
  const out: Record<string, unknown> = {};
  if (isObj(x.anim) && typeof x.anim.effect === "string") out.anim = x.anim;
  if (Array.isArray(x.fx)) out.fx = x.fx.filter((f) => isObj(f) && typeof f.effect === "string");
  if (isObj(x.crop) && ["l", "t", "r", "b"].every((k) => typeof (x.crop as Record<string, unknown>)[k] === "number")) out.crop = x.crop;
  if (isObj(x.wa)) out.wa = x.wa;
  if (validWarp(x.warp)) out.warp = x.warp;
  if (typeof x.cols === "number" && x.cols > 1) out.cols = Math.min(16, Math.round(x.cols));
  if (typeof x.colGap === "number") out.colGap = x.colGap;
  if (typeof x.alt === "string") out.alt = x.alt.slice(0, 2000);
  if (x.deco === true) out.deco = true;
  if (isSlotKind(x.slot)) out.slot = x.slot;
  if (typeof x.ph === "string" && x.ph.length < 100) out.ph = x.ph;
  return Object.keys(out).length ? (out as Partial<SlideElement>) : undefined;
}

const isBoxV = (v: unknown) => isObj(v) && ["x", "y", "w", "h"].every((k) => typeof v[k] === "number" && Number.isFinite(v[k] as number));
/** The slide settings our exporter keeps in syn:props, type-checked. */
function slideProps(v: string | undefined): Partial<Slide> | undefined {
  const o = json(v);
  if (!isObj(o)) return undefined;
  const out: Partial<Slide> = {};
  if (o.layout === "content" || o.layout === "title" || o.layout === "titleOnly" || o.layout === "blank") out.layout = o.layout;
  if (typeof o.clayout === "string" && o.clayout) out.clayout = o.clayout;
  if (o.hideUnder === true) out.hideUnder = true;
  if (isBoxV(o.tbox)) out.tbox = o.tbox as Slide["tbox"];
  if (isBoxV(o.bbox)) out.bbox = o.bbox as Slide["bbox"];
  if (isObj(o.tstyle)) out.tstyle = o.tstyle as Slide["tstyle"];
  if (isObj(o.bstyle)) {
    const { lv, ...rest } = o.bstyle as Record<string, unknown>;
    const levels = cleanLevels(lv);
    out.bstyle = { ...(rest as Slide["bstyle"]), ...(levels ? { lv: levels } : {}) };
  }
  if (o.bodyValign === "top" || o.bodyValign === "middle" || o.bodyValign === "bottom") out.bodyValign = o.bodyValign;
  if (o.bodyFit === "none") out.bodyFit = "none";
  if (isObj(o.trans) && typeof o.trans.type === "string") out.trans = o.trans as Slide["trans"];
  for (const k of ["tanim", "banim"] as const) if (isObj(o[k]) && typeof (o[k] as Record<string, unknown>).effect === "string") out[k] = o[k] as Slide["tanim"];
  for (const k of ["tfx", "bfx"] as const) if (Array.isArray(o[k])) out[k] = (o[k] as unknown[]).filter((f) => isObj(f) && typeof f.effect === "string") as Slide["tfx"];
  if (typeof o.thtml === "string" && o.thtml.length < 20000) out.thtml = o.thtml;
  return out;
}

const blankMaster = (k: MasterKey, masters: Masters): Slide => ({ id: "", title: "", body: "", notes: "", layout: masterLayout(k, masters), bg: "", bgImg: "", elements: [] });

/** The objects on a master page; with `byLayer`, split into the slide master's (syn:layer="master") and the layout's. */
async function masterObjects(c: Ctx, mp: XEl, skipBar: boolean): Promise<{ master: SlideElement[]; layout: SlideElement[] }> {
  const res = { master: [] as SlideElement[], layout: [] as SlideElement[] };
  for (const k of els(mp)) {
    if (k.local === "notes" || k.local === "forms" || k.local === "animations") continue;
    const tmp: PageOut = { elements: [] };
    await readShape(c, k, tmp, undefined, skipBar);
    (a(k, "syn:layer") === "master" ? res.master : res.layout).push(...tmp.elements);
  }
  return res;
}

async function readPage(c: Ctx, page: XEl, skipBar: boolean): Promise<PageOut> {
  const out: PageOut = { elements: [], ids: new Map() };
  for (const k of els(page)) {
    if (k.local === "notes" || k.local === "forms" || k.local === "animations") continue;
    const n = out.elements.length, t = out.title, b = out.body;
    await readShape(c, k, out, undefined, skipBar);
    // what animations name it by
    const xid = a(k, "xml:id") || a(k, "draw:id");
    if (!xid) continue;
    if (out.elements.length > n) out.ids!.set(xid, out.elements[n].id);
    else if (out.title !== t) out.ids!.set(xid, "title");
    else if (out.body !== b) out.ids!.set(xid, "body");
  }
  return out;
}

/** Animations another application wrote (ODF SMIL) onto the slide's objects, title and body. */
function applySmil(s: Slide, page: XEl, ids: Map<string, string>) {
  const by = readSmil(page, (id) => ids.get(id));
  for (const [key, list] of by) {
    const [first, ...rest] = list;
    if (key === "title") Object.assign(s, { tanim: first, ...(rest.length ? { tfx: rest } : {}) });
    else if (key === "body") Object.assign(s, { banim: first, ...(rest.length ? { bfx: rest } : {}) });
    else {
      const e = s.elements.find((x) => x.id === key);
      if (e) Object.assign(e, { anim: first, ...(rest.length ? { fx: rest } : {}) });
    }
  }
}

function bgOf(c: Ctx, p: Props): Promise<Pick<Slide, "bg" | "bgImg" | "bgGrad">> | Pick<Slide, "bg" | "bgImg" | "bgGrad"> {
  const kind = p["draw:fill"];
  if (kind === "gradient") {
    const g = gradientOf(c, p["draw:fill-gradient-name"]);
    if (g) return { bg: g.stops[0].color, bgImg: "", bgGrad: g };
  }
  if (kind === "bitmap") {
    return pictureUrl(c, c.ss.fillImages.get(p["draw:fill-image-name"] || "")).then((url) => ({ bg: "", bgImg: url || "" }));
  }
  if (kind === "solid" || (kind === undefined && p["draw:fill-color"])) return { bg: hexOf(p["draw:fill-color"]) || "", bgImg: "" };
  return { bg: "", bgImg: "" };
}

export async function importOdp(buf: ArrayBuffer | Uint8Array): Promise<ImportedDeck> {
  const zip = await JSZip.loadAsync(buf);
  const contentXml = await zip.file("content.xml")?.async("string");
  if (!contentXml) throw new Error("This is not an OpenDocument presentation (content.xml is missing).");
  const content = parseXml(contentXml, { mixed: true });
  const stylesXml = await zip.file("styles.xml")?.async("string");
  const styles = stylesXml ? parseXml(stylesXml, { mixed: true }) : undefined;
  const metaXml = await zip.file("meta.xml")?.async("string");
  const meta = metaXml ? parseXml(metaXml) : undefined;
  const ss = new StyleSheet();
  ss.read(styles);
  ss.read(content);
  const user = new Map(descendants(meta, "user-defined").map((u) => [a(u, "meta:name") || "", u.text]));
  const themeId = user.get("SynergyTheme") && themeById(user.get("SynergyTheme")!) ? user.get("SynergyTheme")! : "plain";
  const colors = user.get("SynergyColors") ? themeColors((() => { try { return JSON.parse(user.get("SynergyColors")!); } catch { return undefined; } })()) : undefined;
  const theme = themeById(themeId)!;
  const ours = user.has("SynergyTheme");
  const pres = descendants(content, "presentation")[0];
  const pages = kids(pres, "page");
  const firstMaster = ss.masters.get(a(pages[0], "draw:master-page-name") || "") || [...ss.masters.values()][0];
  const pl = ss.pageLayouts.get(firstMaster?.layout || "") || {};
  const w = Math.round(lenPx(pl["fo:page-width"]) ?? 1280), h = Math.round(lenPx(pl["fo:page-height"]) ?? 720);
  const c: Ctx = { zip, ss, warnings: new Set(), pics: new Map(), textColor: (colors?.text || theme.text).toUpperCase(), font: user.get("SynergyFont") || "" };
  // masters: ours carry their settings in meta and their objects on one master page per layout;
  // another application's master page objects become the slide master's (one master page) or sit behind each slide
  const masters: Masters = ours ? readMasters(json(user.get("SynergyMasters"))) : {};
  const masterPagesEl = new Map(descendants(styles, "master-page").map((m) => [a(m, "style:name") || "", m]));
  const foreignObjs = new Map<string, SlideElement[]>();
  if (ours) {
    const seen = new Set<string>();
    for (const mp of masterPagesEl.values()) {
      const key = a(mp, "syn:key") as MasterKey | undefined;
      if (!key) continue;
      const objs = await masterObjects(c, mp, !!theme.bar);
      for (const [dest, list] of [[masterKeyOf(key, masters), objs.master], [key, objs.layout]] as const) {
        if (!list.length) continue;
        const m = (masters[dest as MasterKey] ||= blankMaster(dest as MasterKey, masters));
        for (const e of list) if (!seen.has(`${dest}|${e.id}`)) (seen.add(`${dest}|${e.id}`), m.elements.push(e));
      }
    }
  } else {
    const used = new Set(pages.map((p) => a(p, "draw:master-page-name") || ""));
    for (const nm of used) {
      const mp = masterPagesEl.get(nm);
      if (!mp) continue;
      const objs = await masterObjects(c, mp, false);
      const all = [...objs.master, ...objs.layout];
      if (all.length) foreignObjs.set(nm, all);
    }
    if (foreignObjs.size === 1 && used.size === 1) {
      masters.master = { ...blankMaster("master", masters), elements: [...foreignObjs.values()][0] };
      foreignObjs.clear();
    }
  }
  const slides: Slide[] = [];
  for (const page of pages) {
    const dp = ss.props("drawing-page", a(page, "draw:style-name"), "page");
    const masterName = a(page, "draw:master-page-name") || "";
    const mp = ss.props("drawing-page", ss.masters.get(masterName)?.style, "page");
    const own = dp["draw:fill"] && dp["draw:fill"] !== "none" ? dp : mp;
    const bg = await bgOf(c, own);
    const out = await readPage(c, page, ours && !!theme.bar);
    const notesBox = descendants(child(page, "notes"), "frame").find((f) => a(f, "presentation:class") === "notes");
    const layout: Slide["layout"] = out.title !== undefined && out.body !== undefined ? (out.bodyClass === "subtitle" ? "title" : "content") : out.title !== undefined ? (out.bodyClass === undefined ? "titleOnly" : "content") : out.body !== undefined ? "content" : "blank";
    const s: Slide = {
      id: a(page, "syn:id") || genId(),
      title: out.title || "",
      body: out.body || "",
      notes: plainOf(child(notesBox, "text-box")),
      layout,
      bg: ours && bg.bg === (colors?.bg || theme.bg).toUpperCase() && !bg.bgImg ? "" : bg.bg,
      bgImg: bg.bgImg,
      ...(bg.bgGrad ? { bgGrad: bg.bgGrad } : {}),
      ...(out.tbox ? { tbox: out.tbox } : {}),
      ...(out.bbox ? { bbox: out.bbox } : {}),
      ...(out.tstyle && Object.keys(out.tstyle).length ? { tstyle: out.tstyle } : {}),
      ...(out.bstyle && Object.keys(out.bstyle).length ? { bstyle: out.bstyle } : {}),
      ...(out.body !== undefined && !out.bodyFit && ours ? { bodyFit: "none" as const } : {}),
      ...(dp["presentation:visibility"] === "hidden" ? { hidden: true } : {}),
      ...(a(page, "syn:section") ? { sec: a(page, "syn:section") } : {}),
      elements: out.elements,
    };
    if (ours) {
      // our own settings: the layout chosen, only the overrides the slide made (not what its layout resolved to)
      const p = slideProps(a(page, "syn:props"));
      if (p) {
        for (const k of ["tbox", "bbox", "tstyle", "bstyle", "bodyFit"] as const) delete s[k];
        if (!json(a(page, "syn:props")) || !(json(a(page, "syn:props")) as Record<string, unknown>).ownBg) {
          s.bg = "";
          s.bgImg = "";
          delete s.bgGrad;
        }
        Object.assign(s, p);
      }
    } else {
      if (dp["presentation:background-objects-visible"] === "false" && masters.master) s.hideUnder = true;
      const behind = foreignObjs.get(masterName);
      if (behind && dp["presentation:background-objects-visible"] !== "false") s.elements = [...behind.map((e, k) => ({ ...e, id: genId("e"), z: k + 1 - 20000 }) as SlideElement), ...s.elements];
      if (out.ids?.size) applySmil(s, page, out.ids);
    }
    slides.push(s);
  }
  if (!slides.length) throw new Error("This presentation has no slides.");
  const headFont = ours ? user.get("SynergyHeadFont") : undefined;
  const hf = ours ? json(user.get("SynergyHF")) : undefined;
  return {
    w,
    h,
    theme: themeId,
    ...(colors ? { colors } : {}),
    ...(c.font ? { font: c.font } : {}),
    ...(headFont ? { headFont } : {}),
    ...(cleanHf(hf) ? { hf: cleanHf(hf) } : {}),
    ...(Object.keys(masters).length ? { masters } : {}),
    slides,
    warnings: [...c.warnings],
  };
}
