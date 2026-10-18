// Suite-wide search (packages/search) for the signed-in person: the live records they can see in
// the CRM itself, by the same rule every list and record view uses (lib/access.ts). Records kept
// by a legal hold after deletion live in held_records and are for eDiscovery only, so they are
// never searched here.
import {
  isEmptyQuery, queryToSql, readSearchQuery, snippet, clipText, type ParsedQuery, type SearchResult, type SearchResults,
} from "@synergy/search";
import { visible } from "./access";
import { q } from "./db";
import { APP } from "./compliance";
import { CONTACT_MATCH } from "./contacts";
import { KINDS, OWNER, REFERRED_BY, RELATED_NAME, SOURCE, TEXT_KEYS, type Kind } from "./ediscovery";
import type { Ctx } from "./types";
import { likeTerm } from "./util";

/** The view each kind opens in (#/<view>/<id>). */
const VIEW: Record<Exclude<Kind, "activity">, string> = {
  account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities", partner: "partners",
};

const caseOf = (pick: (k: Kind) => string) => `CASE x.kind ${KINDS.map((k) => `WHEN '${k}' THEN ${pick(k)}`).join(" ")} END`;
const TEXT = caseOf((k) => `concat_ws(' ', ${TEXT_KEYS[k].map((f) => `x.r->>'${f}'`).join(", ")})`);
const TITLE = caseOf((k) => (k === "activity" ? "x.r->>'subject'" : "x.r->>'name'"));
const WHO = caseOf((k) => `x.r->>'${OWNER(k)}'`);
const DATE = `(x.r->>'updated_at')::timestamptz`;

/**
 * SQL over table alias t that is true when the record matches the query: each term must be
 * found (the same rules as queryToSql) in one of `hays`. Accounts and contacts can number in the
 * hundreds of thousands, so they match on their trigram-indexed search_text (lib/db.ts) before
 * anything is turned into JSON; the rest match on their TEXT_KEYS columns.
 */
function matches(k: Kind, p: ParsedQuery, params: unknown[]): string {
  if (k === "account" || k === "contact") {
    if (isEmptyQuery(p)) return "TRUE";
    const like = (term: string) => {
      params.push(likeTerm(term));
      const n = `$${params.length}`;
      return k === "account"
        ? `t.search_text ILIKE ${n}`
        : `t.id IN (${CONTACT_MATCH(n)})`;
    };
    const parts = p.groups.map((g) => `(${g.map(like).join(" OR ")})`);
    for (const term of p.none) parts.push(`NOT ${like(term)}`);
    return parts.join(" AND ") || "TRUE";
  }
  const column = (f: string) =>
    f === "account_name" ? "(SELECT name FROM accounts WHERE id = t.account_id)"
    : f === "related_name" ? `(${RELATED_NAME})`
    : f === "referred_by" ? REFERRED_BY(k === "lead" ? "lead_id" : "opportunity_id")
    : `t.${f}`;
  const words = queryToSql(p, TEXT_KEYS[k].map(column), params.length + 1);
  params.push(...words.params);
  return words.sql;
}

/** Every live record of `kinds` this person can see that matches the query, as (kind, r). */
const live = (ctx: Ctx, kinds: readonly Kind[], p: ParsedQuery, params: unknown[]) =>
  `(${kinds.map((k) => {
    const seen = visible(ctx, k, "t", params);
    return `SELECT '${k}'::text AS kind, s.r FROM (${SOURCE[k]} WHERE ${seen} AND ${matches(k, p, params)}) s`;
  }).join(" UNION ALL ")})`;

type Row = { kind: Kind; r: Record<string, unknown>; title: string; who: string; who_name: string | null; date: Date; text: string };

function url(r: Row): string {
  if (r.kind === "activity") {
    const t = String(r.r.related_type) as Exclude<Kind, "activity">;
    return VIEW[t] ? `/#/${VIEW[t]}/${r.r.related_id}` : "/#/myday";
  }
  return `/#/${VIEW[r.kind]}/${r.r.id}`;
}

export async function searchFor(ctx: Ctx, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const kinds = s.kinds.length ? KINDS.filter((k) => s.kinds.includes(k)) : [...KINDS];
  if (!kinds.length) return { app: APP, results: [] };
  const params: unknown[] = [s.limit];
  const from = live(ctx, kinds, s.parsed, params);
  const rows = await q<Row>(
    `SELECT x.kind, x.r, ${TITLE} AS title, ${WHO} AS who, ${DATE} AS date, ${TEXT} AS text,
            (SELECT nullif(m.name, '') FROM members m WHERE m.email = ${WHO}) AS who_name
     FROM ${from} x
     ORDER BY ${DATE} DESC, x.r->>'id'
     LIMIT $1`,
    params,
  );
  return {
    app: APP,
    results: rows.map((r): SearchResult => ({
      id: String(r.r.id),
      kind: r.kind,
      title: r.title,
      snippet: snippet(r.text, s.parsed),
      date: new Date(r.date).toISOString(),
      url: url(r),
      person: r.who_name || r.who,
      ...(s.text ? { text: clipText(r.text) } : {}),
    })),
  };
}
