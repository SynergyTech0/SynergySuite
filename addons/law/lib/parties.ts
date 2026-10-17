/**
 * Party names made comparable for conflict checks: case, punctuation and entity suffixes
 * evened out ("Acme, Inc." and "ACME INC" match), people put in LAST FIRST MIDDLE order
 * ("Jane Q. Doe" and "Doe, Jane Q" match), and "doing business as" names kept as aliases.
 * Scores are 0 to 100: 60% edit distance, 40% shared (or nearly shared) words.
 */

export type Normalized = {
  original: string;
  normalized: string;
  aliases: string[];
  isPerson: boolean;
  first?: string;
  middle?: string;
  last?: string;
  suffix?: string;
};

const ENTITY_SUFFIXES: { pattern: RegExp; normalized: string }[] = [
  { pattern: /\b(incorporated|inc|incorp)$/i, normalized: "INC" },
  { pattern: /\b(corporation|corp)$/i, normalized: "CORP" },
  { pattern: /\b(company|co)$/i, normalized: "CO" },
  { pattern: /\b(limited liability company|l l c|llc)$/i, normalized: "LLC" },
  { pattern: /\b(limited liability partnership|l l p|llp)$/i, normalized: "LLP" },
  { pattern: /\b(limited partnership|l p|lp)$/i, normalized: "LP" },
  { pattern: /\b(professional limited liability company|p l l c|pllc)$/i, normalized: "PLLC" },
  { pattern: /\b(professional corporation|p c|pc)$/i, normalized: "PC" },
  { pattern: /\b(professional association|p a|pa)$/i, normalized: "PA" },
  { pattern: /\b(limited|ltd)$/i, normalized: "LTD" },
  { pattern: /\b(n a)$/i, normalized: "NA" },
];

const PREFIXES = new Set(["MR", "MRS", "MS", "MISS", "DR", "PROF", "HON", "REV"]);
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "ESQ", "MD", "PHD", "CPA"]);

const BUSINESS = [
  /\bINC\b/, /\bCORP/, /\bLLC\b/, /\bLLP\b/, /\bLP\b/, /\bLTD\b/, /\bCO\b/, /\bCOMPANY\b/, /\bGROUP\b/, /\bHOLDINGS?\b/,
  /\bENTERPRISES?\b/, /\bASSOCIATES?\b/, /\bPARTNERS?\b/, /\bFOUNDATION\b/, /\bTRUST\b/, /\bESTATE OF\b/, /\bBANK\b/,
  /\bUNIVERSITY\b/, /\bCOUNTY\b/, /\bCITY OF\b/, /\bSTATE OF\b/, /\bDEPARTMENT\b/, /\bAND\b/,
];

const DBA = /\s*\(?\b(?:d[\s/]?b[\s/]?a|doing business as|t\/a|trading as|a[\s/]?k[\s/]?a|also known as|f[\s/]?k[\s/]?a|formerly known as)\b[\s:.-]*(.+?)\)?$/i;

function basic(s: string): string {
  return s.toUpperCase().replace(/&/g, " AND ").replace(/[^\w\s]/g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function tidy(s: string): string {
  return s.replace(/\b(THE|A|AN)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** A name ready to compare, and whether it reads as a person or an organization. */
export function normalize(name: string, kind?: "person" | "organization"): Normalized {
  const original = String(name ?? "").trim();
  const aliases: string[] = [];
  let working = original.replace(/\./g, "");
  const dba = working.match(DBA);
  if (dba?.[1]) {
    aliases.push(tidy(basic(dba[1])));
    working = working.slice(0, dba.index).trim();
  }
  const reordered = !kind || kind === "person" ? working.match(/^([^,]+),\s*([^,]+)$/) : null;
  let n = basic(working);
  const isPerson = kind
    ? kind === "person"
    : !BUSINESS.some((r) => r.test(n)) && !ENTITY_SUFFIXES.some((x) => x.pattern.test(n)) && n.split(" ").length >= 2 && n.split(" ").length <= 4;
  if (!isPerson) {
    let suffix = "";
    for (const s of ENTITY_SUFFIXES) {
      if (s.pattern.test(n)) {
        suffix = s.normalized;
        n = n.replace(s.pattern, "").trim();
        break;
      }
    }
    n = tidy(n);
    return { original, normalized: suffix ? `${n} ${suffix}`.trim() : n, aliases: [...new Set(aliases)].filter(Boolean), isPerson };
  }
  // "Doe, Jane Q" is already last-first; "Jane Q Doe" gets turned round.
  let words = (reordered ? `${basic(reordered[2])} ${basic(reordered[1])}` : n).split(" ").filter(Boolean);
  if (words.length > 1 && PREFIXES.has(words[0])) words = words.slice(1);
  let suffix: string | undefined;
  if (words.length > 1 && SUFFIXES.has(words[words.length - 1])) suffix = words.pop();
  const out: Normalized = { original, normalized: "", aliases: [...new Set(aliases)].filter(Boolean), isPerson, suffix };
  if (words.length === 1) out.last = words[0];
  else if (words.length >= 2) {
    out.first = words[0];
    out.last = words[words.length - 1];
    if (words.length > 2) out.middle = words.slice(1, -1).join(" ");
  }
  out.normalized = [out.last, out.first, out.middle].filter(Boolean).join(" ");
  return out;
}

/** The forms of a name worth comparing: itself, its aliases, and for people a first-last order. */
export function variants(n: Normalized): string[] {
  const v = [n.normalized, ...n.aliases];
  if (n.isPerson && n.first && n.last) v.push(`${n.last} ${n.first}`);
  if (!n.isPerson) v.push(n.normalized.replace(/\s+(INC|CORP|CO|LLC|LLP|LP|PLLC|PC|PA|LTD|NA)$/, ""));
  return [...new Set(v)].filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0 to 100: how alike two normalized names are. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const lev = Math.round((1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100);
  // Words count as shared when they are nearly the same, so one typo in a surname still matches.
  const ta = [...new Set(a.split(" "))];
  const tb = [...new Set(b.split(" "))];
  const close = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 4 && 1 - levenshtein(x, y) / Math.max(x.length, y.length) >= 0.8);
  const shared = ta.filter((t) => tb.some((u) => close(t, u))).length;
  const jac = Math.round((shared / (ta.length + tb.length - shared)) * 100);
  return Math.round(lev * 0.6 + jac * 0.4);
}

/** The best score between any form of one name and any form of another. */
export function bestMatch(a: Normalized, b: { normalized: string; aliases: string[] }): number {
  const left = variants(a);
  const right = [b.normalized, ...b.aliases].filter(Boolean);
  let best = 0;
  for (const x of left) for (const y of right) best = Math.max(best, similarity(x, y));
  return best;
}
