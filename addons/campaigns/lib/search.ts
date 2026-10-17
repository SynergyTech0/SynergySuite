// Suite-wide search (packages/search) for the signed-in person. Every Campaigns member can read
// every campaign, template and audience (lib/members.ts: roles only govern changes), so this
// searches them all. Subscribers' addresses are not searched: they are customers' details, found
// inside the app by people who work with the lists.
import { queryToSql, readSearchQuery, snippet, clipText, type SearchResult, type SearchResults } from "@synergy/search";
import { q } from "./db";
import { APP } from "./compliance";
import { SOURCE, TEXT_KEYS } from "./ediscovery";
import type { Ctx } from "./types";

const KINDS = ["campaign", "template", "audience"] as const;
type Kind = (typeof KINDS)[number];

const SOURCES: Record<Kind, string> = {
  ...SOURCE,
  audience: "SELECT to_jsonb(t) AS r FROM audiences t",
};
const KEYS: Record<Kind, string[]> = { ...TEXT_KEYS, audience: ["name", "description"] };
const VIEW: Record<Kind, string> = { campaign: "campaigns", template: "templates", audience: "audiences" };

const caseOf = (pick: (k: Kind) => string) => `CASE x.kind ${KINDS.map((k) => `WHEN '${k}' THEN ${pick(k)}`).join(" ")} END`;
const TEXT = caseOf((k) => `concat_ws(' ', ${KEYS[k].map((f) => `x.r->>'${f}'`).join(", ")})`);
const DATE = `coalesce((x.r->>'started_at')::timestamptz, (x.r->>'updated_at')::timestamptz)`;

type Row = { kind: Kind; r: Record<string, unknown>; date: Date; text: string; who_name: string | null };

export async function searchFor(_ctx: Ctx, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const kinds = s.kinds.length ? KINDS.filter((k) => s.kinds.includes(k)) : [...KINDS];
  if (!kinds.length) return { app: APP, results: [] };
  const params: unknown[] = [kinds, s.limit];
  const words = queryToSql(s.parsed, [TEXT], params.length + 1);
  params.push(...words.params);
  const live = `(${kinds.map((k) => `SELECT '${k}'::text AS kind, s.r FROM (${SOURCES[k]}) s`).join(" UNION ALL ")})`;
  const rows = await q<Row>(
    `SELECT x.kind, x.r, ${DATE} AS date, ${TEXT} AS text,
            (SELECT nullif(m.name, '') FROM members m WHERE m.email = x.r->>'created_by') AS who_name
     FROM ${live} x
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
      title: String(r.r.name ?? ""),
      snippet: snippet(r.text, s.parsed),
      date: new Date(r.date).toISOString(),
      url: `/#/${VIEW[r.kind]}/${r.r.id}`,
      person: r.who_name || String(r.r.created_by ?? ""),
      ...(s.text ? { text: clipText(r.text) } : {}),
    })),
  };
}
