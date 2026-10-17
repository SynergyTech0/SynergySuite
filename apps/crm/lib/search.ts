// Suite-wide search (packages/search) for the signed-in person: the live records they can see in
// the CRM itself, by the same rule every list and record view uses (lib/access.ts). Records kept
// by a legal hold after deletion live in held_records and are for eDiscovery only, so they are
// never searched here.
import { queryToSql, readSearchQuery, snippet, clipText, type SearchResult, type SearchResults } from "@synergy/search";
import { visible } from "./access";
import { q } from "./db";
import { APP } from "./compliance";
import { KINDS, OWNER, SOURCE, TEXT_KEYS, type Kind } from "./ediscovery";
import type { Ctx } from "./types";

/** The view each kind opens in (#/<view>/<id>). */
const VIEW: Record<Exclude<Kind, "activity">, string> = {
  account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities", partner: "partners",
};

const caseOf = (pick: (k: Kind) => string) => `CASE x.kind ${KINDS.map((k) => `WHEN '${k}' THEN ${pick(k)}`).join(" ")} END`;
const TEXT = caseOf((k) => `concat_ws(' ', ${TEXT_KEYS[k].map((f) => `x.r->>'${f}'`).join(", ")})`);
const TITLE = caseOf((k) => (k === "activity" ? "x.r->>'subject'" : "x.r->>'name'"));
const WHO = caseOf((k) => `x.r->>'${OWNER(k)}'`);
const DATE = `(x.r->>'updated_at')::timestamptz`;
/** Every live record this person can see, as (kind, r). */
const live = (ctx: Ctx, params: unknown[]) =>
  `(${KINDS.map((k) => `SELECT '${k}'::text AS kind, s.r FROM (${SOURCE[k]} WHERE ${visible(ctx, k, "t", params)}) s`).join(" UNION ALL ")})`;

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
  const params: unknown[] = [kinds, s.limit];
  const from = live(ctx, params);
  const words = queryToSql(s.parsed, [TEXT], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT x.kind, x.r, ${TITLE} AS title, ${WHO} AS who, ${DATE} AS date, ${TEXT} AS text,
            (SELECT nullif(m.name, '') FROM members m WHERE m.email = ${WHO}) AS who_name
     FROM ${from} x
     WHERE x.kind = ANY($1::text[]) AND ${words.sql}
     ORDER BY ${DATE} DESC, x.r->>'id'
     LIMIT $2`,
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
