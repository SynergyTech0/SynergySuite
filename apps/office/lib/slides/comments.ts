// Slide comments. Threads and messages live in the suite's comment tables
// (/api/docs/:id/comments), written by the signed-in Synergy user; viewers with
// comment access cannot write to the shared deck, so a thread's place on the
// slide rides in its `quote`: "@slide/<slideId>/<x>/<y>[/<elementId>] <label>".
import type { Slide } from "./model";

export type CommentMsg = { id: string; author_email: string; author_name: string; body: string; created_ms: string };
export type CommentThread = { id: string; quote: string; resolved: boolean; created_ms: string; messages: CommentMsg[] };
export type Anchor = { slideId: string; x: number; y: number; el?: string; label: string };

const ANCHOR = /^@slide\/([A-Za-z0-9_-]+)\/(-?\d+)\/(-?\d+)(?:\/([A-Za-z0-9_-]+))? ?([\s\S]*)$/;

export function encodeAnchor(a: Anchor): string {
  const head = `@slide/${a.slideId}/${Math.round(a.x)}/${Math.round(a.y)}${a.el ? `/${a.el}` : ""}`;
  return `${head} ${a.label}`.slice(0, 300).trimEnd();
}

export function decodeAnchor(quote: string): Anchor | null {
  const m = ANCHOR.exec(quote || "");
  if (!m) return null;
  return { slideId: m[1], x: Number(m[2]), y: Number(m[3]), ...(m[4] ? { el: m[4] } : {}), label: m[5] || "" };
}

/** Threads anchored on each slide (by slide id), in creation order. */
export function threadsBySlide(threads: CommentThread[]): Map<string, { t: CommentThread; a: Anchor }[]> {
  const out = new Map<string, { t: CommentThread; a: Anchor }[]>();
  for (const t of threads) {
    const a = decodeAnchor(t.quote);
    if (!a) continue;
    const list = out.get(a.slideId) || [];
    list.push({ t, a });
    out.set(a.slideId, list);
  }
  return out;
}

/** Where a new comment goes: beside the selected object, else the slide's top-left corner. */
export function anchorFor(s: Slide, elId: string | null, W: number): Omit<Anchor, "label"> {
  const el = elId ? s.elements.find((e) => e.id === elId) : undefined;
  if (el) return { slideId: s.id, x: Math.min(W - 24, el.x + el.w), y: Math.max(0, el.y), el: el.id };
  return { slideId: s.id, x: 12, y: 12 };
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** @mentions in a comment body: "@" followed by an e-mail address. */
export const MENTION = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
export function mentionsIn(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];
}

// ---- PowerPoint (legacy) comments: p:cmLst parts plus ppt/commentAuthors.xml ----

/** One comment as PowerPoint stores it (positions in slide px). */
export type PptxComment = { slide: number; x: number; y: number; author: string; text: string; ms: number; thread?: string };

/** Legacy comment positions are in 1/8 pt; slide px are 3/4 pt. */
export const PX_TO_CM_POS = 6;

/** Flatten threads into PowerPoint comments for the slides they sit on (replies follow their thread). */
export function pptxComments(slides: Slide[], threads: CommentThread[]): PptxComment[] {
  const index = new Map(slides.map((s, i) => [s.id, i]));
  const out: PptxComment[] = [];
  for (const t of threads) {
    const a = decodeAnchor(t.quote);
    const slide = a ? index.get(a.slideId) : undefined;
    if (!a || slide === undefined || t.resolved) continue;
    for (const m of t.messages) out.push({ slide, x: a.x, y: a.y, author: m.author_name || m.author_email, text: m.body, ms: Number(m.created_ms) || 0, thread: t.id });
  }
  return out;
}
