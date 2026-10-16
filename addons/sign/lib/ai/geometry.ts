/**
 * Where can a person write on this page? Geometry, not guesses.
 *
 * Text extraction only finds typed underscore rules ("Signature: ______"). Most real contracts mark
 * the place to sign differently: a DRAWN line (Word and Google Docs exports), an outlined BOX on a
 * form, a CHECKBOX square, or — on a scan — pixels with no text layer at all. All of those were
 * invisible to the old pipeline, so the model guessed coordinates and landed 13-43pt off.
 *
 * This module finds them from the PDF's own drawing operations (exact), or from the rendered pixels
 * when the page is a scan, and renders each page with a numbered marker on every candidate so the
 * model can SEE which marker is which ("Set-of-Mark" prompting). The model only decides what each
 * marker is and whose; the geometry here decides where the field goes.
 *
 * All coordinates: PDF points, TOP-LEFT origin (what DocumentField stores).
 */
import * as fs from "fs";
import * as path from "path";
import type { DocumentLayout, FieldAnchor, TextRun } from "./extract";

export type AnchorKind = "rule" | "line" | "box" | "checkbox";

interface Seg { x0: number; x1: number; y: number }
interface Rect { x: number; y: number; w: number; h: number; filled: boolean }

const MIN_LINE = 36;          // shorter than half an inch is decoration, not a place to sign
const MAX_ANCHORS_PER_PAGE = 60;

const mul = (m: number[], n: number[]) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Walk a page's drawing operations and collect painted horizontal segments and rectangles, in
 * top-left page points. Clip paths (ended without painting) are ignored.
 */
export async function extractGraphics(page: any, OPS: any): Promise<{ segs: Seg[]; rects: Rect[] }> {
  const vp = page.getViewport({ scale: 1 });
  const toTop = (x: number, y: number) => vp.convertToViewportPoint(x, y) as [number, number];
  const ops = await page.getOperatorList();
  const segs: Seg[] = [];
  const rects: Rect[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let pendingSegs: Seg[] = [];
  let pendingRects: Omit<Rect, "filled">[] = [];

  const STROKE = new Set([OPS.stroke, OPS.closeStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill]);
  const BOTH = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      const [subOps, coords] = args as [number[], number[]];
      let k = 0;
      let sub: [number, number][] = [];
      const pt = (x: number, y: number) => toTop(...(apply(ctm, x, y) as [number, number]));
      // A finished subpath is either an axis-aligned rectangle (forms often draw boxes as four
      // lines, not with the rectangle operator) or a set of segments, of which only the long
      // horizontal ones matter.
      const finish = () => {
        const pts = sub.filter((p, i) => i === 0 || Math.abs(p[0] - sub[i - 1][0]) > 0.5 || Math.abs(p[1] - sub[i - 1][1]) > 0.5);
        if (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 0.5 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 0.5) pts.pop();
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const axisAligned = pts.length === 4 && pts.every((p, i) => {
          const q = pts[(i + 1) % 4];
          return Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5;
        });
        if (axisAligned && Math.max(...xs) - Math.min(...xs) > 2 && Math.max(...ys) - Math.min(...ys) > 2) {
          pendingRects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
        } else {
          for (let i = 1; i < pts.length; i++) {
            const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
            if (Math.abs(ay - by) <= 1 && Math.abs(bx - ax) >= MIN_LINE) pendingSegs.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y: (ay + by) / 2 });
          }
        }
        sub = [];
      };
      for (const op of subOps) {
        if (op === OPS.moveTo) { finish(); sub = [pt(coords[k++], coords[k++])]; }
        else if (op === OPS.lineTo) sub.push(pt(coords[k++], coords[k++]));
        else if (op === OPS.closePath) { if (sub.length) sub.push(sub[0]); finish(); }
        else if (op === OPS.rectangle) {
          finish();
          const x = coords[k++], y = coords[k++], w = coords[k++], h = coords[k++];
          const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => pt(px, py));
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          pendingRects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
        } else if (op === OPS.curveTo) { finish(); k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { finish(); k += 4; }
      }
      finish();
    } else if (STROKE.has(fn) || FILL.has(fn) || BOTH.has(fn)) {
      const filled = FILL.has(fn);
      segs.push(...pendingSegs);
      rects.push(...pendingRects.map(r => ({ ...r, filled })));
      pendingSegs = []; pendingRects = [];
    } else if (fn === OPS.endPath) {
      pendingSegs = []; pendingRects = []; // a clip path: never painted
    }
  }
  return { segs, rects };
}

/** Text near an anchor: what is written beside, under or over it. */
function contextFor(runs: TextRun[], x0: number, x1: number, top: number, bottom: number) {
  const overlapsX = (r: TextRun) => r.x < x1 && r.x + r.width > x0;
  const left = runs
    .filter(r => r.x + r.width <= x0 + 4 && Math.abs(r.y + r.height - bottom) <= 6)
    .sort((a, b) => (b.x + b.width) - (a.x + a.width))[0];
  const below = runs.filter(r => overlapsX(r) && r.y >= bottom - 1 && r.y - bottom <= 16).sort((a, b) => a.y - b.y)[0];
  const above = runs.filter(r => overlapsX(r) && r.y + r.height <= top + 1 && top - (r.y + r.height) <= 22).sort((a, b) => b.y - a.y)[0];
  const parts = [left && `left: "${left.text.trim()}"`, below && `under: "${below.text.trim()}"`, above && `over: "${above.text.trim()}"`].filter(Boolean);
  const label = (left || below || above)?.text.trim().replace(/[_\s]+$/, "") || "(unlabelled)";
  return { label: label.slice(0, 60), context: parts.join("; ").slice(0, 200) };
}

/** A line that is just underlining text (a link, a heading) is not a place to write. */
function isTextUnderline(seg: Seg, runs: TextRun[]) {
  return runs.some(r => {
    const base = r.y + r.height;
    const covered = Math.min(seg.x1, r.x + r.width) - Math.max(seg.x0, r.x);
    return seg.y - base >= -1 && seg.y - base <= 4 && covered >= 0.8 * (seg.x1 - seg.x0);
  });
}

/** Turn painted graphics into anchors: lines, boxes and checkboxes. */
export function graphicsToAnchors(
  pageNumber: number, pageWidth: number, runs: TextRun[], g: { segs: Seg[]; rects: Rect[] },
): (FieldAnchor & { kind: AnchorKind })[] {
  const out: (FieldAnchor & { kind: AnchorKind })[] = [];
  const lines: Seg[] = [...g.segs];
  for (const r of g.rects) {
    if (r.w > 0.9 * pageWidth) continue;                                   // page borders, banners
    if (r.h <= 2.5 && r.w >= MIN_LINE) { lines.push({ x0: r.x, x1: r.x + r.w, y: r.y + r.h / 2 }); continue; } // Word draws rules as thin filled rects
    if (r.w >= 6 && r.w <= 22 && r.h >= 6 && r.h <= 22 && Math.abs(r.w - r.h) <= 4) {
      const c = contextFor(runs, r.x, r.x + 200, r.y, r.y + r.h);
      const right = runs.filter(t => t.x >= r.x + r.w - 1 && t.x - (r.x + r.w) <= 30 && Math.abs((t.y + t.height / 2) - (r.y + r.h / 2)) <= 8)
        .sort((a, b) => a.x - b.x)[0];
      out.push({ id: "", pageNumber, kind: "checkbox", label: right?.text.trim().slice(0, 60) || c.label, lineText: right ? `right: "${right.text.trim()}"` : c.context,
        x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), baseline: r1(r.y + r.h) });
      continue;
    }
    if (!r.filled && r.w >= 40 && r.h >= 12 && r.h <= 90) {
      const c = contextFor(runs, r.x, r.x + r.w, r.y, r.y + r.h);
      out.push({ id: "", pageNumber, kind: "box", label: c.label, lineText: c.context,
        x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), baseline: r1(r.y + r.h) });
    }
  }
  for (const s of lines) {
    if (s.x1 - s.x0 > 0.9 * pageWidth || isTextUnderline(s, runs)) continue;
    // A box's own top/bottom edge, drawn as lines, is already covered by the box anchor.
    if (out.some(b => b.kind === "box" && Math.abs(b.x - s.x0) < 3 && Math.abs(b.width - (s.x1 - s.x0)) < 3
      && (Math.abs(b.y - s.y) < 3 || Math.abs(b.y + b.height - s.y) < 3))) continue;
    const c = contextFor(runs, s.x0, s.x1, s.y - 1, s.y);
    out.push({ id: "", pageNumber, kind: "line", label: c.label, lineText: c.context,
      x: r1(s.x0), y: r1(s.y - 14), width: r1(s.x1 - s.x0), height: 14, baseline: r1(s.y) });
  }
  return dedupe(out);
}

function dedupe<T extends FieldAnchor>(anchors: T[]): T[] {
  const kept: T[] = [];
  for (const a of anchors.sort((p, q) => p.y - q.y || p.x - q.x)) {
    if (kept.some(k => Math.abs(k.x - a.x) < 2 && Math.abs(k.baseline - a.baseline) < 2 && Math.abs(k.width - a.width) < 4)) continue;
    kept.push(a);
  }
  return kept.slice(0, MAX_ANCHORS_PER_PAGE);
}

/**
 * Lines on a SCANNED page (no text layer, no vector drawing): long, thin runs of dark pixels.
 * `scale` is pixels per point of the render.
 */
export function rasterLines(img: { data: Uint8ClampedArray; width: number; height: number }, scale: number, pageNumber: number) {
  const { data, width, height } = img;
  // On a scan, a place to sign is at least an inch long; shorter dark runs are pieces of words.
  const minRun = Math.round(72 * scale);
  const rows: { y: number; x0: number; x1: number }[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1, gap = 0;
    for (let x = 0; x <= width; x++) {
      const i = (y * width + x) * 4;
      const dark = x < width && (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) < 140;
      if (dark) { if (start < 0) start = x; gap = 0; }
      else if (start >= 0 && ++gap > 2) {
        const end = x - gap;
        if (end - start >= minRun) rows.push({ y, x0: start, x1: end });
        start = -1; gap = 0;
      }
    }
  }
  // Merge adjacent rows into one line; drop thick bars (filled areas, not rules).
  const lines: { y0: number; y1: number; x0: number; x1: number }[] = [];
  for (const r of rows) {
    const l = lines.find(l => r.y - l.y1 <= 1 && Math.min(l.x1, r.x1) - Math.max(l.x0, r.x0) > 0.8 * Math.min(l.x1 - l.x0, r.x1 - r.x0));
    if (l) { l.y1 = r.y; l.x0 = Math.min(l.x0, r.x0); l.x1 = Math.max(l.x1, r.x1); }
    else lines.push({ y0: r.y, y1: r.y, x0: r.x0, x1: r.x1 });
  }
  // A rule stands alone: the rows just above and below it are mostly blank. A "line" made of the
  // touching bottoms of letters in a word has glyph strokes right above it, so it is rejected.
  const darkFraction = (y: number, x0: number, x1: number) => {
    if (y < 0 || y >= height) return 0;
    let n = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if ((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) < 140) n++;
    }
    return n / Math.max(1, x1 - x0 + 1);
  };
  const clear = Math.max(2, Math.round(1.5 * scale));
  return dedupe(lines
    .filter(l => (l.y1 - l.y0 + 1) <= 4 * scale && (l.x1 - l.x0) < 0.9 * width)
    .filter(l => darkFraction(l.y0 - clear, l.x0, l.x1) < 0.3 && darkFraction(l.y1 + clear, l.x0, l.x1) < 0.3)
    // ...and a rule is SOLID along its length; the tops of a row of letters have gaps between them.
    .filter(l => darkFraction(Math.round((l.y0 + l.y1) / 2), l.x0, l.x1) >= 0.97)
    .map(l => ({
      id: "", pageNumber, kind: "line" as AnchorKind, label: "(scanned)", lineText: "",
      x: r1(l.x0 / scale), y: r1((l.y0 + l.y1) / 2 / scale - 14), width: r1((l.x1 - l.x0) / scale), height: 14,
      baseline: r1((l.y0 + l.y1) / 2 / scale),
    })));
}

function standardFontDir(): string | undefined {
  const dir = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts");
  return fs.existsSync(dir) ? dir + path.sep : undefined;
}

/**
 * Render pages and return, for each, the canvas plus its pixel scale.
 *
 * Uses @napi-rs/canvas, the canvas pdf.js itself expects in Node: pdf.js draws each glyph as a Path2D
 * and draws embedded images (all of a scan) through its own scratch canvases, and node-canvas
 * supports neither, which rendered every page's text as nothing (or as placeholder boxes).
 * Font faces stay disabled so glyphs are drawn from the font program, with the standard 14 fonts
 * (often referenced without being embedded) loaded from pdf.js's own files.
 */
export async function renderPages(pdf: Buffer, pageNumbers: number[], scale = 1.5) {
  const renderer = await openRenderer(pdf);
  const out = new Map<number, { canvas: any; scale: number }>();
  try {
    for (const n of pageNumbers) {
      const canvas = await renderer.render(n, scale);
      if (canvas) out.set(n, { canvas, scale });
    }
  } finally {
    await renderer.destroy();
  }
  return out;
}

/** Open a PDF for rendering one page at a time (the pixel check renders every page, and must not hold them all). */
export async function openRenderer(pdf: Buffer) {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    standardFontDataUrl: standardFontDir(), useWorkerFetch: false,
  }).promise;
  return {
    numPages: doc.numPages as number,
    async render(n: number, scale: number): Promise<any | null> {
      if (n < 1 || n > doc.numPages) return null;
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as any, viewport: vp }).promise;
      page.cleanup?.();
      return canvas;
    },
    async destroy() { await doc.destroy?.(); },
  };
}

/** Draw a numbered marker on every anchor and return the page as base64 PNG. */
export function annotate(canvas: any, anchors: FieldAnchor[], scale: number): string {
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 2;
  ctx.font = `bold ${Math.round(11 * scale / 1.5 + 2)}px sans-serif`;
  for (const a of anchors) {
    const kind = (a as any).kind as AnchorKind | undefined;
    ctx.strokeStyle = "rgba(220, 0, 120, 0.9)";
    if (kind === "box" || kind === "checkbox") ctx.strokeRect(a.x * scale - 2, a.y * scale - 2, a.width * scale + 4, a.height * scale + 4);
    else { ctx.beginPath(); ctx.moveTo(a.x * scale, a.baseline * scale + 2); ctx.lineTo((a.x + a.width) * scale, a.baseline * scale + 2); ctx.stroke(); }
    const tag = a.id;
    const tw = ctx.measureText(tag).width + 6;
    const th = Math.round(11 * scale / 1.5 + 6);
    const tx = Math.max(0, a.x * scale - tw - 3);
    const ty = Math.max(0, (kind === "box" || kind === "checkbox" ? a.y : a.baseline - 12) * scale);
    ctx.fillStyle = "rgba(255, 230, 0, 0.95)"; ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = "#000"; ctx.fillText(tag, tx + 3, ty + th - 5);
  }
  return canvas.toBuffer("image/png").toString("base64");
}

/** Does this page carry a usable text layer, or is it a scan? */
export const isScanned = (layout: DocumentLayout, pageNumber: number) =>
  (layout.pages.find(p => p.pageNumber === pageNumber)?.runs.filter(r => r.text.trim()).length ?? 0) === 0;
