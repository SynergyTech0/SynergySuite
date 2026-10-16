// Designer: layout ideas for a slide, and drafting a deck from an outline.
//
// Built-in ideas rearrange what is on the slide (its title, its bullets, its
// pictures) into a few proven arrangements. An AI model (see ai-server.ts)
// can propose more: it answers with boxes for the same objects, which
// `fromAiIdea` checks and clamps before anything is shown. Drafting turns an
// outline (or a model's answer in the same shape) into slides.
import { bodyBox, escapeHtml, htmlText, titleBox, toHtml, type Box, type ImageEl, type ShapeEl, type Slide, type SlideElement, type TextEl } from "./model";

export type Idea = { id: string; name: string; slide: Slide };

/** The bullets of a slide body (top level, as text). */
export function bulletsOf(html: string): string[] {
  const h = toHtml(html);
  if (!h) return [];
  const items = [...h.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => htmlText(m[1].replace(/<(ul|ol)\b[\s\S]*$/i, "")).trim()).filter(Boolean);
  if (items.length) return items;
  return [...h.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => htmlText(m[1]).trim()).filter(Boolean);
}

const r = (n: number) => Math.round(n);
const rb = (b: Box): Box => ({ x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) });

/** The largest box of the picture's shape inside `area`, centred. */
function fit(el: { w: number; h: number }, area: Box): Box {
  const ar = el.w / Math.max(1, el.h);
  let w = area.w, h = w / ar;
  if (h > area.h) {
    h = area.h;
    w = h * ar;
  }
  return rb({ x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h });
}

/** A picture cropped to fill `area` exactly (keeping its proportions). */
function cover(el: ImageEl, area: Box): Partial<ImageEl> {
  const ar = el.w / Math.max(1, el.h), want = area.w / Math.max(1, area.h);
  const crop = ar > want ? { l: (1 - want / ar) / 2, r: (1 - want / ar) / 2, t: 0, b: 0 } : { t: (1 - ar / want) / 2, b: (1 - ar / want) / 2, l: 0, r: 0 };
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const c = { l: round(crop.l), t: round(crop.t), r: round(crop.r), b: round(crop.b) };
  return { ...rb(area), ...(c.l || c.t || c.r || c.b ? { crop: c } : { crop: undefined }) };
}

const base = (s: Slide): Slide => ({ ...s, elements: s.elements.map((e) => ({ ...e }) as SlideElement) });

/**
 * Layout ideas for a slide, most fitting first. `accent` is the theme's
 * accent colour (hex) for the shapes an idea adds.
 */
export function designIdeas(s: Slide, W: number, H: number, accent: string, newId: (p: string) => string): Idea[] {
  const out: Idea[] = [];
  const pics = s.elements.filter((e): e is ImageEl => e.type === "image");
  const others = s.elements.filter((e) => e.type !== "image");
  const bullets = bulletsOf(s.body);
  const hasTitle = !!s.title.trim();
  const m = W * 0.06; // margin
  const titleH = H * 0.15;
  const add = (id: string, name: string, f: (x: Slide) => void) => {
    const x = base(s);
    f(x);
    out.push({ id, name, slide: x });
  };
  const move = (x: Slide, id: string, b: Partial<SlideElement>) => {
    const k = x.elements.findIndex((e) => e.id === id);
    if (k >= 0) x.elements[k] = { ...x.elements[k], ...b } as SlideElement;
  };

  if (pics.length === 1) {
    const p = pics[0];
    // picture on one side, text on the other
    for (const side of ["right", "left"] as const) {
      add(`pic-${side}`, side === "right" ? "Picture right" : "Picture left", (x) => {
        x.layout = bullets.length || x.body ? "content" : "titleOnly";
        const half = W / 2;
        const area: Box = side === "right" ? { x: half, y: 0, w: half, h: H } : { x: 0, y: 0, w: half, h: H };
        move(x, p.id, { ...cover(p, area), z: -1 } as Partial<SlideElement>);
        const tx = side === "right" ? m : half + m * 0.6;
        x.tbox = rb({ x: tx, y: H * 0.1, w: half - m * 1.6, h: titleH });
        x.bbox = rb({ x: tx, y: H * 0.1 + titleH + H * 0.03, w: half - m * 1.6, h: H * 0.62 });
      });
    }
    // full-bleed picture behind a title band
    add("pic-full", "Picture background", (x) => {
      x.layout = bullets.length ? "content" : "titleOnly";
      move(x, p.id, { ...cover(p, { x: 0, y: 0, w: W, h: H }), z: -2 } as Partial<SlideElement>);
      const band: ShapeEl = { id: newId("e"), z: -1, type: "shape", shape: "rect", x: 0, y: r(H * 0.62), w: W, h: r(H * 0.38), fill: "111827", line: null } as ShapeEl;
      x.elements.push(band);
      x.tbox = rb({ x: m, y: H * 0.64, w: W - 2 * m, h: H * 0.13 });
      x.tstyle = { ...(x.tstyle || {}), color: "FFFFFF" };
      if (bullets.length) {
        x.bbox = rb({ x: m, y: H * 0.77, w: W - 2 * m, h: H * 0.2 });
        x.bstyle = { ...(x.bstyle || {}), color: "FFFFFF" };
      }
    });
  } else if (pics.length > 1) {
    // a row (or grid) of pictures under the title, text beside or below
    add("pic-grid", "Picture gallery", (x) => {
      x.layout = hasTitle ? "titleOnly" : "blank";
      x.tbox = rb({ x: m, y: H * 0.06, w: W - 2 * m, h: titleH });
      const n = pics.length, cols = n <= 3 ? n : Math.ceil(n / 2), rows = Math.ceil(n / cols);
      const top = H * 0.26, gap = W * 0.02, cw = (W - 2 * m - gap * (cols - 1)) / cols, ch = (H - top - m - gap * (rows - 1)) / rows;
      pics.forEach((p, i) => move(x, p.id, cover(p, { x: m + (i % cols) * (cw + gap), y: top + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }) as Partial<SlideElement>));
      if (bullets.length) {
        // bullets go under the pictures' captions as a text box
        x.body = "";
        const tb: TextEl = { id: newId("e"), z: 50, type: "text", x: r(m), y: r(H - m * 0.95), w: r(W - 2 * m), h: r(m * 0.8), html: `<p>${escapeHtml(bullets.join(" · "))}</p>`, valign: "middle", autofit: "shrink" };
        x.elements.push(tb);
      }
    });
  }

  if (!pics.length && bullets.length >= 2 && bullets.length <= 6 && !others.length) {
    // each bullet in a card
    add("cards", "Cards", (x) => {
      x.layout = "titleOnly";
      x.body = "";
      const n = bullets.length, cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols);
      const top = H * 0.27, gap = W * 0.025, cw = (W - 2 * m - gap * (cols - 1)) / cols, ch = Math.min(H * 0.5, (H - top - m - gap * (rows - 1)) / rows);
      bullets.forEach((b, i) => {
        const card: ShapeEl = { id: newId("e"), z: i + 1, type: "shape", shape: "roundRect", x: r(m + (i % cols) * (cw + gap)), y: r(top + Math.floor(i / cols) * (ch + gap)), w: r(cw), h: r(ch), fill: accent, line: null, html: `<p style="text-align: center"><span style="color: #ffffff">${escapeHtml(b)}</span></p>`, valign: "middle", autofit: "shrink" } as ShapeEl;
        x.elements.push(card);
      });
    });
    // numbered steps down the slide
    add("steps", "Numbered steps", (x) => {
      x.layout = "titleOnly";
      x.body = "";
      const n = bullets.length, top = H * 0.26, gap = H * 0.025, rowH = Math.min(H * 0.13, (H - top - m - gap * (n - 1)) / n);
      bullets.forEach((b, i) => {
        const y = top + i * (rowH + gap);
        x.elements.push({ id: newId("e"), z: 2 * i + 1, type: "shape", shape: "ellipse", x: r(m), y: r(y), w: r(rowH), h: r(rowH), fill: accent, line: null, html: `<p style="text-align: center"><span style="color: #ffffff"><strong>${i + 1}</strong></span></p>`, valign: "middle" } as ShapeEl);
        x.elements.push({ id: newId("e"), z: 2 * i + 2, type: "text", x: r(m + rowH + W * 0.02), y: r(y), w: r(W - 2 * m - rowH - W * 0.02), h: r(rowH), html: `<p>${escapeHtml(b)}</p>`, valign: "middle", autofit: "shrink" } as TextEl);
      });
    });
  }
  if (!pics.length && bullets.length >= 4 && !others.length) {
    add("columns", "Two columns", (x) => {
      x.layout = "titleOnly";
      x.body = "";
      const half = Math.ceil(bullets.length / 2), cw = (W - 2 * m - W * 0.04) / 2;
      [bullets.slice(0, half), bullets.slice(half)].forEach((list, k) => {
        x.elements.push({ id: newId("e"), z: k + 1, type: "text", x: r(m + k * (cw + W * 0.04)), y: r(H * 0.26), w: r(cw), h: r(H * 0.66), html: `<ul>${list.map((b) => `<li><p>${escapeHtml(b)}</p></li>`).join("")}</ul>`, valign: "top", autofit: "shrink" } as TextEl);
      });
    });
  }
  if (hasTitle) {
    // a coloured band behind the title
    add("band", "Title band", (x) => {
      const tb = titleBox(x, W, H) || { x: m, y: H * 0.06, w: W - 2 * m, h: titleH };
      x.elements.push({ id: newId("e"), z: -1, type: "shape", shape: "rect", x: 0, y: r(tb.y - H * 0.02), w: W, h: r(tb.h + H * 0.04), fill: accent, line: null } as ShapeEl);
      x.tstyle = { ...(x.tstyle || {}), color: "FFFFFF" };
    });
    if (!bullets.length && !s.elements.length) {
      // a statement slide: big centred title
      add("statement", "Statement", (x) => {
        x.layout = "titleOnly";
        x.tbox = rb({ x: m, y: H * 0.3, w: W - 2 * m, h: H * 0.4 });
        x.tstyle = { ...(x.tstyle || {}), align: "center", size: 54 };
        x.elements.push({ id: newId("e"), z: 1, type: "shape", shape: "rect", x: r(W / 2 - W * 0.05), y: r(H * 0.72), w: r(W * 0.1), h: r(H * 0.012), fill: accent, line: null } as ShapeEl);
      });
    }
  }
  return out;
}

// ---- AI ideas: the model places the slide's own objects ----

export type AiItem = { id: string; x: number; y: number; w: number; h: number };
export type AiShape = { shape: string; x: number; y: number; w: number; h: number; color?: string; behind?: boolean };
export type AiIdea = { name?: string; title?: Box; body?: Box; items?: AiItem[]; shapes?: AiShape[]; titleColor?: string };

/** What the model is told about a slide (no picture data leaves the server). */
export function describeSlide(s: Slide, W: number, H: number) {
  const tb = titleBox(s, W, H), bb = bodyBox(s, W, H);
  return {
    size: { w: W, h: H },
    title: s.title ? { text: s.title.slice(0, 300), box: tb && rb(tb) } : undefined,
    body: s.body ? { bullets: bulletsOf(s.body).slice(0, 20).map((b) => b.slice(0, 200)), box: bb && rb(bb) } : undefined,
    items: s.elements.slice(0, 40).map((e) => ({
      id: e.id,
      kind: e.type === "shape" ? `shape:${e.shape}` : e.type,
      box: rb(e),
      ...(e.type === "image" ? { aspect: Math.round((e.w / Math.max(1, e.h)) * 100) / 100, alt: e.alt?.slice(0, 120) } : {}),
      ...(e.type === "text" || e.type === "shape" ? { text: htmlText(e.html || "").slice(0, 160) } : {}),
    })),
  };
}

export const AI_IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "two or three words naming the layout" },
          title: { $ref: "#/$defs/box" },
          body: { $ref: "#/$defs/box" },
          titleColor: { type: "string", description: "6-digit hex, only when the title sits on a dark shape or picture" },
          items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["id", "x", "y", "w", "h"] } },
          shapes: {
            type: "array",
            maxItems: 6,
            description: "decorative shapes to add (bands, panels, accent bars)",
            items: { type: "object", properties: { shape: { type: "string", enum: ["rect", "roundRect", "ellipse"] }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, color: { type: "string", description: "6-digit hex or 'accent'" }, behind: { type: "boolean" } }, required: ["shape", "x", "y", "w", "h"] },
          },
        },
        required: ["name"],
      },
    },
  },
  required: ["ideas"],
  $defs: { box: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] } },
} as const;

const HEX = /^[0-9a-f]{6}$/i;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A box from a model's answer, kept on the slide and at least 8 px each way; undefined when it is not a box. */
export function clampBox(v: unknown, W: number, H: number): Box | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (![o.x, o.y, o.w, o.h].every(finite)) return undefined;
  const w = Math.min(W, Math.max(8, o.w as number)), h = Math.min(H, Math.max(8, o.h as number));
  const x = Math.min(W - w, Math.max(0, o.x as number)), y = Math.min(H - h, Math.max(0, o.y as number));
  return rb({ x, y, w, h });
}

/** A model's idea applied to the slide, after checking every value; null when nothing usable is left. */
export function fromAiIdea(s: Slide, raw: unknown, W: number, H: number, accent: string, newId: (p: string) => string, k: number): Idea | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as AiIdea;
  const x = base(s);
  let changed = false;
  const tb = clampBox(o.title, W, H);
  if (tb && s.title && s.layout !== "blank") {
    x.tbox = tb;
    changed = true;
  }
  const bb = clampBox(o.body, W, H);
  if (bb && s.body && s.layout !== "blank" && s.layout !== "titleOnly") {
    x.bbox = bb;
    changed = true;
  }
  for (const it of Array.isArray(o.items) ? o.items.slice(0, 60) : []) {
    const at = x.elements.findIndex((e) => e.id === (it as AiItem)?.id);
    const b = clampBox(it, W, H);
    if (at < 0 || !b) continue;
    const e = x.elements[at];
    // pictures keep their proportions
    x.elements[at] = { ...e, ...(e.type === "image" && !e.crop ? fit(e, b) : b) } as SlideElement;
    changed = true;
  }
  let z = -100;
  let top = Math.max(0, ...x.elements.map((e) => e.z));
  for (const sh of Array.isArray(o.shapes) ? o.shapes.slice(0, 6) : []) {
    const b = clampBox(sh, W, H);
    const kind = ["rect", "roundRect", "ellipse"].includes(String(sh?.shape)) ? String(sh.shape) : "rect";
    if (!b) continue;
    const fill = sh.color && HEX.test(sh.color) ? sh.color.toUpperCase() : accent;
    x.elements.push({ id: newId("e"), z: sh.behind === false ? ++top : ++z, type: "shape", shape: kind, ...b, fill, line: null } as ShapeEl);
    changed = true;
  }
  if (o.titleColor && HEX.test(o.titleColor) && x.title) x.tstyle = { ...(x.tstyle || {}), color: o.titleColor.toUpperCase() };
  if (!changed) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 40) : `Idea ${k + 1}`;
  return { id: `ai-${k}`, name, slide: x };
}

// ---- drafting a deck ----

export type DraftSlide = { title: string; bullets: string[]; notes?: string };
export type Draft = { title: string; subtitle?: string; slides: DraftSlide[] };

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "the presentation's title" },
    subtitle: { type: "string" },
    slides: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: { type: "array", maxItems: 8, items: { type: "string" }, description: "short points, a line each" },
          notes: { type: "string", description: "what the speaker says" },
        },
        required: ["title", "bullets"],
      },
    },
  },
  required: ["title", "slides"],
} as const;

/**
 * An outline as a deck. The first line is the presentation's title (a second
 * unindented line right after it, its subtitle); each further unindented line
 * starts a slide and the indented or "-" lines under it are its bullets.
 * Lines starting "Notes:" or ">" are speaker notes.
 */
export function parseDeckOutline(src: string): Draft {
  const lines = src.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const d: Draft = { title: "", slides: [] };
  let cur: DraftSlide | null = null;
  let headDone = false;
  for (const raw of lines) {
    const lead = /^[\t ]*/.exec(raw)![0].replace(/\t/g, "    ").length;
    const t = raw.trim();
    const note = /^(notes?:|>)\s*/i.exec(t);
    const bullet = /^([-*•]|\d+[.)])\s+/.exec(t);
    const heading = /^#{1,6}\s+/.exec(t);
    const text = t.slice((note || bullet || heading)?.[0].length ?? 0).trim();
    if (!text) continue;
    if (note) {
      if (cur) cur.notes = cur.notes ? `${cur.notes}\n${text}` : text;
      continue;
    }
    const top = (lead === 0 && !bullet) || !!heading;
    if (!d.title && top) {
      d.title = text;
      continue;
    }
    if (!headDone && !cur && top && !d.subtitle && !heading) {
      d.subtitle = text;
      continue;
    }
    headDone = true;
    if (top || !cur) {
      cur = { title: text, bullets: [] };
      d.slides.push(cur);
      if (!top) cur.title = "";
      if (!top) cur.bullets.push(text);
    } else cur.bullets.push(text);
  }
  return d;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** A model's draft, checked: strings trimmed, at most `max` slides and 8 bullets each. */
export function cleanDraft(raw: unknown, max = 30): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const slides = (Array.isArray(o.slides) ? o.slides : []).slice(0, max).map((s) => {
    const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return { title: str(x.title, 200), bullets: (Array.isArray(x.bullets) ? x.bullets : []).slice(0, 8).map((b) => str(b, 300)).filter(Boolean), ...(str(x.notes, 2000) ? { notes: str(x.notes, 2000) } : {}) };
  }).filter((s) => s.title || s.bullets.length);
  const title = str(o.title, 200);
  if (!title && !slides.length) return null;
  return { title: title || "Presentation", ...(str(o.subtitle, 300) ? { subtitle: str(o.subtitle, 300) } : {}), slides };
}

/** Slides for a draft: a title slide, then one content slide per entry. */
export function draftSlides(d: Draft, newId: (p: string) => string): Slide[] {
  const s0: Slide = { id: newId("s"), title: d.title, body: d.subtitle ? `<p>${escapeHtml(d.subtitle)}</p>` : "", notes: "", layout: "title", bg: "", bgImg: "", elements: [] };
  return [
    s0,
    ...d.slides.map((x) => ({
      id: newId("s"),
      title: x.title,
      body: x.bullets.length ? `<ul>${x.bullets.map((b) => `<li><p>${escapeHtml(b)}</p></li>`).join("")}</ul>` : "",
      notes: x.notes || "",
      layout: (x.bullets.length ? "content" : "titleOnly") as Slide["layout"],
      bg: "",
      bgImg: "",
      elements: [],
    })),
  ];
}
