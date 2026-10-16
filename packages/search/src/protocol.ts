/**
 * Suite-wide search for the person who is signed in. The Search app sends each content app the
 * same request, on that person's behalf, through the same gateway headers the app already trusts
 * (X-Auth-Request-Email plus X-Proxy-Auth-Secret), so the app answers with only what that person
 * could open there themselves. This is not eDiscovery: no custodians, no deleted items, no token.
 *
 * Search app → app:
 *   POST /api/search   SearchQuery → SearchResults
 *
 * The query uses the suite's keyword language (see parseQuery in @synergy/compliance).
 */

export interface SearchQuery {
  query: string;
  /** Page size; apps cap it at MAX_RESULTS. */
  limit?: number;
  /** Limit to some of the app's kinds. Empty = all. */
  kinds?: string[];
  /** Ask for each hit's text (up to MAX_TEXT characters), for the assistant to read. */
  text?: boolean;
}

export interface SearchResult {
  /** Stable within the app. */
  id: string;
  /** The app's own name for it: "message", "file", "event", "ticket"… */
  kind: string;
  title: string;
  /** A short piece of the content around the first match, plain text. */
  snippet: string;
  /** ISO timestamp: sent, modified or starts. */
  date: string;
  /** Where to open it, as a path in the app ("/?id=…"), or a full URL. */
  url: string;
  /** Who it is from or belongs to, when that means something (sender, owner, assignee). */
  person?: string;
  /** Only when text was asked for: plain text, at most MAX_TEXT characters. */
  text?: string;
}

export interface SearchResults {
  app: string;
  results: SearchResult[];
}

export const MAX_RESULTS = 50;
export const DEFAULT_RESULTS = 20;
export const MAX_TEXT = 4000;
export const SNIPPET_LENGTH = 200;
