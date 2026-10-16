// Morph transition and zoom navigation helpers.
//
// Morph pairs each object on the incoming slide with one on the outgoing
// slide (same id first, as duplicated slides from our own decks keep them when
// copied within a deck; then the same kind of object with the same content;
// then the same kind and shape) and moves it from where it was. Objects
// without a partner fade in or out.
import { bodyBox, htmlText, sectionsOf, titleBox, type Box, type Slide, type SlideElement } from "./model";

export type Geo = Box & { rot: number };
export type MorphPair = { from: string; to: string; a: Geo; b: Geo };

/** What an element shows, to match it with its look-alike on the other slide. */
function content(e: SlideElement): string {
  switch (e.type) {
    case "text": return `text:${htmlText(e.html).trim()}`;
    case "shape": return `shape:${e.shape}:${htmlText(e.html || "").trim()}`;
    case "image": return `image:${e.src.length}:${e.src.slice(-64)}`;
    case "media": return `media:${e.src}`;
    case "math": return `math:${e.latex}`;
    case "chart": return `chart:${e.chartType}`;
    case "table": return `table:${e.rows.length}x${e.rows[0]?.length || 0}`;
    case "zoom": return `zoom:${e.target}`;
    case "model3d": return `model3d:${e.src}`;
  }
}

/** Looser key: the same kind of object (a rectangle stays a rectangle). */
function kind(e: SlideElement): string {
  return e.type === "shape" ? `shape:${e.shape}` : e.type;
}

const geo = (b: Box, rot = 0): Geo => ({ x: b.x, y: b.y, w: b.w, h: b.h, rot });

/** Pairs of objects (element ids, or "title"/"body") on two slides, with their boxes on each. */
export function morphPairs(prev: Slide, cur: Slide, W: number, H: number): MorphPair[] {
  const out: MorphPair[] = [];
  const pt = titleBox(prev, W, H), ct = titleBox(cur, W, H);
  if (pt && ct && prev.title && cur.title) out.push({ from: "title", to: "title", a: geo(pt), b: geo(ct) });
  const pb = bodyBox(prev, W, H), cb = bodyBox(cur, W, H);
  if (pb && cb && prev.body && cur.body) out.push({ from: "body", to: "body", a: geo(pb), b: geo(cb) });
  const left = new Map(prev.elements.map((e) => [e.id, e]));
  const pending: SlideElement[] = [];
  for (const e of cur.elements) {
    const p = left.get(e.id);
    if (p && p.type === e.type) {
      left.delete(e.id);
      out.push({ from: p.id, to: e.id, a: geo(p, p.rot), b: geo(e, e.rot) });
    } else pending.push(e);
  }
  for (const pass of [content, kind]) {
    for (let k = 0; k < pending.length; k++) {
      const e = pending[k];
      const key = pass(e);
      const p = [...left.values()].find((x) => pass(x) === key);
      if (!p) continue;
      left.delete(p.id);
      pending.splice(k--, 1);
      out.push({ from: p.id, to: e.id, a: geo(p, p.rot), b: geo(e, e.rot) });
    }
  }
  return out;
}

/** The keyframes moving one object from its old box to its new one (individual transform properties, about its centre). */
export function morphFrames(p: MorphPair): { translate: string; scale: string; rotate: string }[] {
  const dx = p.a.x + p.a.w / 2 - (p.b.x + p.b.w / 2);
  const dy = p.a.y + p.a.h / 2 - (p.b.y + p.b.h / 2);
  const sx = p.b.w ? p.a.w / p.b.w : 1, sy = p.b.h ? p.a.h / p.b.h : 1;
  let dr = (p.a.rot - p.b.rot) % 360;
  if (dr > 180) dr -= 360;
  if (dr < -180) dr += 360;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [
    { translate: `${r(dx)}px ${r(dy)}px`, scale: `${r(sx)} ${r(sy)}`, rotate: `${r(dr)}deg` },
    { translate: "0px 0px", scale: "1 1", rotate: "0deg" },
  ];
}

/**
 * Where a zoom leads in the slide show (positions in the list of visible
 * slides): a slide zoom shows its slide, a section zoom the whole section
 * the slide starts. `null` when the slide is hidden or gone.
 */
export function zoomRange(slides: Slide[], visible: number[], target: string, kind: "slide" | "section"): { start: number; end: number } | null {
  const at = slides.findIndex((s) => s.id === target);
  const start = visible.indexOf(at);
  if (at < 0 || start < 0) return null;
  if (kind === "slide") return { start, end: start };
  const sec = sectionsOf(slides).find((s) => s.start <= at && at < s.end);
  const last = sec && sec.start === at ? sec.end - 1 : at;
  let end = start;
  while (end + 1 < visible.length && visible[end + 1] <= last) end++;
  return { start, end };
}

/** Boxes for `n` zooms in a grid under a title (16:9-ish thumbnails, centred). */
export function zoomGrid(n: number, W: number, H: number, top = Math.round(H * 0.26)): Box[] {
  if (n <= 0) return [];
  const cols = Math.min(n, n <= 4 ? n : n <= 6 ? 3 : 4);
  const rows = Math.ceil(n / cols);
  const gap = Math.round(W * 0.025);
  const availW = W * 0.88, availH = H - top - H * 0.08;
  const ar = H / W;
  let w = (availW - gap * (cols - 1)) / cols;
  if ((w * ar + gap) * rows - gap > availH) w = ((availH + gap) / rows - gap) / ar;
  const h = w * ar;
  const total = cols * w + (cols - 1) * gap;
  const x0 = (W - total) / 2;
  const r = (v: number) => Math.round(v);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    // centre a short last row
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const xr = x0 + ((cols - inRow) * (w + gap)) / 2;
    return { x: r(xr + col * (w + gap)), y: r(top + row * (h + gap)), w: r(w), h: r(h) };
  });
}

/**
 * A summary zoom: each picked slide starts a section (named after its title
 * unless it already starts one), and a new summary slide holding a section
 * zoom per section goes in front of the first of them.
 */
export function summaryZoom(slides: Slide[], picked: string[], W: number, H: number, newId: (p: string) => string): { at: number; sections: { index: number; name: string }[]; slide: Slide } | null {
  const idx = picked.map((id) => slides.findIndex((s) => s.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return null;
  const sections = idx.filter((i) => slides[i].sec === undefined).map((i) => ({ index: i, name: (slides[i].title.split("\n")[0] || `Section ${idx.indexOf(i) + 1}`).slice(0, 60) }));
  const boxes = zoomGrid(idx.length, W, H);
  const slide: Slide = {
    id: newId("s"),
    title: "Summary",
    body: "",
    notes: "",
    layout: "titleOnly",
    bg: "",
    bgImg: "",
    elements: idx.map((i, k) => ({ id: newId("e"), z: k + 1, type: "zoom", kind: "section", target: slides[i].id, ret: true, ...boxes[k] })),
  };
  return { at: idx[0], sections, slide };
}
