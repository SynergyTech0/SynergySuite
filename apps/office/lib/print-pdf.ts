// Print pages (lib/sheet-print.ts) as a PDF, drawn as vectors with jsPDF:
// fills, gridlines, borders, text (searchable) and pictures (charts and
// shapes included), at the paper size and orientation of each sheet's page
// setup.
//
// jsPDF's built-in fonts cover Western European text. Other text is set in
// Noto Sans for its script, embedded as a subset (lib/pdf-fonts.ts), so it
// stays searchable. Scripts that need shaping (Arabic, Hebrew, Indic, Thai)
// are drawn by the browser as a picture with the same text invisible over it.
// Without the fonts (offline, or in Node) such text falls back to a picture,
// or to "?" where there is no browser either.
import type { BorderLine, CellBox, HeaderText, PageModel, TextStyle } from "./sheet-print.ts";
import { COMPLEX, fontRuns } from "./pdf-fonts.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‘’‚“”„•–—…™ŒœŠšŸŽžƒˆ˜†‡‰‹›\n\t]*$/;

const pdfFont = (f: string) => {
  const k = f.toLowerCase();
  if (/times|serif|georgia|cambria|garamond/.test(k) && !/sans/.test(k)) return "times";
  if (/courier|mono|consol/.test(k)) return "courier";
  return "helvetica";
};
const pdfStyle = (bold: boolean, italic: boolean) => (bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : [0, 0, 0];
}

function line(doc: any, x1: number, y1: number, x2: number, y2: number, b: BorderLine) {
  doc.setDrawColor(...hex(b.color));
  doc.setLineWidth(b.width);
  doc.setLineDashPattern(b.dash || [], 0);
  if (b.double) {
    const off = Math.max(b.width, 0.6);
    if (y1 === y2) {
      doc.line(x1, y1 - off, x2, y2 - off);
      doc.line(x1, y1 + off, x2, y2 + off);
    } else {
      doc.line(x1 - off, y1, x2 - off, y2);
      doc.line(x1 + off, y1, x2 + off, y2);
    }
  } else doc.line(x1, y1, x2, y2);
  doc.setLineDashPattern([], 0);
}

/** Text in a script the built-in fonts lack: draw it on a canvas. */
function textAsImage(c: CellBox, lines: string[]): { data: string; w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  const k = 4; // canvas pixels per point
  const lineH = c.style.size * 1.2;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = `${c.style.italic ? "italic " : ""}${c.style.bold ? "bold " : ""}${c.style.size * k}px ${c.style.font}, sans-serif`;
  ctx.font = font;
  const w = Math.max(1, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) / k));
  const h = Math.ceil(lineH * lines.length);
  canvas.width = w * k;
  canvas.height = h * k;
  ctx.font = font;
  ctx.fillStyle = c.style.color;
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, 0, (i + 0.5) * lineH * k));
  return { data: canvas.toDataURL("image/png"), w, h };
}

type Fonts = Set<string>;
type Run = { text: string; font: string | null };

const setRunFont = (doc: any, r: Run, s: Pick<TextStyle, "font" | "bold" | "italic">) => (r.font ? doc.setFont(r.font, "normal") : doc.setFont(pdfFont(s.font), pdfStyle(s.bold, s.italic)));
/** Runs whose font is missing become "?" (built-in font). */
const usableRuns = (text: string, s: TextStyle, fonts: Fonts): Run[] => fontRuns(text, s.bold).map((r) => (r.font && !fonts.has(r.font) ? { text: r.text.replace(/[^\x20-\x7e\xa0-\xff]/g, "?"), font: null } : r));
function runsWidth(doc: any, runs: Run[], s: TextStyle): number {
  let w = 0;
  for (const r of runs) {
    setRunFont(doc, r, s);
    w += doc.getTextWidth(r.text);
  }
  return w;
}
function drawRuns(doc: any, runs: Run[], x: number, baseline: number, s: TextStyle, invisible = false) {
  for (const r of runs) {
    setRunFont(doc, r, s);
    if (r.text) doc.text(r.text, x, baseline, invisible ? { renderingMode: "invisible" } : undefined);
    x += doc.getTextWidth(r.text);
  }
}

/** Greedy line breaking by measured width: at a space when there is one, else anywhere (as CJK text breaks). */
export function wrapText(text: string, maxW: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      const next = line + ch;
      if (!line || measure(next) <= maxW) {
        line = next;
        continue;
      }
      if (ch === " ") {
        out.push(line);
        line = "";
        continue;
      }
      const space = line.lastIndexOf(" ");
      if (space > 0) {
        out.push(line.slice(0, space));
        line = line.slice(space + 1) + ch;
      } else {
        out.push(line);
        line = ch;
      }
    }
    out.push(line);
  }
  return out;
}

function drawText(doc: any, c: CellBox, fonts: Fonts) {
  const s = c.style;
  doc.setFont(pdfFont(s.font), pdfStyle(s.bold, s.italic));
  doc.setFontSize(s.size);
  doc.setTextColor(...hex(s.color));
  const pad = 2 * Math.min(1, s.size / 11);
  const width = Math.max(1, c.textW - pad * 2);
  const plain = WIN_ANSI.test(c.text);
  const raw = c.text.split("\n");
  const lines: string[] = !c.wrap ? raw : plain ? doc.splitTextToSize(c.text, width) : wrapText(c.text, width, (t) => runsWidth(doc, usableRuns(t, s, fonts), s));
  const lineH = s.size * 1.15;
  const blockH = lines.length * lineH;
  let top = c.valign === "top" ? c.y + pad : c.valign === "middle" ? c.y + (c.h - blockH) / 2 : c.y + c.h - pad - blockH;
  if (!c.wrap) top = Math.max(top, c.valign === "bottom" ? c.y + c.h - blockH - pad : top);
  const xOf = (tw: number) => (c.align === "left" ? c.textX + pad : c.align === "right" ? c.textX + c.textW - pad - tw : c.textX + (c.textW - tw) / 2);

  doc.saveGraphicsState();
  doc.rect(c.textX, c.y, c.textW, c.h, null);
  doc.clip();
  doc.discardPath();
  const embedded = !plain && fontRuns(c.text, s.bold).every((r) => !r.font || fonts.has(r.font));
  if (!plain && (COMPLEX.test(c.text) || !embedded)) {
    const img = textAsImage(c, lines);
    if (img) {
      const x = xOf(img.w);
      doc.addImage(img.data, "PNG", x, top, img.w, img.h);
      // The same text, invisible, so the picture can be searched and copied.
      if (embedded)
        lines.forEach((l, i) => {
          const runs = usableRuns(l, s, fonts);
          drawRuns(doc, runs, xOf(runsWidth(doc, runs, s)), top + (i + 0.5) * s.size * 1.2 + s.size * 0.35, s, true);
        });
      doc.restoreGraphicsState();
      return;
    }
  }
  lines.forEach((l, i) => {
    const runs: Run[] = plain ? [{ text: l, font: null }] : usableRuns(l, s, fonts);
    const baseline = top + i * lineH + s.size * 0.86;
    const tw = runsWidth(doc, runs, s);
    const x = xOf(tw);
    drawRuns(doc, runs, x, baseline, s);
    if (s.underline || s.strike) {
      doc.setDrawColor(...hex(s.color));
      doc.setLineWidth(Math.max(0.4, s.size / 16));
      if (s.underline) doc.line(x, baseline + s.size * 0.12, x + tw, baseline + s.size * 0.12);
      if (s.strike) doc.line(x, baseline - s.size * 0.3, x + tw, baseline - s.size * 0.3);
    }
  });
  doc.restoreGraphicsState();
}

const HF_STYLE: TextStyle = { font: "Arial", size: 9, bold: false, italic: false, underline: false, strike: false, color: "#000000" };
function drawHeaderFooter(doc: any, t: HeaderText, y: number, p: PageModel, bottom: boolean, fonts: Fonts) {
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const baseline = bottom ? y : y + 9 * 0.86;
  const put = (text: string, align: "left" | "center" | "right") => {
    if (!text) return;
    const runs = WIN_ANSI.test(text) ? [{ text, font: null }] : usableRuns(text, HF_STYLE, fonts);
    const w = runsWidth(doc, runs, HF_STYLE);
    const x = align === "left" ? p.margins.left : align === "right" ? p.margins.right - w : (p.margins.left + p.margins.right) / 2 - w / 2;
    drawRuns(doc, runs, x, baseline, HF_STYLE);
  };
  put(t.left, "left");
  put(t.center, "center");
  put(t.right, "right");
}

function imageFormat(src: string) {
  const m = /^data:image\/(png|jpe?g|gif|webp|bmp)/i.exec(src);
  return m ? (m[1].toLowerCase() === "jpg" ? "JPEG" : m[1].toUpperCase()) : "PNG";
}

/** A chart or shape (SVG) as a PNG at three pixels per point; null without a browser. */
async function svgToPng(src: string, w: number, h: number): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = new Image();
  const ok = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  if (!ok) return null;
  const k = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** In the editor: the fonts come from /api/fonts. */
async function fetchFont(file: string): Promise<string | null> {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;
  try {
    const r = await fetch(`/api/fonts/${encodeURIComponent(file)}`);
    return r.ok ? toBase64(new Uint8Array(await r.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

export type PdfOptions = {
  /** A font file (see lib/pdf-fonts.ts) as base64, or null when it can't be had. */
  loadFont?: (file: string) => Promise<string | null>;
};

export async function pagesToPdf(pages: PageModel[], title: string, opts: PdfOptions = {}): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const first = pages[0] || { width: 612, height: 792 };
  const doc: any = new jsPDF({ unit: "pt", format: [first.width, first.height], orientation: first.width > first.height ? "landscape" : "portrait", compress: true });
  doc.setProperties({ title, creator: "Synergy Office" });

  // The fonts the text needs beyond the built-in ones.
  const wanted = new Set<string>();
  const need = (text: string, bold = false) => {
    if (text && !WIN_ANSI.test(text)) for (const r of fontRuns(text, bold)) if (r.font) wanted.add(r.font);
  };
  for (const p of pages) {
    for (const c of [...p.cells, ...(p.overlay || [])]) need(c.text, c.style.bold);
    for (const t of [p.header, p.footer]) for (const x of [t.left, t.center, t.right]) need(x);
  }
  const fonts: Fonts = new Set();
  const load = opts.loadFont || fetchFont;
  await Promise.all(
    [...wanted].map(async (file) => {
      const data = await load(file).catch(() => null);
      if (!data) return;
      try {
        doc.addFileToVFS(file, data);
        doc.addFont(file, file, "normal", "Identity-H");
        fonts.add(file);
      } catch {
        /* not a font jsPDF can read: that text falls back */
      }
    }),
  );
  // Charts and shapes come as SVG: turned into pictures here.
  const pictures = new Map<string, string | null>();
  for (const p of pages)
    for (const im of p.images) if (im.src.startsWith("data:image/svg") && !pictures.has(im.src)) pictures.set(im.src, await svgToPng(im.src, im.w, im.h));

  pages.forEach((p, i) => {
    if (i > 0) doc.addPage([p.width, p.height], p.width > p.height ? "landscape" : "portrait");
    for (const c of p.cells)
      if (c.fill) {
        doc.setFillColor(...hex(c.fill));
        doc.rect(c.x, c.y, c.w, c.h, "F");
      }
    if (p.grid.length) {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.4);
      for (const g of p.grid) doc.line(g.x1, g.y1, g.x2, g.y2);
    }
    for (const c of p.cells) {
      const b = c.borders;
      if (b.t) line(doc, c.x, c.y, c.x + c.w, c.y, b.t);
      if (b.b) line(doc, c.x, c.y + c.h, c.x + c.w, c.y + c.h, b.b);
      if (b.l) line(doc, c.x, c.y, c.x, c.y + c.h, b.l);
      if (b.r) line(doc, c.x + c.w, c.y, c.x + c.w, c.y + c.h, b.r);
    }
    for (const c of p.cells) if (c.text) drawText(doc, c, fonts);
    for (const im of p.images) {
      const src = im.src.startsWith("data:image/svg") ? pictures.get(im.src) : im.src;
      if (!src) continue;
      try {
        doc.saveGraphicsState();
        doc.rect(im.clip.x, im.clip.y, im.clip.w, im.clip.h, null);
        doc.clip();
        doc.discardPath();
        doc.addImage(src, imageFormat(src), im.x, im.y, im.w, im.h);
        doc.restoreGraphicsState();
      } catch {
        doc.restoreGraphicsState();
      }
    }
    for (const c of p.overlay || []) if (c.text) drawText(doc, c, fonts);
    drawHeaderFooter(doc, p.header, p.headerY, p, false, fonts);
    drawHeaderFooter(doc, p.footer, p.footerY, p, true, fonts);
  });
  if (!pages.length) doc.text("", 0, 0);
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}
