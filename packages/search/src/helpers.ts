import { parseQuery, type ParsedQuery } from "@synergy/compliance";
import { DEFAULT_RESULTS, MAX_RESULTS, MAX_TEXT, SNIPPET_LENGTH, type SearchQuery } from "./protocol";

export class SearchInputError extends Error {}

/** Checks a POST /api/search body. Throws SearchInputError (answer 400) when it is unusable. */
export function readSearchQuery(body: unknown): Required<Pick<SearchQuery, "query" | "limit" | "text">> & { kinds: string[]; parsed: ParsedQuery } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const query = typeof b.query === "string" ? b.query.trim().slice(0, 500) : "";
  const parsed = parseQuery(query);
  if (parsed.groups.length === 0) throw new SearchInputError("Type something to search for.");
  const n = Number(b.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_RESULTS) : DEFAULT_RESULTS;
  const kinds = Array.isArray(b.kinds) ? b.kinds.filter((k): k is string => typeof k === "string") : [];
  return { query, parsed, limit, kinds, text: b.text === true };
}

/** HTML or rich text to one line of plain text. */
export function plainText(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** About SNIPPET_LENGTH characters of `text` around the first search term found, with … where cut. */
export function snippet(text: string | null | undefined, parsed: ParsedQuery, length = SNIPPET_LENGTH): string {
  const t = plainText(text);
  if (t.length <= length) return t;
  const lower = t.toLowerCase();
  let at = -1;
  for (const g of parsed.groups) for (const term of g) {
    const i = lower.indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(length / 3), t.length - length));
  return (start > 0 ? "…" : "") + t.slice(start, start + length).trim() + (start + length < t.length ? "…" : "");
}

/** Plain text clipped to MAX_TEXT, for `text: true`. */
export function clipText(text: string | null | undefined, max = MAX_TEXT): string {
  const t = plainText(text);
  return t.length > max ? t.slice(0, max) + "…" : t;
}
