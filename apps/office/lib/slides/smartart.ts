// SmartArt-style diagrams built from an outline (one item per line, indented
// for sub-items) as ordinary shapes in one group, so they stay editable and
// export to .pptx as plain shapes. The importer also uses this to lay out a
// SmartArt graphic that has no saved drawing, from its data model.
import type { Box, Diagram, NewElement } from "./model";

export type DiagramKind = "process" | "cycle" | "hierarchy" | "list" | "pyramid";
export const DIAGRAMS: { id: DiagramKind; label: string; hint: string }[] = [
  { id: "process", label: "Process", hint: "Steps in order, left to right" },
  { id: "cycle", label: "Cycle", hint: "Stages that repeat" },
  { id: "hierarchy", label: "Hierarchy", hint: "Organization chart: indent to make a level below" },
  { id: "list", label: "List", hint: "Items stacked, with indented details" },
  { id: "pyramid", label: "Pyramid", hint: "Foundation at the bottom, top item first" },
];

export type OutlineItem = { text: string; level: number };

/** One item per line; two spaces, a tab or a leading "-"/"*" per level. */
export function parseOutline(src: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const raw of src.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const lead = /^[\t ]*/.exec(raw)![0];
    const spaces = lead.replace(/\t/g, "  ").length;
    const m = /^([-*•]+)\s*/.exec(raw.slice(lead.length));
    const level = Math.floor(spaces / 2) + (m ? m[1].length - 1 : 0);
    const text = raw.slice(lead.length + (m ? m[0].length : 0)).trim();
    if (text) out.push({ text, level: Math.max(0, Math.min(level, (out[out.length - 1]?.level ?? -1) + 1)) });
  }
  return out;
}

type Node = { text: string; kids: Node[]; idx: number };
function tree(items: OutlineItem[]): Node[] {
  const roots: Node[] = [];
  const stack: { n: Node; level: number }[] = [];
  for (const [idx, it] of items.entries()) {
    const n: Node = { text: it.text, kids: [], idx };
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    if (stack.length) stack[stack.length - 1].n.kids.push(n);
    else roots.push(n);
    stack.push({ n, level: it.level });
  }
  return roots;
}

const hexRgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c: number[]) => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** Mix with white (t > 0) or black (t < 0). */
export function tint(hex: string, t: number): string {
  const c = hexRgb(/^[0-9a-f]{6}$/i.test(hex) ? hex : "4472C4");
  return rgbHex(c.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t))));
}
/** Shades of the accent for successive shapes. */
export const palette = (accent: string, n: number) => Array.from({ length: Math.max(1, n) }, (_, i) => tint(accent, [0, 0.25, -0.2, 0.45, -0.35, 0.15][i % 6]));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Shape text: the item, then its sub-items as bullets. */
function html(n: Node | string, color: string, pt: number, align: "center" | "left" = "center"): string {
  const node = typeof n === "string" ? { text: n, kids: [] as Node[] } : n;
  const head = `<p style="text-align: ${align}"><span style="color: #${color.toLowerCase()}; font-size: ${pt}pt">${esc(node.text)}</span></p>`;
  if (!node.kids.length) return head;
  const flat = (k: Node[]): string => k.map((c) => `<li><p><span style="color: #${color.toLowerCase()}; font-size: ${Math.round(pt * 0.75)}pt">${esc(c.text)}</span></p>${c.kids.length ? `<ul>${flat(c.kids)}</ul>` : ""}</li>`).join("");
  return `${head}<ul>${flat(node.kids)}</ul>`;
}

/** Text size that fits `chars` characters in a w × h box (rough, in pt). */
function fitPt(text: string, w: number, h: number, max = 24): number {
  const chars = Math.max(4, text.length);
  const byArea = Math.sqrt((w * h) / chars) * 0.95;
  return Math.max(9, Math.min(max, Math.round(byArea * 0.75)));
}

type Out = NewElement & { group: string };

/**
 * Lay out a diagram in `area`. Every shape carries the group id `gid`; z order
 * follows the array (connectors first, so they sit behind the boxes).
 */
export function buildDiagram(kind: DiagramKind, items: OutlineItem[], area: Box, accent: string, gid: string, src?: Diagram["src"]): Out[] {
  const list = items.length ? items : [{ text: "Text", level: 0 }];
  const roots = tree(list);
  /** the item indexes a shape's paragraphs show: the node, then its sub-items in outline order */
  const all = (n: Node): number[] => [n.idx, ...n.kids.flatMap(all)];
  const colors = palette(accent, roots.length);
  const out: Out[] = [];
  const shape = (s: Partial<Extract<NewElement, { type: "shape" }>> & Box & { shape: string }) =>
    out.push({ type: "shape", line: null, valign: "middle", autofit: "shrink", group: gid, ...s } as Out);
  const { x: X, y: Y, w: W, h: H } = area;

  if (kind === "process") {
    const n = roots.length;
    const gap = Math.min(60, W * 0.06);
    const bw = (W - gap * (n - 1)) / n;
    const bh = Math.min(H, bw * (roots.some((r) => r.kids.length) ? 1.1 : 0.65));
    const by = Y + (H - bh) / 2;
    roots.forEach((r, i) => {
      const bx = X + i * (bw + gap);
      shape({ shape: "roundRect", fill: colors[i], x: r1(bx), y: r1(by), w: r1(bw), h: r1(bh), html: html(r, "FFFFFF", fitPt(r.text + r.kids.map((k) => k.text).join(" "), bw, bh)), dpt: all(r) });
      if (i < n - 1) shape({ shape: "rightArrow", fill: tint(accent, 0.55), x: r1(bx + bw + gap * 0.15), y: r1(by + bh / 2 - gap * 0.35), w: r1(gap * 0.7), h: r1(gap * 0.7) });
    });
  } else if (kind === "cycle") {
    const n = roots.length;
    const S = Math.min(W, H);
    const node = S * (n <= 3 ? 0.34 : n <= 5 ? 0.28 : 0.22);
    const cx = X + W / 2, cy = Y + H / 2;
    const R = S / 2 - node / 2;
    const at = (k: number) => -Math.PI / 2 + (2 * Math.PI * k) / n;
    roots.forEach((r, i) => {
      const a = at(i);
      shape({ shape: "ellipse", fill: colors[i], x: r1(cx + R * Math.cos(a) - node / 2), y: r1(cy + R * Math.sin(a) - node / 2), w: r1(node), h: r1(node), html: html(r, "FFFFFF", fitPt(r.text, node * 0.7, node * 0.7, 20)), dpt: all(r) });
    });
    if (n > 1)
      roots.forEach((_, i) => {
        const m = at(i + 0.5);
        const aw = Math.max(16, node * 0.32), ah = aw * 0.6;
        // arrow on the circle between two nodes, pointing along the way round (clockwise)
        const ax = cx + R * Math.cos(m), ay = cy + R * Math.sin(m);
        const rot = Math.round(((m * 180) / Math.PI + 90 + 360) % 360);
        shape({ shape: "rightArrow", fill: tint(accent, 0.55), x: r1(ax - aw / 2), y: r1(ay - ah / 2), w: r1(aw), h: r1(ah), ...(rot ? { rot } : {}) });
      });
  } else if (kind === "hierarchy") {
    const depth = (n: Node): number => 1 + Math.max(0, ...n.kids.map(depth));
    const leaves = (n: Node): number => (n.kids.length ? n.kids.reduce((s, k) => s + leaves(k), 0) : 1);
    const levels = Math.max(...roots.map(depth));
    const total = roots.reduce((s, r) => s + leaves(r), 0);
    const slot = W / total;
    const rowH = H / levels;
    const bw = Math.min(slot * 0.86, 260), bh = Math.min(rowH * 0.6, bw * 0.6);
    const levelColor = palette(accent, levels);
    const boxes: Box[] = [];
    const place = (n: Node, lvl: number, x0: number): { cx: number; top: number; bottom: number } => {
      const span = leaves(n) * slot;
      const cx = x0 + span / 2;
      const y = Y + lvl * rowH + (rowH - bh) / 2;
      const b = { x: r1(cx - bw / 2), y: r1(y), w: r1(bw), h: r1(bh) };
      boxes.push(b);
      const kidsAt: { cx: number; top: number }[] = [];
      let kx = x0;
      for (const k of n.kids) {
        const p = place(k, lvl + 1, kx);
        kidsAt.push(p);
        kx += leaves(k) * slot;
      }
      if (kidsAt.length) {
        // elbow connector from this box down to its children, as one open freeform
        const top = y + bh, bot = kidsAt[0].top;
        const midY = (top + bot) / 2;
        const xs = [cx, ...kidsAt.map((k) => k.cx)];
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const w = Math.max(1, maxX - minX), h = Math.max(1, bot - top);
        const lx = (v: number) => r1(v - minX), ly = (v: number) => r1(v - top);
        let d = `M${lx(cx)} 0 L${lx(cx)} ${ly(midY)}`;
        if (kidsAt.length > 1 || kidsAt[0].cx !== cx) d += ` M${lx(minX)} ${ly(midY)} L${lx(maxX)} ${ly(midY)}`;
        for (const k of kidsAt) d += ` M${lx(k.cx)} ${ly(midY)} L${lx(k.cx)} ${r1(h)}`;
        out.unshift({ type: "shape", shape: "freeform", geom: { w: r1(w), h: r1(h), d }, fill: null, line: tint(accent, -0.1), lineW: 1.5, x: r1(minX), y: r1(top), w: r1(w), h: r1(h), group: gid } as Out);
      }
      shape({ shape: "roundRect", fill: levelColor[lvl], x: b.x, y: b.y, w: b.w, h: b.h, html: html(n.text, "FFFFFF", fitPt(n.text, bw, bh, 20)), dpt: [n.idx] });
      return { cx, top: y, bottom: y + bh };
    };
    let x0 = X;
    for (const r of roots) {
      place(r, 0, x0);
      x0 += leaves(r) * slot;
    }
  } else if (kind === "list") {
    const n = roots.length;
    const gap = Math.min(16, H * 0.03);
    const rh = (H - gap * (n - 1)) / n;
    const tab = Math.min(W * 0.3, 240);
    roots.forEach((r, i) => {
      const y = Y + i * (rh + gap);
      shape({ shape: "roundRect", fill: colors[i], x: r1(X), y: r1(y), w: r1(tab), h: r1(rh), html: html(r.text, "FFFFFF", fitPt(r.text, tab, rh, 24)), dpt: [r.idx] });
      const details = r.kids.length ? html({ text: "", kids: r.kids, idx: -1 }, "333333", fitPt(r.kids.map((k) => k.text).join(" "), W - tab, rh, 20), "left").replace(/^<p[^>]*><span[^>]*><\/span><\/p>/, "") : "";
      shape({ shape: "rect", fill: tint(colors[i], 0.8), x: r1(X + tab), y: r1(y + rh * 0.1), w: r1(W - tab), h: r1(rh * 0.8), html: details, valign: "middle", dpt: r.kids.flatMap(all) });
    });
  } else {
    // pyramid: the first item at the top
    const n = roots.length;
    const lh = H / n;
    const Wd = Math.min(W, H * 1.4);
    const x0 = X + (W - Wd) / 2;
    roots.forEach((r, i) => {
      const yTop = Y + i * lh;
      const wTop = (Wd * i) / n, wBot = (Wd * (i + 1)) / n;
      const left = x0 + (Wd - wBot) / 2;
      const d = i === 0 ? `M${r1(wBot / 2)} 0 L${r1(wBot)} ${r1(lh)} L0 ${r1(lh)} Z` : `M${r1((wBot - wTop) / 2)} 0 L${r1((wBot + wTop) / 2)} 0 L${r1(wBot)} ${r1(lh)} L0 ${r1(lh)} Z`;
      const textW = (wTop + wBot) / 2;
      shape({ shape: "freeform", geom: { w: r1(wBot), h: r1(lh), d }, fill: colors[i], line: "FFFFFF", lineW: 2, x: r1(left), y: r1(yTop), w: r1(wBot), h: r1(lh), html: html(r.text, "FFFFFF", fitPt(r.text, textW * 0.7, lh * 0.8, 24)), valign: i === 0 ? "bottom" : "middle", dpt: [r.idx] });
    });
  }
  // the data model rides on the first shape of the group
  if (out.length) (out[0] as { dgm?: Diagram }).dgm = { kind, items: list.map((i) => ({ text: i.text, level: i.level })), accent, ...(src ? { src } : {}) };
  return out;
}

/** The outline as Text Pane text: one item per line, two spaces per level. */
export const outlineText = (items: OutlineItem[]) => items.map((i) => `${"  ".repeat(i.level)}${i.text}`).join("\n");

/** Paragraph texts of shape HTML, in order (a <p> or list item each). */
export function paragraphTexts(h: string): string[] {
  const out: string[] = [];
  for (const m of h.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    out.push(m[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim());
  return out;
}

/**
 * Text typed into one of a diagram's shapes goes back into its data model:
 * the shape's paragraphs are the items it shows (`dpt`), in order.
 */
export function syncShapeText(d: Diagram, dpt: number[] | undefined, h: string): Diagram {
  if (!dpt?.length) return d;
  const texts = paragraphTexts(h);
  if (!texts.length) return d;
  const items = d.items.map((it) => ({ ...it }));
  dpt.forEach((ix, k) => {
    if (items[ix] && texts[k] !== undefined && texts[k] !== "") items[ix].text = texts[k];
  });
  return { ...d, items };
}
