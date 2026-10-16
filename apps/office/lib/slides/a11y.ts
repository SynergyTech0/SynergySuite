// Accessibility checker: what a screen reader user or a reader with low
// vision would miss on each slide. Errors make content hard or impossible to
// read; warnings make it harder; tips are worth a look.
import { applyMaster, bodyBox, htmlText, titleBox, titlePt, toHtml, type Masters, type Slide, type SlideElement } from "./model";
import type { Theme } from "./themes";

export type Severity = "error" | "warning" | "tip";
export type IssueKind = "alt" | "title" | "dupTitle" | "contrast" | "order" | "link" | "table";
export type Issue = {
  kind: IssueKind;
  severity: Severity;
  slide: number;
  /** the object it is about: element id, "title" or "body" */
  target?: string;
  message: string;
  /** contrast: the ratio found and the one needed */
  ratio?: number;
  need?: number;
  /** reading order: element ids in the order they appear on the slide */
  order?: string[];
};

// ---- colour contrast (WCAG 2.x) ----

/** `top` at opacity `a` over `under` (hex colours, no '#'). */
export function blend(top: string, under: string, a: number): string {
  const t = parseColor(top), u = parseColor(under);
  if (!t || !u) return top;
  return t.map((v, k) => Math.round(v * a + u[k] * (1 - a)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function parseColor(c: string | undefined | null): [number, number, number] | null {
  if (!c) return null;
  const v = c.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (r) return [Number(r[1]), Number(r[2]), Number(r[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio of two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return 21;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Colours set on runs of rich text (inline styles), plus the default. */
function textColors(html: string, dflt: string): string[] {
  const out = new Set<string>();
  const text = htmlText(html).trim();
  if (!text) return [];
  // runs without a colour of their own use the default
  const coloured = [...html.matchAll(/<(span|a|strong|em|b|i|u|s)\b[^>]*style="(?:[^"]*?[;\s])?color:\s*([^;"]+)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi)];
  const colouredText = coloured.map((m) => htmlText(m[3])).join("").replace(/\s+/g, "");
  if (colouredText.length < text.replace(/\s+/g, "").length) out.add(dflt);
  for (const m of coloured) if (htmlText(m[3]).trim()) out.add(m[2].trim());
  return [...out];
}

const LINK_WORDS = /^(click here|here|this|link|this link|more|read more|learn more|click|go|details|page)$/i;

/** Rough visual reading order: rows top to bottom (objects whose tops are close share a row), left to right in a row. */
export function visualOrder<T extends { x: number; y: number; w: number; h: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && it.y < row[0].y + Math.min(row[0].h, it.h) * 0.5) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Objects a screen reader announces (not decorative, not empty shapes or lines). */
function announced(e: SlideElement): boolean {
  if (e.deco) return false;
  if (e.type === "shape") return !!htmlText(e.html || "").trim() || !!e.alt;
  return true;
}

/** The accessibility issues of a deck (slides as stored; masters resolve their look). */
export function checkAccessibility(slides: Slide[], theme: Theme, masters: Masters = {}, W = 1280, H = 720): Issue[] {
  const out: Issue[] = [];
  const titles = new Map<string, number[]>();
  slides.forEach((raw, i) => {
    const s = applyMaster(raw, masters, i + 1);
    const n = i + 1;
    const bg = s.bgImg ? null : s.bg || theme.bg;
    // ---- title ----
    const title = s.title.trim();
    if (!title || s.layout === "blank") out.push({ kind: "title", severity: "error", slide: i, message: `Slide ${n} has no title. A title lets people find and understand the slide.` });
    else titles.set(title.toLowerCase(), [...(titles.get(title.toLowerCase()) || []), i]);
    // ---- objects ----
    for (const e of s.elements) {
      if (e.deco) continue;
      const alt = (e.alt || "").trim();
      if (e.type === "image" && !alt) out.push({ kind: "alt", severity: "error", slide: i, target: e.id, message: "Picture without alternative text." });
      if (e.type === "chart" && !alt && !e.title) out.push({ kind: "alt", severity: "error", slide: i, target: e.id, message: "Chart without a title or alternative text." });
      if (e.type === "media" && !alt && !e.name) out.push({ kind: "alt", severity: "warning", slide: i, target: e.id, message: `${e.kind === "audio" ? "Audio" : "Video"} without a name or alternative text.` });
      if (e.type === "model3d" && !alt) out.push({ kind: "alt", severity: "error", slide: i, target: e.id, message: "3D model without alternative text." });
      if (e.type === "zoom" && !alt) out.push({ kind: "alt", severity: "tip", slide: i, target: e.id, message: "Zoom without alternative text (it reads as “Slide zoom”)." });
      if (e.type === "table" && e.rows.length > 1 && !e.rows[0].some((c) => c.bold)) out.push({ kind: "table", severity: "tip", slide: i, target: e.id, message: "Table without a header row: make the first row bold headings." });
      // text contrast against the object's own fill, else the slide
      if (e.type === "text" || (e.type === "shape" && e.html)) {
        // a see-through fill shows the slide through it
        const own = e.type === "shape" && e.fill && !e.grad ? (e.fillA !== undefined && e.fillA < 1 ? (bg ? blend(e.fill, bg, e.fillA) : null) : e.fill) : null;
        const fill = own ?? (e.type === "shape" && (e.grad || (e.fill && e.fillA !== undefined && e.fillA < 1)) ? null : bg);
        if (fill) {
          for (const c of textColors(e.html || "", theme.text)) {
            const r = contrast(c, fill);
            if (r < 4.5) out.push({ kind: "contrast", severity: r < 3 ? "error" : "warning", slide: i, target: e.id, ratio: Math.round(r * 100) / 100, need: 4.5, message: `Hard-to-read text: contrast ${r.toFixed(1)}:1 (needs 4.5:1).` });
          }
        }
      }
      // links whose text does not say where they go
      for (const m of (e.type === "text" || e.type === "shape" ? e.html || "" : "").matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const t = htmlText(m[2]).trim();
        if (LINK_WORDS.test(t) || (t.length > 30 && /^(https?:\/\/|www\.)/i.test(t))) out.push({ kind: "link", severity: "warning", slide: i, target: e.id, message: `Unclear link text “${t.slice(0, 40)}”: say where the link goes.` });
      }
    }
    if (bg) {
      const tc = s.tstyle?.color || theme.title;
      if (title && titleBox(s, W, H)) {
        const r = contrast(tc, bg), need = titlePt(s) >= 18 ? 3 : 4.5;
        if (r < need) out.push({ kind: "contrast", severity: r < 2 ? "error" : "warning", slide: i, target: "title", ratio: Math.round(r * 100) / 100, need, message: `Hard-to-read title: contrast ${r.toFixed(1)}:1 (needs ${need}:1).` });
      }
      if (s.body && bodyBox(s, W, H)) {
        for (const c of textColors(toHtml(s.body), s.bstyle?.color || theme.text)) {
          const r = contrast(c, bg);
          if (r < 4.5) out.push({ kind: "contrast", severity: r < 3 ? "error" : "warning", slide: i, target: "body", ratio: Math.round(r * 100) / 100, need: 4.5, message: `Hard-to-read text: contrast ${r.toFixed(1)}:1 (needs 4.5:1).` });
        }
      }
    }
    // ---- reading order: the order objects are stored (and read) vs. where they sit ----
    const items: { id: string; x: number; y: number; w: number; h: number; z: number }[] = [];
    const tb = title ? titleBox(s, W, H) : undefined;
    const bb = s.body ? bodyBox(s, W, H) : undefined;
    for (const e of [...s.elements].sort((a, b) => a.z - b.z)) if (e.z < 0 && announced(e)) items.push({ id: e.id, ...pick(e), z: e.z });
    if (tb) items.push({ id: "title", ...tb, z: 0 });
    if (bb) items.push({ id: "body", ...bb, z: 0.5 });
    for (const e of [...s.elements].sort((a, b) => a.z - b.z)) if (e.z >= 0 && announced(e)) items.push({ id: e.id, ...pick(e), z: e.z });
    if (items.length >= 2) {
      const read = items.map((x) => x.id);
      // what is behind something else is not compared
      const front = items.filter((a) => !items.some((b) => b !== a && overlaps(a, b) && b.w * b.h > a.w * a.h * 3));
      const seen = visualOrder(front).map((x) => x.id);
      const readFront = read.filter((id) => seen.includes(id));
      if (seen.join() !== readFront.join()) out.push({ kind: "order", severity: "warning", slide: i, order: seen, message: `Check the reading order: a screen reader reads ${readFront.map(label).join(", ")}.` });
    }
  });
  for (const [, at] of titles) if (at.length > 1) for (const i of at) out.push({ kind: "dupTitle", severity: "warning", slide: i, message: `Slide ${i + 1} has the same title as slide ${at.filter((k) => k !== i).map((k) => k + 1).join(", ")}. Distinct titles help people tell slides apart.` });
  const rank: Record<Severity, number> = { error: 0, warning: 1, tip: 2 };
  return out.sort((a, b) => a.slide - b.slide || rank[a.severity] - rank[b.severity]);
}

const pick = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const label = (id: string) => (id === "title" ? "the title" : id === "body" ? "the body" : "an object");

/**
 * Stacking order (z) that reads objects in `order` (element ids, "title" and
 * "body" among them): those before the title go behind the placeholders.
 * Only the listed objects move; returns id -> new z.
 */
export function readingOrderZ(slide: Slide, order: string[]): Record<string, number> {
  const els = new Set(slide.elements.map((e) => e.id));
  const t = order.findIndex((id) => id === "title" || id === "body");
  const before = (t < 0 ? [] : order.slice(0, t)).filter((id) => els.has(id));
  const after = order.slice(t < 0 ? 0 : t).filter((id) => els.has(id));
  const out: Record<string, number> = {};
  before.forEach((id, k) => (out[id] = k - before.length));
  // objects nobody reads (decorative, empty shapes) stay behind the ones that are read
  const rest = slide.elements.filter((e) => !before.includes(e.id) && !after.includes(e.id) && e.z >= 0).sort((a, b) => a.z - b.z);
  rest.forEach((e, k) => (out[e.id] = k + 1));
  after.forEach((id, k) => (out[id] = rest.length + k + 1));
  return out;
}
