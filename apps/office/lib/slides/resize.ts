// Fitting a deck to a new slide size, as PowerPoint's "Ensure Fit": objects
// scale with the slide and their text scales with them (font sizes in the
// text, table, equation and placeholder styles), so nothing spills out of
// boxes that got smaller.
import { BODY_PT, applyMaster, bodyPt, isMasterKey, titlePt, type Masters, type Slide, type SlideElement } from "./model";

const r1 = (n: number) => Math.max(1, Math.round(n * 10) / 10);

/**
 * Every font size in slide HTML times `k`. Paragraphs with text whose size
 * comes from the box (no size of their own) get `basePt × k`, so they shrink
 * too (`null`: the size comes from a style that is scaled itself).
 */
export function scaleHtmlFonts(html: string, k: number, basePt: number | null = BODY_PT): string {
  if (!html || k === 1) return html;
  let out = html.replace(/font-size:\s*([\d.]+)(pt|px)/g, (_, n, u) => `font-size: ${r1(Number(n) * (u === "px" ? 0.75 : 1) * k)}pt`);
  if (basePt === null) return out;
  out = out.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/g, (p, attrs, inner) => {
    if (!inner.replace(/<[^>]+>/g, "").trim() || /font-size/.test(inner)) return p;
    return `<p${attrs}><span style="font-size: ${r1(basePt * k)}pt">${inner}</span></p>`;
  });
  return out;
}

/** An element's text scaled by `k`. */
export function scaleElementFonts(e: SlideElement, k: number): SlideElement {
  if (k === 1) return e;
  if (e.type === "text" || e.type === "shape") return e.html ? { ...e, html: scaleHtmlFonts(e.html, k) } : e;
  if (e.type === "table") {
    const fs = e.fontSize || 14;
    return { ...e, fontSize: r1(fs * k), rows: e.rows.map((row) => row.map((c) => (c.html ? { ...c, html: scaleHtmlFonts(c.html, k, null) } : c))) };
  }
  if (e.type === "math") return { ...e, size: r1((e.size || 28) * k) };
  return e;
}

/**
 * A slide's (or layout's or master's) own text styles scaled by `k`. A slide
 * pins the sizes it shows (what it inherits, scaled), so a master's sizes
 * can't scale it twice; masters get the default sizes made explicit.
 */
export function scaleSlideFonts(s: Slide, k: number, masters: Masters | undefined, key?: string): Partial<Slide> {
  if (k === 1) return {};
  const shown = key ? s : applyMaster(s, masters);
  const out: Partial<Slide> = {};
  const tSize = key ? s.tstyle?.size ?? (isMasterKey(key) ? 32 : key === "title" ? 44 : undefined) : titlePt(shown);
  const bSize = key ? s.bstyle?.size ?? (isMasterKey(key) ? BODY_PT : undefined) : bodyPt(shown);
  if (tSize !== undefined) out.tstyle = { ...s.tstyle, size: r1(tSize * k) };
  if (bSize !== undefined || s.bstyle) {
    const lv = (key ? s.bstyle?.lv : shown.bstyle?.lv)?.map((l) => (l && l.size ? { ...l, size: r1(l.size * k) } : l));
    out.bstyle = { ...s.bstyle, ...(bSize !== undefined ? { size: r1(bSize * k) } : {}), ...(lv ? { lv } : {}) };
  }
  if (s.body) out.body = scaleHtmlFonts(s.body, k, null);
  return out;
}
