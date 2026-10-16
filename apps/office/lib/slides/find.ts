// Find and replace across a deck: slide titles, body text, text boxes, shape
// text, table cells and speaker notes. Rich text is searched in its text
// nodes only, so tags and attributes are never matched or rewritten; a match
// that spans a formatting change (half bold, half not) is not found.
import type { Slide, SlideElement } from "./model";
import { htmlPlain } from "./table";

export type FindOpts = { matchCase?: boolean; wholeWord?: boolean };
/** Where a match is: a slide field, an element, or one table cell. */
export type FindHit = { slide: number; key: string; count: number };

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findRegex(query: string, o: FindOpts = {}): RegExp | null {
  if (!query) return null;
  const body = escRe(query);
  return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, `gu${o.matchCase ? "" : "i"}`);
}

const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e] as string);
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");

/** Text segments of an HTML fragment (between tags), decoded. */
function segments(html: string): { tag: boolean; text: string }[] {
  return html.split(/(<[^>]*>)/).map((part) => (part.startsWith("<") ? { tag: true, text: part } : { tag: false, text: decode(part) }));
}

export function countInText(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

export function countInHtml(html: string, re: RegExp): number {
  return segments(html).reduce((n, s) => n + (s.tag ? 0 : countInText(s.text, re)), 0);
}

export function replaceInText(text: string, re: RegExp, by: string): string {
  return text.replace(re, () => by);
}

export function replaceInHtml(html: string, re: RegExp, by: string): string {
  return segments(html)
    .map((s) => (s.tag ? s.text : encode(replaceInText(s.text, re, by))))
    .join("");
}

/** Every place the query occurs, in deck order (title, body, objects by z, notes). */
export function findAll(slides: Slide[], query: string, o: FindOpts = {}): FindHit[] {
  const re = findRegex(query, o);
  if (!re) return [];
  const hits: FindHit[] = [];
  slides.forEach((s, i) => {
    const add = (key: string, count: number) => count && hits.push({ slide: i, key, count });
    add("title", countInText(s.title, re));
    add("body", countInHtml(s.body, re));
    for (const e of [...s.elements].sort((a, b) => a.z - b.z)) {
      if (e.type === "text" || e.type === "shape") add(e.id, countInHtml(e.html || "", re));
      else if (e.type === "table") e.rows.forEach((r, ri) => r.forEach((c, ci) => add(`${e.id}:${ri}:${ci}`, countInText(c.text, re))));
    }
    add("notes", countInText(s.notes, re));
  });
  return hits;
}

/** A changed copy of one element with every match replaced (null when nothing matched). */
export function replaceInElement(e: SlideElement, re: RegExp, by: string, cell?: [number, number]): SlideElement | null {
  if ((e.type === "text" || e.type === "shape") && e.html && countInHtml(e.html, re)) return { ...e, html: replaceInHtml(e.html, re, by) };
  if (e.type === "table") {
    let changed = false;
    const rows = e.rows.map((r, ri) =>
      r.map((c, ci) => {
        if (cell && (cell[0] !== ri || cell[1] !== ci)) return c;
        if (!countInText(c.text, re)) return c;
        changed = true;
        // rich cells: replace in the HTML's text and keep the plain text in step
        if (c.html) {
          const html = replaceInHtml(c.html, re, by);
          return { ...c, html, text: htmlPlain(html) };
        }
        return { ...c, text: replaceInText(c.text, re, by) };
      }),
    );
    return changed ? { ...e, rows } : null;
  }
  return null;
}
