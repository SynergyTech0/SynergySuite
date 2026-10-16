import { inflateRawSync } from "node:zlib";
import { UserError } from "./util";

/**
 * Reading draw.io files on the server: enough to check what is saved, count its pages and pull
 * out the words in it for search. The editor itself does all the drawing.
 *
 * A file is one <mxfile> holding a <diagram> per page. A page is either an <mxGraphModel> or,
 * in files written by older or other draw.io builds, that model deflated, base64'd and URL-encoded.
 */

/** Large diagrams with pictures pasted in can reach a few megabytes; this is well past that. */
export function maxBytes(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.DIAGRAMS_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 25) * 1024 * 1024;
}

const EMPTY_MODEL = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

function pageId(): string {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

/** A file with one empty page. */
export function blankXml(): string {
  return `<mxfile><diagram id="${pageId()}" name="Page-1">${EMPTY_MODEL}</diagram></mxfile>`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A page's model as XML, whether it was stored inline or compressed. Null when it can't be read. */
export function pageModel(inner: string): string | null {
  const t = inner.trim();
  if (!t) return EMPTY_MODEL;
  if (t.startsWith("<")) return t;
  try {
    const raw = inflateRawSync(Buffer.from(t, "base64")).toString("latin1");
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export type Page = { id: string; name: string; model: string | null };

const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** The pages of a file, in order. */
export function pages(xml: string): Page[] {
  const out: Page[] = [];
  for (const m of xml.matchAll(/<diagram\b([^>]*?)(?:\/>|>([\s\S]*?)<\/diagram>)/g)) {
    const a = attrs(m[1]);
    out.push({ id: a.id ?? "", name: a.name ?? `Page-${out.length + 1}`, model: pageModel(m[2] ?? "") });
  }
  return out;
}

/** Plain text of an HTML label. */
function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<\/(div|p|li|tr)>/gi, " ").replace(/<[^>]*>/g, ""));
}

/** Attributes of <object>/<UserObject> that are draw.io's own, not the person's data. */
const OBJECT_SKIP = new Set(["id", "placeholders", "tooltip", "link", "tags", "style", "parent"]);

/** The words on one page: shape and connector labels, and the data fields on shapes. */
export function modelText(model: string): string[] {
  const out: string[] = [];
  for (const m of model.matchAll(/<(mxCell|object|UserObject)\b([^>]*)>/g)) {
    const a = attrs(m[2]);
    if (m[1] === "mxCell") {
      if (a.value) out.push(stripHtml(a.value));
    } else {
      for (const [k, v] of Object.entries(a)) if (!OBJECT_SKIP.has(k) && v) out.push(stripHtml(v));
    }
  }
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export type Summary = { pages: number; text: string };

/** Page count and searchable text: page names, then each page's words. */
export function summarize(xml: string): Summary {
  const ps = pages(xml);
  const words: string[] = [];
  for (const p of ps) {
    if (!/^Page-\d+$/.test(p.name)) words.push(p.name);
    if (p.model) words.push(...modelText(p.model));
  }
  return { pages: Math.max(ps.length, 1), text: [...new Set(words)].join("\n").slice(0, 200_000) };
}

/**
 * Checks a file the editor (or an upload) sent and returns it as an <mxfile>. A bare
 * <mxGraphModel> becomes a one-page file.
 */
export function cleanXml(v: unknown, env: Record<string, string | undefined> = process.env): string {
  if (typeof v !== "string") throw new UserError("A diagram must be draw.io XML");
  let xml = v.replace(/^﻿/, "").trim().replace(/^<\?xml[^>]*\?>\s*/, "");
  if (Buffer.byteLength(xml) > maxBytes(env)) throw new UserError("That diagram is too large to save", 413);
  if (xml.startsWith("<mxGraphModel")) xml = `<mxfile><diagram id="${pageId()}" name="Page-1">${xml}</diagram></mxfile>`;
  if (!/^<mxfile[\s>]/.test(xml) || !/<\/mxfile>$/.test(xml)) throw new UserError("That isn't a draw.io diagram");
  if (!pages(xml).length) throw new UserError("That diagram has no pages");
  return xml;
}
