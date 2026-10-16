import { parseQuery } from "@synergy/search";

/**
 * Orders results from every app into one list. Pure: the same hits, terms and clock always give
 * the same order. A term found in the title counts more than one found in the snippet; a title
 * holding every term, or the whole phrase, counts more again; recent (or soon upcoming) items
 * get a small bonus. Ties keep the newest first, then the apps' own order.
 */

export interface Rankable {
  app: string;
  id: string;
  title: string;
  snippet: string;
  date: string;
}

/** The words of a query (or several) that score a hit: every positive term, lower-cased, unique. */
export function queryTerms(...queries: string[]): string[] {
  const out = new Set<string>();
  for (const q of queries) for (const g of parseQuery(q).groups) for (const t of g) if (t) out.add(t);
  return [...out];
}

const DAY = 86_400_000;

function count(hay: string, term: string): number {
  let n = 0;
  for (let i = hay.indexOf(term); i >= 0 && n < 5; i = hay.indexOf(term, i + term.length)) n++;
  return n;
}

const wordAt = (hay: string, term: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(hay);

/** Recency bonus: up to 2 points, halving about every two weeks away from now (either side). */
export function recency(date: string, now: number): number {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return 0;
  const days = Math.abs(now - t) / DAY;
  return 2 / (1 + days / 14);
}

export function score(hit: Rankable, terms: string[], now: number): number {
  const title = hit.title.toLowerCase();
  const snip = hit.snippet.toLowerCase();
  let s = 0;
  let inTitle = 0;
  for (const term of terms) {
    if (title.includes(term)) {
      inTitle++;
      s += 4 + (wordAt(title, term) ? 1 : 0);
    }
    const n = count(snip, term);
    if (n) s += 1 + Math.min(n - 1, 2) * 0.5;
  }
  if (terms.length > 1 && inTitle === terms.length) s += 3;
  if (terms.length > 1 && title.includes(terms.join(" "))) s += 3;
  return s + recency(hit.date, now);
}

/** A ranked copy of `hits` for `terms` (see queryTerms). `appOrder` breaks the last ties. */
export function rank<T extends Rankable>(hits: readonly T[], terms: string[], now: number = Date.now(), appOrder: readonly string[] = []): T[] {
  const order = new Map(appOrder.map((a, i) => [a, i]));
  return hits
    .map((hit, i) => ({ hit, i, s: score(hit, terms, now), t: Date.parse(hit.date) || 0 }))
    .sort((a, b) =>
      b.s - a.s ||
      b.t - a.t ||
      (order.get(a.hit.app) ?? 999) - (order.get(b.hit.app) ?? 999) ||
      a.i - b.i)
    .map((x) => x.hit);
}

/** Keeps the first of each app + id. */
export function dedupe<T extends { app: string; id: string }>(hits: readonly T[]): T[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.app}\u0000${h.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
