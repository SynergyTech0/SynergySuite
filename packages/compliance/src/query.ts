/**
 * The keyword language every app searches with, so a matter's query means the same thing in Mail
 * as in Drive: words must all appear, "quoted phrases" stay together, OR joins alternatives,
 * -word or -"phrase" excludes. Matching is case-insensitive substring matching.
 */
export interface ParsedQuery {
  /** Each group must match; a group matches when any of its terms appears. */
  groups: string[][];
  /** None of these may appear. */
  none: string[];
}

export function parseQuery(q: string | undefined | null): ParsedQuery {
  const tokens: { text: string; neg: boolean; or: boolean }[] = [];
  const re = /(-?)"([^"]*)"|(\S+)/g;
  for (let m; (m = re.exec(q ?? "")); ) {
    if (m[3] === "OR") { tokens.push({ text: "", neg: false, or: true }); continue; }
    const neg = m[1] === "-" || (m[3]?.startsWith("-") && m[3].length > 1);
    const text = (m[2] ?? (neg ? m[3].slice(1) : m[3])).trim().toLowerCase();
    if (text) tokens.push({ text, neg, or: false });
  }
  const groups: string[][] = [];
  const none: string[] = [];
  let joinNext = false;
  for (const t of tokens) {
    if (t.or) { joinNext = groups.length > 0; continue; }
    if (t.neg) { none.push(t.text); joinNext = false; continue; }
    if (joinNext) groups[groups.length - 1].push(t.text);
    else groups.push([t.text]);
    joinNext = false;
  }
  return { groups, none };
}

export function isEmptyQuery(p: ParsedQuery): boolean {
  return p.groups.length === 0 && p.none.length === 0;
}

/** In-memory check, for apps that filter content they have already loaded. */
export function matchesQuery(text: string, p: ParsedQuery): boolean {
  const t = text.toLowerCase();
  return p.groups.every((g) => g.some((term) => t.includes(term))) && !p.none.some((term) => t.includes(term));
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * A Postgres WHERE fragment for the query over the given text expressions (columns or
 * expressions such as `coalesce(body,'')`), with numbered parameters starting at `$first`.
 * Returns `{ sql: "TRUE", params: [] }` for an empty query.
 */
export function queryToSql(p: ParsedQuery, columns: string[], first = 1): { sql: string; params: string[] } {
  if (isEmptyQuery(p) || columns.length === 0) return { sql: "TRUE", params: [] };
  const hay = `(${columns.map((c) => `coalesce(${c}::text,'')`).join(" || ' ' || ")})`;
  const params: string[] = [];
  const like = (term: string) => {
    params.push(`%${likeEscape(term)}%`);
    return `${hay} ILIKE $${first + params.length - 1}`;
  };
  const parts = p.groups.map((g) => `(${g.map(like).join(" OR ")})`);
  for (const term of p.none) parts.push(`NOT (${like(term)})`);
  return { sql: parts.join(" AND "), params };
}
