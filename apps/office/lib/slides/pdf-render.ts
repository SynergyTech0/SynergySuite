// Draws a rendered slide (its live DOM, laid out at natural size) into PDF
// operations: backgrounds, borders and gradients of HTML boxes, SVG shapes
// and charts as vector paths, text as real PDF text in the standard fonts
// (each word placed where the browser laid it out, scaled to the same width),
// pictures as images, equations' fraction bars and radicals as lines, and
// links as annotations. Rotated or flipped objects keep their transform.
// Text the standard fonts cannot encode is drawn as a small picture instead.
import { IDENTITY, Ops, apply, isWinAnsi, mul, type Matrix, type PdfWriter, type RGB, type StdFont, type Stop } from "./pdf";
import { normalizePath } from "./svgpath";
import { parseD } from "./freeform";
import { TextFonts } from "./pdf-fonts";

export type PdfLink = { x: number; y: number; w: number; h: number; url: string };

type Ctx = {
  pdf: PdfWriter;
  ops: Ops;
  ox: number; // root's viewport offset
  oy: number;
  links: PdfLink[];
  images: Map<string, Promise<string | null>>;
  /** embedded font subsets for text outside WinAnsi */
  fonts?: TextFonts;
};

/** One set of embedded fonts per PDF (slides, notes and handouts share them). */
const TEXT_FONTS = new WeakMap<PdfWriter, TextFonts>();

const KAPPA = 0.5522847498;

// ---- colours ----

export function parseColor(v: string | null | undefined): { rgb: RGB; a: number } | null {
  if (!v || v === "none" || v === "transparent") return null;
  let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return a <= 0 ? null : { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a };
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (m) {
    const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
    return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], a: 1 };
  }
  return null;
}

/** Fill colour plus a transparency state when needed. */
function paint(c: Ctx, color: { rgb: RGB; a: number }, opacity: number, stroke = false) {
  if (stroke) c.ops.strokeColor(color.rgb);
  else c.ops.fillColor(color.rgb);
  const a = color.a * opacity;
  if (a < 0.999) c.ops.gs(stroke ? c.pdf.alpha(1, a) : c.pdf.alpha(a, 1));
}

// ---- fonts ----

const SERIF = /georgia|times|cambria|garamond|palatino|book antiqua|constantia|baskerville|didot|bodoni|serif/i;
export function stdFont(family: string, bold: boolean, italic: boolean): StdFont {
  const first = family.split(",")[0].replace(/['"]/g, "").trim().toLowerCase();
  const mono = /mono|courier|consolas|menlo/.test(first) || (first === "monospace");
  const serif = !mono && SERIF.test(first) && !/sans/.test(first);
  const base = mono ? "Courier" : serif ? "Times" : "Helvetica";
  if (base === "Times") return bold && italic ? "Times-BoldItalic" : bold ? "Times-Bold" : italic ? "Times-Italic" : "Times-Roman";
  const suffix = bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "";
  return `${base}${suffix}` as StdFont;
}
// families metric-compatible with the standard fonts, to measure what the PDF viewer will draw
const MEASURE: Record<string, string> = {
  Helvetica: "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif",
  Times: "'Times New Roman', 'Liberation Serif', Tinos, Times, serif",
  Courier: "'Courier New', 'Liberation Mono', Cousine, Courier, monospace",
};

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx2d(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  return measureCtx;
}
/** Width of text in a standard font at `size` px. */
export function stdWidth(font: StdFont, size: number, text: string): number {
  const fam = font.startsWith("Times") ? "Times" : font.startsWith("Courier") ? "Courier" : "Helvetica";
  const g = ctx2d();
  g.font = `${/Oblique|Italic/.test(font) ? "italic " : ""}${/Bold/.test(font) ? "bold " : ""}${size}px ${MEASURE[fam]}`;
  return g.measureText(text.replace(/−/g, "-")).width;
}
const metricCache = new Map<string, { asc: number; desc: number }>();
/** Ascent/descent of a CSS font at 1px, as the browser lays it out. */
function fontMetrics(cssFont: string): { asc: number; desc: number } {
  let m = metricCache.get(cssFont);
  if (!m) {
    const g = ctx2d();
    g.font = cssFont.replace(/(\d+(?:\.\d+)?)px/, "100px");
    const t = g.measureText("Hg");
    const asc = (t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent * 1.1) / 100;
    const desc = (t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent * 1.3) / 100;
    m = { asc: asc || 0.9, desc: desc || 0.22 };
    metricCache.set(cssFont, m);
  }
  return m;
}

// ---- geometry helpers ----

function parseMatrix(t: string): Matrix | null {
  if (!t || t === "none") return null;
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (m) {
    const v = m[1].split(",").map(Number);
    if (v.length === 6 && v.every(Number.isFinite)) return v as Matrix;
  }
  const m3 = /matrix3d\(([^)]+)\)/.exec(t);
  if (m3) {
    const v = m3[1].split(",").map(Number);
    return [v[0], v[1], v[4], v[5], v[12], v[13]];
  }
  return null;
}

function pathOps(ops: Ops, cmds: { c: string; p: number[] }[], m: Matrix) {
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const k of cmds) {
    const p = k.p;
    if (k.c === "M") {
      [cx, cy] = [p[0], p[1]];
      [sx, sy] = [cx, cy];
      ops.m(...apply(m, cx, cy));
    } else if (k.c === "L") {
      [cx, cy] = [p[0], p[1]];
      ops.l(...apply(m, cx, cy));
    } else if (k.c === "C") {
      const a = apply(m, p[0], p[1]), b = apply(m, p[2], p[3]), e = apply(m, p[4], p[5]);
      ops.c(a[0], a[1], b[0], b[1], e[0], e[1]);
      [cx, cy] = [p[4], p[5]];
    } else if (k.c === "Q") {
      const c1x = cx + (2 / 3) * (p[0] - cx), c1y = cy + (2 / 3) * (p[1] - cy);
      const c2x = p[2] + (2 / 3) * (p[0] - p[2]), c2y = p[3] + (2 / 3) * (p[1] - p[3]);
      const a = apply(m, c1x, c1y), b = apply(m, c2x, c2y), e = apply(m, p[2], p[3]);
      ops.c(a[0], a[1], b[0], b[1], e[0], e[1]);
      [cx, cy] = [p[2], p[3]];
    } else if (k.c === "Z") {
      ops.h();
      [cx, cy] = [sx, sy];
    }
  }
}

function ellipseCmds(cx: number, cy: number, rx: number, ry: number) {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { c: "M", p: [cx + rx, cy] },
    { c: "C", p: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
    { c: "C", p: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
    { c: "C", p: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
    { c: "C", p: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
    { c: "Z", p: [] },
  ];
}

const rectCmds = (x: number, y: number, w: number, h: number) => [
  { c: "M", p: [x, y] }, { c: "L", p: [x + w, y] }, { c: "L", p: [x + w, y + h] }, { c: "L", p: [x, y + h] }, { c: "Z", p: [] },
];

const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

// ---- gradients ----

/** A CSS linear-/radial-gradient() as a PDF shading clipped to a box. */
function cssGradient(c: Ctx, bg: string, x: number, y: number, w: number, h: number, opacity: number): boolean {
  const lin = /^(repeating-)?linear-gradient\((.*)\)$/s.exec(bg.trim());
  const rad = /^(repeating-)?radial-gradient\((.*)\)$/s.exec(bg.trim());
  const body = (lin || rad)?.[2];
  if (!body) return false;
  const parts = splitTop(body);
  let angle = 180;
  if (lin && /deg|turn|rad|^to /.test(parts[0])) {
    const p = parts.shift()!.trim();
    if (p.startsWith("to ")) angle = ({ "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 } as Record<string, number>)[p] ?? 180;
    else angle = /turn/.test(p) ? parseFloat(p) * 360 : /rad/.test(p) ? (parseFloat(p) * 180) / Math.PI : parseFloat(p);
  } else if (rad && !parseColor(parts[0].trim().split(/\s(?=[\d.]+%)/)[0])) parts.shift(); // shape/position
  const stops: Stop[] = [];
  parts.forEach((p, i) => {
    const mm = /^(.*?\))\s*([\d.]+)%?$|^(.*?)\s+([\d.]+)%$/.exec(p.trim());
    const col = parseColor((mm ? mm[1] || mm[3] : p).trim());
    if (!col) return;
    const pos = mm ? parseFloat(mm[2] ?? mm[4]) / 100 : parts.length > 1 ? i / (parts.length - 1) : 0;
    stops.push({ pos, color: col.rgb });
  });
  if (!stops.length) return false;
  let sh: string;
  if (lin) {
    const a = (angle * Math.PI) / 180;
    const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    const cx = x + w / 2, cy = y + h / 2;
    const dx = (Math.sin(a) * len) / 2, dy = (-Math.cos(a) * len) / 2;
    sh = c.pdf.shading("axial", [cx - dx, cy - dy, cx + dx, cy + dy], stops);
  } else {
    const r = Math.sqrt(w * w + h * h) / 2;
    sh = c.pdf.shading("radial", [x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, r], stops);
  }
  c.ops.save().rect(x, y, w, h).clip();
  if (opacity < 0.999) c.ops.gs(c.pdf.alpha(opacity));
  c.ops.shade(sh).restore();
  return true;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---- images ----

async function imagePixels(c: Ctx, src: CanvasImageSource, key: string, nw: number, nh: number, maxW: number, maxH: number): Promise<string | null> {
  const k = `${key}|${Math.round(maxW)}x${Math.round(maxH)}`;
  let p = c.images.get(k);
  if (!p) {
    p = (async () => {
      if (!nw || !nh) return null;
      // twice the drawn size (crisp when zoomed or printed), never more than the original
      const s = Math.min(1, Math.max((maxW * 2) / nw, (maxH * 2) / nh), 2400 / Math.max(nw, nh));
      const w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const g = cv.getContext("2d")!;
      try {
        g.drawImage(src, 0, 0, w, h);
        const data = g.getImageData(0, 0, w, h).data;
        let opaque = true;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
        if (opaque) {
          const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.9));
          if (blob) return c.pdf.jpeg(new Uint8Array(await blob.arrayBuffer()), w, h);
        }
        return c.pdf.rgba(data, w, h);
      } catch {
        return null; // tainted or undecodable
      }
    })();
    c.images.set(k, p);
  }
  return p;
}

/** Place an image XObject in the box (y-down space). */
const placeImage = (ops: Ops, name: string, x: number, y: number, w: number, h: number) => ops.save().cm([w, 0, 0, -h, x, y + h]).xobject(name).restore();

async function drawImg(c: Ctx, img: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, opacity: number) {
  const r = img.getBoundingClientRect();
  const x = r.left - c.ox, y = r.top - c.oy;
  const nw = img instanceof HTMLImageElement ? img.naturalWidth : img instanceof HTMLVideoElement ? img.videoWidth : img.width;
  const nh = img instanceof HTMLImageElement ? img.naturalHeight : img instanceof HTMLVideoElement ? img.videoHeight : img.height;
  if (!nw || !nh || r.width <= 0 || r.height <= 0) return;
  const key = img instanceof HTMLImageElement ? img.currentSrc || img.src : img instanceof HTMLVideoElement ? `video:${img.currentSrc}:${img.currentTime}` : `canvas:${Math.random()}`;
  const fit = getComputedStyle(img).objectFit;
  let dw = r.width, dh = r.height, dx = x, dy = y;
  if (fit === "cover" || fit === "contain") {
    const s = fit === "cover" ? Math.max(r.width / nw, r.height / nh) : Math.min(r.width / nw, r.height / nh);
    dw = nw * s;
    dh = nh * s;
    dx = x + (r.width - dw) / 2;
    dy = y + (r.height - dh) / 2;
  }
  const name = await imagePixels(c, img, key, nw, nh, dw, dh);
  if (!name) return;
  c.ops.save().rect(x, y, r.width, r.height).clip();
  if (opacity < 0.999) c.ops.gs(c.pdf.alpha(opacity));
  placeImage(c.ops, name, dx, dy, dw, dh);
  c.ops.restore();
}

// ---- shadows (soft, so drawn as pictures, as PowerPoint's own PDFs do) ----

export type DropShadow = { dx: number; dy: number; blur: number; color: string };

/** The shadows of a computed `text-shadow` or `filter: drop-shadow(...)` value. */
export function parseShadows(v: string | null | undefined): DropShadow[] {
  if (!v || v === "none") return [];
  const out: DropShadow[] = [];
  const body = v.includes("drop-shadow(") ? [...v.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1]) : splitTop(v);
  for (const part of body) {
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b(?!\())/i.exec(part.replace(/[\d.-]+px/g, ""))?.[1] || "rgba(0, 0, 0, 1)";
    const nums = [...part.replace(/(rgba?|hsla?)\([^)]*\)/g, "").matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]));
    if (nums.length < 2) continue;
    out.push({ dx: nums[0], dy: nums[1], blur: Math.max(0, nums[2] || 0), color });
  }
  return out;
}

/**
 * A soft shadow drawn as a picture under the object: `draw` paints the
 * object's silhouette in a w x h box, and the canvas keeps only its shadow.
 */
async function rasterShadow(c: Ctx, sh: DropShadow, x: number, y: number, w: number, h: number, opacity: number, draw: (g: CanvasRenderingContext2D) => void | Promise<void>) {
  const col = parseColor(sh.color);
  if (!col || col.a <= 0 || w <= 0 || h <= 0) return;
  const k = 2;
  const pad = Math.ceil(sh.blur * 2 + Math.max(Math.abs(sh.dx), Math.abs(sh.dy)) + 2);
  const cw = Math.ceil((w + pad * 2) * k), ch = Math.ceil((h + pad * 2) * k);
  if (cw * ch > 16e6) return;
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext("2d")!;
  // the object is drawn off the canvas; only its shadow, offset back, lands on it
  const off = w + pad * 2 + 10;
  g.shadowColor = sh.color;
  g.shadowBlur = sh.blur * k;
  g.shadowOffsetX = (off + sh.dx) * k;
  g.shadowOffsetY = sh.dy * k;
  g.scale(k, k);
  g.translate(pad - off, pad);
  try {
    await draw(g);
    const name = c.pdf.rgba(g.getImageData(0, 0, cw, ch).data, cw, ch);
    c.ops.save();
    if (opacity < 0.999) c.ops.gs(c.pdf.alpha(opacity));
    placeImage(c.ops, name, x - pad, y - pad, cw / k, ch / k);
    c.ops.restore();
  } catch {
    /* a picture from another site can't be read back: no shadow */
  }
}

/** An SVG drawing as an image (for its shadow). */
async function svgImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(w));
  copy.setAttribute("height", String(h));
  copy.style.filter = "";
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    return im;
  } catch {
    return null;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Shadows of an element's own `filter: drop-shadow()`, drawn before it. */
async function elementShadows(c: Ctx, el: Element, cs: CSSStyleDeclaration, opacity: number) {
  const shadows = parseShadows(cs.filter);
  if (!shadows.length || (el as HTMLElement).dataset?.textLayer !== undefined) return;
  const r = el.getBoundingClientRect();
  const x = r.left - c.ox, y = r.top - c.oy;
  let draw: ((g: CanvasRenderingContext2D) => void) | null = null;
  if (el instanceof SVGSVGElement) {
    const im = await svgImage(el, r.width, r.height);
    if (im) draw = (g) => g.drawImage(im, 0, 0, r.width, r.height);
  } else if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) draw = (g) => g.drawImage(el, 0, 0, r.width, r.height);
  else draw = (g) => { g.fillStyle = "#000"; g.fillRect(0, 0, r.width, r.height); };
  if (draw) for (const sh of shadows) await rasterShadow(c, sh, x, y, r.width, r.height, opacity, draw);
}

/** Text shadows (and glows) for a run of text: its own text-shadow, or its WordArt layer's drop shadow. */
function textShadowsOf(el: Element): DropShadow[] {
  const own = parseShadows(getComputedStyle(el).textShadow);
  if (own.length) return own;
  const layer = el.closest("[data-text-layer]");
  return layer ? parseShadows(getComputedStyle(layer).filter) : [];
}

/** Gradient-filled text (WordArt): the gradient and the box it spans. */
function textGradientOf(el: Element): { img: string; r: DOMRect } | null {
  for (let n: Element | null = el, i = 0; n && i < 8; n = n.parentElement, i++) {
    const cs = getComputedStyle(n);
    const clip = cs.backgroundClip || cs.getPropertyValue("-webkit-background-clip");
    if (clip === "text" && /gradient\(/.test(cs.backgroundImage)) return { img: cs.backgroundImage, r: n.getBoundingClientRect() };
  }
  return null;
}

// ---- text ----

/** Draw a run of text the standard fonts cannot encode as a picture of itself. */
async function rasterText(c: Ctx, text: string, cssFont: string, color: string, x: number, y: number, w: number, h: number, asc: number, opacity: number) {
  const k = 3;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(w * k) + 4);
  cv.height = Math.max(1, Math.ceil(h * k));
  const g = cv.getContext("2d")!;
  g.scale(k, k);
  g.font = cssFont;
  g.fillStyle = color;
  g.textBaseline = "alphabetic";
  g.fillText(text, 0, asc);
  const name = c.pdf.rgba(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
  c.ops.save();
  if (opacity < 0.999) c.ops.gs(c.pdf.alpha(opacity));
  placeImage(c.ops, name, x, y, cv.width / k, cv.height / k);
  c.ops.restore();
}

function decorationOf(el: Element): { under: boolean; strike: boolean } {
  let under = false, strike = false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const d = cs.textDecorationLine || cs.textDecoration || "";
    if (/underline/.test(d)) under = true;
    if (/line-through/.test(d)) strike = true;
    if (cs.display !== "inline" && cs.display !== "contents") break;
  }
  return { under, strike };
}

const italicMath = (el: Element, text: string) => el.localName === "mi" && [...text.trim()].length === 1 && el.getAttribute("mathvariant") !== "normal";

/** The first colour of a CSS gradient (pictures of gradient text). */
function firstGradientColor(img: string): string | null {
  return /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(img)?.[1] || null;
}

async function drawTextNode(c: Ctx, node: Text, opacity: number) {
  const el = node.parentElement;
  if (!el) return;
  const raw = node.data;
  if (!raw.trim()) return;
  const cs = getComputedStyle(el);
  const color = parseColor(cs.color);
  if (!color) return;
  const size = parseFloat(cs.fontSize) || 16;
  const bold = (parseInt(cs.fontWeight) || 400) >= 600;
  const italic = /italic|oblique/.test(cs.fontStyle) || italicMath(el, raw);
  const font = stdFont(cs.fontFamily, bold, italic);
  const key = c.pdf.font(font);
  const cssFont = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  const met = fontMetrics(cssFont);
  const deco = decorationOf(el);
  const link = el.closest("a[href]")?.getAttribute("href") || "";
  const grad = textGradientOf(el);
  const shadows = textShadowsOf(el);
  const upper = cs.textTransform === "uppercase", lower = cs.textTransform === "lowercase";
  const range = document.createRange();
  const words: { s: number; e: number }[] = [];
  for (const m of raw.matchAll(/\S+/g)) words.push({ s: m.index!, e: m.index! + m[0].length });
  for (const wd of words) {
    range.setStart(node, wd.s);
    range.setEnd(node, wd.e);
    let rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    let pieces: { text: string; r: DOMRect }[];
    if (rects.length <= 1) pieces = rects.length ? [{ text: raw.slice(wd.s, wd.e), r: rects[0] }] : [];
    else {
      // a word broken across lines: place it character by character
      pieces = [];
      for (let i = wd.s; i < wd.e; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        rects = [...range.getClientRects()].filter((r) => r.width > 0);
        if (rects[0]) pieces.push({ text: raw[i], r: rects[0] });
      }
    }
    for (const { text: t0, r } of pieces) {
      const text = upper ? t0.toUpperCase() : lower ? t0.toLowerCase() : t0;
      const s = r.height / ((met.asc + met.desc) * size) || 1; // scale applied by transforms (shrink to fit, thumbnails)
      const fs = size * s;
      const x = r.left - c.ox, top = r.top - c.oy;
      const base = top + met.asc * fs;
      const runFont = cssFont.replace(/[\d.]+px/, `${fs}px`);
      for (const sh of shadows)
        await rasterShadow(c, sh, x, top, r.width, r.height, opacity, (g) => {
          g.font = runFont;
          g.fillStyle = "#000";
          g.textBaseline = "alphabetic";
          g.fillText(text, 0, met.asc * fs, r.width + 1);
        });
      // gradient-filled text: the letters clip the gradient (text render mode 7)
      const fill = () => {
        if (grad) c.ops.push("7 Tr");
        else paint(c, color, opacity);
      };
      const fillGradient = () => {
        if (grad) cssGradient(c, grad.img, grad.r.left - c.ox, grad.r.top - c.oy, grad.r.width, grad.r.height, opacity);
      };
      if (isWinAnsi(text)) {
        const natural = stdWidth(font, fs, text);
        const hs = natural > 0 ? Math.max(40, Math.min(250, (r.width / natural) * 100)) : 100;
        c.ops.save();
        fill();
        c.ops.text(key, fs, [1, 0, 0, -1, x, base], text, Math.abs(hs - 100) < 0.5 ? 100 : hs);
        fillGradient();
        c.ops.restore();
      } else {
        // as text in an embedded font subset when a font covers it, else as a picture
        const g = await c.fonts?.encode(text, cs.fontFamily, bold, italic).catch(() => null);
        if (g) {
          const natural = g.width * fs;
          const hs = natural > 0 ? Math.max(40, Math.min(250, (r.width / natural) * 100)) : 100;
          c.ops.save();
          fill();
          c.ops.glyphs(g.key, fs, [1, 0, 0, -1, x, base], g.cids, Math.abs(hs - 100) < 0.5 ? 100 : hs);
          fillGradient();
          c.ops.restore();
        } else await rasterText(c, text, runFont, grad ? firstGradientColor(grad.img) || cs.color : cs.color, x, top, r.width, r.height, met.asc * fs, opacity);
      }
      if (deco.under || deco.strike) {
        const th = Math.max(0.5, fs * 0.06);
        c.ops.save();
        paint(c, color, opacity);
        if (deco.under) c.ops.rect(x, base + fs * 0.1, r.width, th).fill();
        if (deco.strike) c.ops.rect(x, base - fs * 0.28, r.width, th).fill();
        c.ops.restore();
      }
      if (link) c.links.push({ x, y: top, w: r.width, h: r.height, url: link });
    }
  }
}

// ---- SVG ----

function svgPaint(c: Ctx, el: SVGGraphicsElement, cmds: { c: string; p: number[] }[], m: Matrix, opacity: number, open = false) {
  const cs = getComputedStyle(el);
  const op = opacity * (parseFloat(cs.opacity) || (cs.opacity === "0" ? 0 : 1));
  if (op <= 0.001) return;
  const fillRaw = cs.fill;
  const stroke = parseColor(cs.stroke);
  const sw = parseFloat(cs.strokeWidth) || 0;
  const fillA = parseFloat(cs.fillOpacity);
  const strokeA = parseFloat(cs.strokeOpacity);
  const urlM = /url\(["']?#([^"')]+)["']?\)/.exec(fillRaw || "");
  if (urlM && !open) {
    const g = el.ownerDocument.getElementById(urlM[1]);
    if (g && (g.localName === "linearGradient" || g.localName === "radialGradient")) {
      const stops: Stop[] = [...g.querySelectorAll("stop")].map((s) => {
        const sc = getComputedStyle(s);
        const off = s.getAttribute("offset") || "0";
        return { pos: off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off), color: parseColor(sc.stopColor || s.getAttribute("stop-color"))?.rgb || [0, 0, 0] };
      });
      if (stops.length) {
        const bb = el.getBBox();
        const num = (a: string, d: number) => {
          const v = g.getAttribute(a);
          if (v == null) return d;
          return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
        };
        const P = (fx: number, fy: number) => apply(m, bb.x + fx * bb.width, bb.y + fy * bb.height);
        let sh: string;
        if (g.localName === "linearGradient") {
          const a = P(num("x1", 0), num("y1", 0)), b = P(num("x2", 1), num("y2", 0));
          sh = c.pdf.shading("axial", [a[0], a[1], b[0], b[1]], stops);
        } else {
          const ctr = P(num("cx", 0.5), num("cy", 0.5));
          const r = num("r", 0.5) * Math.max(bb.width, bb.height) * scaleOf(m);
          sh = c.pdf.shading("radial", [ctr[0], ctr[1], 0, ctr[0], ctr[1], r], stops);
        }
        c.ops.save();
        pathOps(c.ops, cmds, m);
        c.ops.clip(cs.fillRule === "evenodd");
        if (op < 0.999) c.ops.gs(c.pdf.alpha(op));
        c.ops.shade(sh).restore();
      }
    }
  }
  const fill = urlM || open ? null : parseColor(fillRaw);
  const doStroke = !!stroke && sw > 0;
  if (!fill && !doStroke) return;
  c.ops.save();
  if (fill) {
    c.ops.fillColor(fill.rgb);
  }
  if (doStroke) {
    c.ops.strokeColor(stroke!.rgb).lineWidth(sw * scaleOf(m));
    c.ops.cap(cs.strokeLinecap === "round" ? "round" : cs.strokeLinecap === "square" ? "square" : "butt");
    c.ops.join(cs.strokeLinejoin === "round" ? "round" : cs.strokeLinejoin === "bevel" ? "bevel" : "miter");
    const dash = (cs.strokeDasharray || "none") === "none" ? [] : cs.strokeDasharray.split(/[\s,]+/).map((v) => parseFloat(v) * scaleOf(m)).filter((v) => v >= 0);
    if (dash.length) c.ops.dash(dash);
  }
  const fa = fill ? fill.a * (Number.isFinite(fillA) ? fillA : 1) * op : 1;
  const sa = doStroke ? stroke!.a * (Number.isFinite(strokeA) ? strokeA : 1) * op : 1;
  if (fa < 0.999 || sa < 0.999) c.ops.gs(c.pdf.alpha(fa, sa));
  pathOps(c.ops, cmds, m);
  if (fill && doStroke) c.ops.push(cs.fillRule === "evenodd" ? "B*" : "B");
  else if (fill) c.ops.fill(cs.fillRule === "evenodd");
  else c.ops.stroke();
  c.ops.restore();
  // arrowhead (marker-end): a triangle along the last segment
  const marker = /url\(["']?#([^"')]+)["']?\)/.exec(cs.markerEnd || el.getAttribute("marker-end") || "");
  if (marker && doStroke) {
    const pts = cmds.filter((k) => k.p.length).map((k) => k.p.slice(-2) as [number, number]);
    const ctrl = cmds[cmds.length - 1];
    const end = pts[pts.length - 1];
    const prev = ctrl?.c === "C" ? [ctrl.p[2], ctrl.p[3]] : pts[pts.length - 2];
    if (end && prev) {
      const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
      const u = sw / 2; // marker viewBox unit: markerWidth 5 strokes over 10 units
      const loc = (mx: number, my: number): [number, number] => {
        const lx = (mx - 8) * u, ly = (my - 5) * u;
        return [end[0] + lx * Math.cos(ang) - ly * Math.sin(ang), end[1] + lx * Math.sin(ang) + ly * Math.cos(ang)];
      };
      const tri = [loc(0, 0), loc(10, 5), loc(0, 10)];
      c.ops.save().fillColor(stroke!.rgb);
      if (sa < 0.999) c.ops.gs(c.pdf.alpha(sa));
      pathOps(c.ops, [{ c: "M", p: tri[0] }, { c: "L", p: tri[1] }, { c: "L", p: tri[2] }, { c: "Z", p: [] }], m);
      c.ops.fill().restore();
    }
  }
}

function localMatrix(el: SVGGraphicsElement): Matrix {
  const t = el.transform?.baseVal;
  const mm = t && t.numberOfItems ? t.consolidate()?.matrix : null;
  return mm ? [mm.a, mm.b, mm.c, mm.d, mm.e, mm.f] : IDENTITY;
}

const SKIP_SVG = new Set(["defs", "title", "desc", "clipPath", "marker", "linearGradient", "radialGradient", "style", "mask", "pattern", "symbol", "metadata"]);

function svgText(el: SVGTextElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += (n as Text).data;
    else if ((n as Element).localName === "tspan") out += n.textContent || "";
  });
  return out;
}

async function walkSvg(c: Ctx, el: Element, parent: Matrix, opacity: number) {
  if (SKIP_SVG.has(el.localName)) return;
  const g = el as SVGGraphicsElement;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return;
  const m = mul(localMatrix(g), parent);
  const tag = el.localName;
  const n = (a: string) => parseFloat(el.getAttribute(a) || "0") || 0;
  if (tag === "g" || tag === "a" || tag === "svg") {
    const op = opacity * (tag === "svg" || cs.opacity === "" ? 1 : parseFloat(cs.opacity));
    const clip = /url\(["']?#([^"')]+)["']?\)/.exec(cs.clipPath || el.getAttribute("clip-path") || "");
    const cp = clip && el.ownerDocument.getElementById(clip[1]);
    const shape = cp?.querySelector("rect");
    if (shape) {
      const r = { x: parseFloat(shape.getAttribute("x") || "0"), y: parseFloat(shape.getAttribute("y") || "0"), w: parseFloat(shape.getAttribute("width") || "0"), h: parseFloat(shape.getAttribute("height") || "0") };
      c.ops.save();
      pathOps(c.ops, rectCmds(r.x, r.y, r.w, r.h), m);
      c.ops.clip();
    }
    for (const ch of [...el.children]) await walkSvg(c, ch, m, op);
    if (shape) c.ops.restore();
    return;
  }
  let cmds: { c: string; p: number[] }[] | null = null;
  let open = false;
  if (tag === "rect") {
    const x = n("x"), y = n("y"), w = n("width"), h = n("height");
    const rx = Math.min(n("rx") || n("ry"), w / 2), ry = Math.min(n("ry") || n("rx"), h / 2);
    if (w <= 0 || h <= 0) return;
    if (rx > 0) {
      const kx = rx * KAPPA, ky = ry * KAPPA;
      cmds = [
        { c: "M", p: [x + rx, y] }, { c: "L", p: [x + w - rx, y] }, { c: "C", p: [x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry] },
        { c: "L", p: [x + w, y + h - ry] }, { c: "C", p: [x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h] },
        { c: "L", p: [x + rx, y + h] }, { c: "C", p: [x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry] },
        { c: "L", p: [x, y + ry] }, { c: "C", p: [x, y + ry - ky, x + rx - kx, y, x + rx, y] }, { c: "Z", p: [] },
      ];
    } else cmds = rectCmds(x, y, w, h);
  } else if (tag === "circle") cmds = ellipseCmds(n("cx"), n("cy"), n("r"), n("r"));
  else if (tag === "ellipse") cmds = ellipseCmds(n("cx"), n("cy"), n("rx"), n("ry"));
  else if (tag === "line") {
    cmds = [{ c: "M", p: [n("x1"), n("y1")] }, { c: "L", p: [n("x2"), n("y2")] }];
    open = true;
  } else if (tag === "polyline" || tag === "polygon") {
    const v = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
    cmds = [];
    for (let i = 0; i + 1 < v.length; i += 2) cmds.push({ c: i ? "L" : "M", p: [v[i], v[i + 1]] });
    if (tag === "polygon") cmds.push({ c: "Z", p: [] });
  } else if (tag === "path") {
    cmds = parseD(normalizePath(el.getAttribute("d") || ""));
  } else if (tag === "text") {
    await drawSvgText(c, el as SVGTextElement, m, opacity);
    return;
  } else if (tag === "foreignObject") {
    for (const ch of [...el.children]) await walk(c, ch, opacity);
    return;
  } else if (tag === "image") {
    return;
  }
  if (cmds && cmds.length) svgPaint(c, g, cmds, m, opacity, open);
}

/** A paint server's first colour (gradient-filled text is drawn in it). */
function paintServerColor(el: Element, fill: string): ReturnType<typeof parseColor> {
  const id = /url\(["']?#([^"')]+)["']?\)/.exec(fill)?.[1];
  const stop = id ? el.ownerDocument.getElementById(id)?.querySelector("stop") : null;
  return stop ? parseColor(getComputedStyle(stop).stopColor || stop.getAttribute("stop-color") || "") : null;
}

/**
 * An SVG gradient paint server as a PDF shading over the element's box
 * (objectBoundingBox units unless the gradient says userSpaceOnUse); drawn
 * in the element's user space, after its text has set the clip.
 */
function svgGradientShade(c: Ctx, el: SVGGraphicsElement, fill: string, m: Matrix, opacity: number): boolean {
  const id = /url\(["']?#([^"')]+)["']?\)/.exec(fill)?.[1];
  const gr = id ? el.ownerDocument.getElementById(id) : null;
  if (!gr || (gr.localName !== "linearGradient" && gr.localName !== "radialGradient")) return false;
  const stops: Stop[] = [];
  for (const st of [...gr.querySelectorAll("stop")]) {
    const col = parseColor(getComputedStyle(st).stopColor || st.getAttribute("stop-color") || "");
    const o = st.getAttribute("offset") || "0";
    if (col) stops.push({ pos: Math.max(0, Math.min(1, o.endsWith("%") ? parseFloat(o) / 100 : parseFloat(o) || 0)), color: col.rgb });
  }
  if (!stops.length) return false;
  let bb: DOMRect;
  try {
    bb = el.getBBox() as DOMRect;
  } catch {
    return false;
  }
  const user = gr.getAttribute("gradientUnits") === "userSpaceOnUse";
  const num = (a: string, d: number, span: number, at: number) => {
    const v = gr.getAttribute(a);
    if (v === null) return user ? at + d * span : at + d * span;
    const n = v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
    return user ? (v.endsWith("%") ? at + n * span : n) : at + n * span;
  };
  const sh =
    gr.localName === "linearGradient"
      ? c.pdf.shading("axial", [num("x1", 0, bb.width, bb.x), num("y1", 0, bb.height, bb.y), num("x2", 1, bb.width, bb.x), num("y2", 0, bb.height, bb.y)], stops)
      : c.pdf.shading("radial", [num("cx", 0.5, bb.width, bb.x), num("cy", 0.5, bb.height, bb.y), 0, num("cx", 0.5, bb.width, bb.x), num("cy", 0.5, bb.height, bb.y), (num("r", 0.5, Math.hypot(bb.width, bb.height) / Math.SQRT2, 0))], stops);
  c.ops.save().cm(m);
  if (opacity < 0.999) c.ops.gs(c.pdf.alpha(opacity));
  c.ops.shade(sh).restore();
  return true;
}

async function drawSvgText(c: Ctx, el: SVGTextElement, m: Matrix, opacity: number) {
  const text = svgText(el).replace(/\s+/g, " ").trim();
  if (!text) return;
  const cs = getComputedStyle(el);
  const color = parseColor(cs.fill) || paintServerColor(el, cs.fill);
  if (!color) return;
  // gradient fill (WordArt): the letters clip the gradient
  const gradFill = /url\(/.test(cs.fill) && !!el.ownerDocument.getElementById(/url\(["']?#([^"')]+)/.exec(cs.fill)?.[1] || "")?.localName.endsWith("Gradient");
  const op = opacity * (cs.opacity === "" ? 1 : parseFloat(cs.opacity));
  const fillPaint = () => (gradFill ? c.ops.push("7 Tr") : paint(c, color, op));
  const fillGrad = () => {
    if (gradFill) svgGradientShade(c, el, cs.fill, m, op);
  };
  const size = parseFloat(cs.fontSize) || 12;
  const bold = (parseInt(cs.fontWeight) || 400) >= 600;
  const font = stdFont(cs.fontFamily, bold, /italic|oblique/.test(cs.fontStyle));
  // text on a path (WordArt Transform): each character where and as turned as the browser laid it out
  if (el.querySelector("textPath") && isWinAnsi(text)) {
    const n = el.getNumberOfChars();
    c.ops.save();
    fillPaint();
    for (let i = 0; i < n; i++) {
      const ch = (el.textContent || "").replace(/\s+/g, " ").trim()[i];
      if (!ch || ch === " ") continue;
      let p: DOMPoint, r: number, wd: number;
      try {
        p = el.getStartPositionOfChar(i);
        r = (el.getRotationOfChar(i) * Math.PI) / 180;
        wd = el.getSubStringLength(i, 1);
      } catch {
        continue;
      }
      const natural = stdWidth(font, size, ch);
      const hs = natural > 0 && wd > 0 ? Math.max(40, Math.min(250, (wd / natural) * 100)) : 100;
      const tm = mul([Math.cos(r), Math.sin(r), Math.sin(r), -Math.cos(r), p.x, p.y], m);
      c.ops.text(c.pdf.font(font), size, tm, ch, Math.abs(hs - 100) < 0.5 ? 100 : hs);
    }
    fillGrad();
    c.ops.restore();
    return;
  }
  const x = el.x.baseVal.numberOfItems ? el.x.baseVal.getItem(0).value : 0;
  const y = el.y.baseVal.numberOfItems ? el.y.baseVal.getItem(0).value : 0;
  let len = 0;
  try {
    len = el.getComputedTextLength();
  } catch {
    len = stdWidth(font, size, text);
  }
  const anchor = cs.textAnchor;
  const sx = anchor === "middle" ? x - len / 2 : anchor === "end" ? x - len : x;
  const tm = mul([1, 0, 0, -1, sx, y], m);
  if (isWinAnsi(text)) {
    const natural = stdWidth(font, size, text);
    const hs = natural > 0 ? Math.max(40, Math.min(250, (len / natural) * 100)) : 100;
    c.ops.save();
    fillPaint();
    c.ops.text(c.pdf.font(font), size, tm, text, Math.abs(hs - 100) < 0.5 ? 100 : hs);
    fillGrad();
    c.ops.restore();
  } else {
    const met = fontMetrics(`${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`);
    c.ops.save().cm(m);
    await rasterText(c, text, `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`, cs.fill, sx, y - met.asc * size, len, (met.asc + met.desc) * size, met.asc * size, opacity);
    c.ops.restore();
  }
}

async function drawSvgRoot(c: Ctx, svg: SVGSVGElement, opacity: number) {
  const r = svg.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const vb = svg.viewBox?.baseVal;
  const vw = vb && vb.width ? vb.width : r.width, vh = vb && vb.height ? vb.height : r.height;
  let s = Math.min(r.width / vw, r.height / vh);
  if (!Number.isFinite(s) || s <= 0) s = 1;
  // xMidYMid meet
  const ex = r.left - c.ox + (r.width - vw * s) / 2 - (vb?.x || 0) * s;
  const ey = r.top - c.oy + (r.height - vh * s) / 2 - (vb?.y || 0) * s;
  const base: Matrix = [s, 0, 0, s, ex, ey];
  const cs = getComputedStyle(svg);
  const bg = parseColor(cs.backgroundColor);
  if (bg) {
    c.ops.save();
    paint(c, bg, opacity);
    c.ops.rect(r.left - c.ox, r.top - c.oy, r.width, r.height).fill().restore();
  }
  for (const ch of [...svg.children]) await walkSvg(c, ch, base, opacity);
}

// ---- MathML extras: fraction bars and radicals ----

function mathExtras(c: Ctx, el: Element, opacity: number) {
  const tag = el.localName;
  if (tag !== "mfrac" && tag !== "msqrt" && tag !== "mroot") return;
  const cs = getComputedStyle(el);
  const color = parseColor(cs.color);
  if (!color) return;
  const size = parseFloat(cs.fontSize) || 16;
  const r = el.getBoundingClientRect();
  const t = Math.max(0.6, size * 0.06);
  c.ops.save();
  paint(c, color, opacity);
  if (tag === "mfrac") {
    const lt = el.getAttribute("linethickness");
    const [a, b] = [el.children[0], el.children[1]];
    if (a && b && lt !== "0" && lt !== "0px") {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const y = (ra.bottom + rb.top) / 2 - c.oy;
      c.ops.rect(r.left - c.ox + 1, y - t / 2, r.width - 2, t).fill();
    }
  } else {
    const kids = tag === "mroot" ? [el.children[0]] : [...el.children];
    let left = Infinity, right = -Infinity;
    for (const k of kids) {
      if (!k) continue;
      const kr = k.getBoundingClientRect();
      left = Math.min(left, kr.left);
      right = Math.max(right, kr.right);
    }
    if (Number.isFinite(left)) {
      const top = r.top - c.oy + t, bottom = r.bottom - c.oy, x0 = r.left - c.ox;
      const lx = left - c.ox - size * 0.08;
      const start = tag === "mroot" ? Math.max(x0, lx - size * 0.55) : x0;
      c.ops.lineWidth(t).cap("round").join("round");
      paint(c, color, opacity, true);
      c.ops.m(start, bottom - (bottom - top) * 0.45).l(start + (lx - start) * 0.3, bottom - (bottom - top) * 0.5).l(start + (lx - start) * 0.6, bottom - t).l(lx, top).l(right - c.ox, top).stroke();
    }
  }
  c.ops.restore();
}

// ---- HTML ----

/**
 * A list item's marker as the browser draws it: the bullet character the
 * list style stands for (• disc, ◦ circle, ▪ square) or the number, in the
 * item's own font, ending where the item's text starts.
 */
async function listMarker(c: Ctx, li: HTMLElement, opacity: number) {
  const cs = getComputedStyle(li);
  const type = cs.listStyleType;
  if (!type || type === "none" || cs.display !== "list-item") return;
  const range = document.createRange();
  range.selectNodeContents(li);
  const first = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);
  if (!first) return;
  const color = parseColor(cs.color);
  if (!color) return;
  const size = parseFloat(cs.fontSize) || 16;
  const met = fontMetrics(`${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`);
  const s = first.height / ((met.asc + met.desc) * size) || 1;
  const fs = size * s;
  const lr = li.getBoundingClientRect();
  const base = first.top - c.oy + met.asc * fs;
  let text: string;
  if (/decimal|alpha|roman/.test(type)) {
    const idx = [...(li.parentElement?.children || [])].filter((x) => x.localName === "li").indexOf(li) + (Number((li.parentElement as HTMLOListElement | null)?.start) || 1);
    text = type.includes("alpha") ? `${String.fromCharCode((type.includes("upper") ? 64 : 96) + (((idx - 1) % 26) + 1))}.` : type.includes("roman") ? `${roman(idx, type.includes("upper"))}.` : `${idx}.`;
  } else text = type === "circle" ? "\u25e6" : type === "square" ? "\u25aa" : "\u2022";
  const bold = (parseInt(cs.fontWeight) || 400) >= 600, italic = /italic|oblique/.test(cs.fontStyle);
  // the marker box ends at the item's start; its width is the marker and a space, as laid out
  const g = ctx2d();
  g.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  const w = g.measureText(text).width;
  const x = lr.left - c.ox - g.measureText(`${text} `).width;
  c.ops.save();
  paint(c, color, opacity);
  if (isWinAnsi(text)) {
    const font = stdFont(cs.fontFamily, bold, italic);
    const natural = stdWidth(font, fs, text);
    const hs = natural > 0 && w > 0 ? Math.max(40, Math.min(250, (w / natural) * 100)) : 100;
    c.ops.text(c.pdf.font(font), fs, [1, 0, 0, -1, x, base], text, Math.abs(hs - 100) < 0.5 ? 100 : hs);
  } else {
    const glyphs = await c.fonts?.encode(text, cs.fontFamily, bold, italic).catch(() => null);
    if (glyphs) {
      const natural = glyphs.width * fs;
      const hs = natural > 0 && w > 0 ? Math.max(40, Math.min(250, (w / natural) * 100)) : 100;
      c.ops.glyphs(glyphs.key, fs, [1, 0, 0, -1, x, base], glyphs.cids, Math.abs(hs - 100) < 0.5 ? 100 : hs);
    } else {
      // no font with the glyph: its shape, at the size fonts draw it (about a third of the x-height box)
      const d = Math.max(1, fs * 0.3), cx = x + w / 2, cy = base - fs * 0.33;
      if (text === "\u25aa") c.ops.rect(cx - d / 2, cy - d / 2, d, d).fill();
      else {
        pathOps(c.ops, ellipseCmds(cx, cy, d / 2, d / 2), IDENTITY);
        c.ops.lineWidth(Math.max(0.5, fs * 0.05));
        paint(c, color, opacity, true);
        c.ops.stroke();
      }
    }
  }
  c.ops.restore();
}
function roman(n: number, upper: boolean): string {
  const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return upper ? out.toUpperCase() : out;
}

function boxDecor(c: Ctx, el: HTMLElement, cs: CSSStyleDeclaration, opacity: number) {
  const inline = cs.display === "inline";
  const rects = inline ? [...el.getClientRects()] : [el.getBoundingClientRect()];
  // a background clipped to the text is the text's fill (drawn with the text)
  const textClip = (cs.backgroundClip || cs.getPropertyValue("-webkit-background-clip")) === "text";
  const bg = textClip ? null : parseColor(cs.backgroundColor);
  const img = textClip ? "none" : cs.backgroundImage;
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    const x = r.left - c.ox, y = r.top - c.oy;
    if (bg) {
      c.ops.save();
      paint(c, bg, opacity);
      c.ops.rect(x, y, r.width, r.height).fill().restore();
    }
    if (img && img !== "none" && /gradient\(/.test(img)) cssGradient(c, img, x, y, r.width, r.height, opacity);
  }
  if (inline) return;
  const r = rects[0];
  if (!r || r.width <= 0 || r.height <= 0) return;
  const x = r.left - c.ox, y = r.top - c.oy;
  const sides: [string, number, number, number, number][] = [
    ["Top", x, y, r.width, 0],
    ["Right", x + r.width, y, 0, r.height],
    ["Bottom", x, y + r.height, r.width, 0],
    ["Left", x, y, 0, r.height],
  ];
  for (const [side, sx, sy, w, h] of sides) {
    const bw = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
    const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
    const col = parseColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
    if (bw <= 0 || !col || style === "none" || style === "hidden") continue;
    c.ops.save();
    paint(c, col, opacity);
    // the border band lies inside the box
    if (side === "Top") c.ops.rect(sx, sy, w, bw);
    else if (side === "Bottom") c.ops.rect(sx, sy - bw, w, bw);
    else if (side === "Left") c.ops.rect(sx, sy, bw, h);
    else c.ops.rect(sx - bw, sy, bw, h);
    c.ops.fill().restore();
  }
}

async function walk(c: Ctx, el: Element, opacity: number) {
  if (el.nodeType !== 1) return;
  if (el instanceof SVGSVGElement) {
    const op = opacity * (getComputedStyle(el).opacity === "" ? 1 : parseFloat(getComputedStyle(el).opacity));
    await withTransform(c, el, async () => {
      await elementShadows(c, el, getComputedStyle(el), op);
      await drawSvgRoot(c, el, op);
    });
    return;
  }
  if (!(el instanceof HTMLElement) && !(el instanceof MathMLElement)) return;
  const cs = getComputedStyle(el);
  if (cs.display === "none") return;
  const op = opacity * (cs.opacity === "" ? 1 : parseFloat(cs.opacity));
  if (op <= 0.005) return;
  if (el.localName === "style" || el.localName === "script" || el.localName === "template") return;
  await withTransform(c, el, async () => {
    const hidden = cs.visibility === "hidden";
    if (!hidden) await elementShadows(c, el, cs, op);
    if (!hidden && el instanceof HTMLElement) boxDecor(c, el, cs, op);
    if (!hidden && (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement)) {
      if (el instanceof HTMLVideoElement && el.poster && el.readyState < 2) {
        const im = new Image();
        im.src = el.poster;
        await im.decode().catch(() => undefined);
        if (im.naturalWidth) {
          const r = el.getBoundingClientRect();
          const name = await imagePixels(c, im, el.poster, im.naturalWidth, im.naturalHeight, r.width, r.height);
          if (name) placeImage(c.ops, name, r.left - c.ox, r.top - c.oy, r.width, r.height);
        }
      } else await drawImg(c, el, op);
      return;
    }
    if (!hidden && el.localName === "li") await listMarker(c, el as HTMLElement, op);
    const clip = el instanceof HTMLElement && (cs.overflowX !== "visible" || cs.overflowY !== "visible") && el.parentElement;
    if (clip) {
      const r = el.getBoundingClientRect();
      c.ops.save().rect(r.left - c.ox, r.top - c.oy, r.width, r.height).clip();
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) {
        if (getComputedStyle(el).visibility !== "hidden") await drawTextNode(c, n as Text, op);
      } else if (n.nodeType === 1) await walk(c, n as Element, op);
    }
    if (!hidden) mathExtras(c, el, op);
    if (clip) c.ops.restore();
  });
}

/**
 * Elements rotated or flipped with a CSS transform are measured with the
 * transform removed and drawn inside the same transform (about the same
 * origin), so their text and shapes rotate with them. Plain scaling is left
 * in place: the measured boxes already include it.
 */
async function withTransform(c: Ctx, el: Element, draw: () => Promise<void> | void) {
  const cs = getComputedStyle(el);
  const m = parseMatrix(cs.transform);
  const rotates = m && (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 || m[0] < 0 || m[3] < 0);
  if (!m || !rotates) {
    await draw();
    return;
  }
  const st = (el as HTMLElement | SVGElement).style;
  const prev = st.transform;
  const prevAnim = st.animation;
  st.transform = "none";
  st.animation = "none";
  try {
    const r = el.getBoundingClientRect();
    const [ox, oy] = (cs.transformOrigin || "50% 50%").split(" ").map((v, i) => (v.endsWith("%") ? (parseFloat(v) / 100) * (i ? r.height : r.width) : parseFloat(v) || 0));
    const px = r.left - c.ox + ox, py = r.top - c.oy + oy;
    const full = mul(mul([1, 0, 0, 1, -px, -py], m), [1, 0, 0, 1, px, py]);
    c.ops.save().cm(full);
    await draw();
    c.ops.restore();
  } finally {
    st.transform = prev;
    st.animation = prevAnim;
  }
}

/**
 * Draw a slide's DOM (`root` at its natural size, untransformed) as a PDF form
 * XObject of w x h units. Returns the form's resource name and the slide's links.
 */
export async function slideForm(pdf: PdfWriter, root: HTMLElement, w: number, h: number, images: Map<string, Promise<string | null>> = new Map()): Promise<{ form: string; links: PdfLink[] }> {
  const rr = root.getBoundingClientRect();
  let fonts = TEXT_FONTS.get(pdf);
  if (!fonts) TEXT_FONTS.set(pdf, (fonts = new TextFonts(pdf)));
  const c: Ctx = { pdf, ops: new Ops(), ox: rr.left, oy: rr.top, links: [], images, fonts };
  c.ops.save().rect(0, 0, w, h).clip();
  await walk(c, root, 1);
  c.ops.restore();
  return { form: pdf.form(c.ops.toString(), w, h), links: c.links };
}
