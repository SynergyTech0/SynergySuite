// eDiscovery for the Admin center, and the legal hold on deletes. Campaigns (what an organization
// sent to its customers) and templates belong to whoever made them. One deleted while its maker is
// on hold is copied whole into held_records before it goes, so search and export still find it.
import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q, type Tq } from "./db";
import { APP, type Search, holdChecker, nextCursor, snippet } from "./compliance";

export const KINDS = ["campaign", "template"] as const;
export type Kind = (typeof KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Block text, flattened: what the email said.
const BODY = `coalesce((SELECT string_agg(coalesce(b->>'text', '') || ' ' || coalesce(b->>'url', ''), ' ') FROM jsonb_array_elements(t.blocks) b), '')`;

/** Each kind's rows as JSON (`r`), with the email's text alongside. */
export const SOURCE: Record<Kind, string> = {
  campaign: `SELECT (to_jsonb(t) - 'html') || jsonb_build_object('body_text', ${BODY},
      'audience_name', (SELECT name FROM audiences WHERE id = t.audience_id)) AS r FROM campaigns t`,
  template: `SELECT to_jsonb(t) || jsonb_build_object('body_text', ${BODY}) AS r FROM templates t`,
};

const TABLE: Record<Kind, string> = { campaign: "campaigns", template: "templates" };

export const TEXT_KEYS: Record<Kind, string[]> = {
  campaign: ["name", "subject", "preheader", "body_text", "audience_name", "status"],
  template: ["name", "subject", "preheader", "body_text"],
};

/** Copies the given rows whose maker is on hold into held_records. Call before the delete, in its transaction. */
export async function keepHeld(tq: Tq, by: string, kind: Kind, ids: string[]): Promise<void> {
  const rows = await tq<{ id: string; owner: string | null }>(`SELECT id, created_by AS owner FROM ${TABLE[kind]} WHERE id = ANY($1::uuid[])`, [ids]);
  const held = holdChecker();
  const keep: string[] = [];
  for (const r of rows) if (r.owner && (await held(r.owner))) keep.push(r.id);
  if (!keep.length) return;
  await tq(
    `INSERT INTO held_records (id, kind, owner, record, deleted_by)
     SELECT (s.r->>'id')::uuid, $2, s.r->>'created_by', s.r, $3 FROM (${SOURCE[kind]} WHERE t.id = ANY($1::uuid[])) s
     ON CONFLICT (id) DO NOTHING`,
    [keep, kind, by],
  );
}

const RECORDS = `(${KINDS.map((k) => `SELECT '${k}'::text AS kind, s.r, NULL::timestamptz AS deleted_at FROM (${SOURCE[k]}) s`).join(" UNION ALL ")}
  UNION ALL SELECT kind, record, deleted_at FROM held_records)`;

const caseOf = (pick: (k: Kind) => string) => `CASE x.kind ${KINDS.map((k) => `WHEN '${k}' THEN ${pick(k)}`).join(" ")} END`;
const TEXT = caseOf((k) => `concat_ws(' ', ${TEXT_KEYS[k].map((f) => `x.r->>'${f}'`).join(", ")})`);
const WHO = `coalesce(x.r->>'created_by', '')`;
const DATE = `coalesce((x.r->>'started_at')::timestamptz, (x.r->>'updated_at')::timestamptz)`;

type Row = { kind: Kind; r: Record<string, unknown>; deleted_at: Date | null; date: Date; text: string; total: string };
const COLUMNS = `x.kind, x.r, x.deleted_at, ${DATE} AS date, ${TEXT} AS text`;

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const people = [r.r.updated_by].filter((p): p is string => typeof p === "string" && p !== r.r.created_by);
  return {
    id: String(r.r.id),
    kind: r.kind,
    title: String(r.r.name ?? ""),
    owner: String(r.r.created_by ?? ""),
    ...(people.length ? { participants: people } : {}),
    date: new Date(r.date).toISOString(),
    snippet: snippet(r.text, s.query),
    size: Buffer.byteLength(JSON.stringify(r.r)),
    ...(r.deleted_at ? { deleted: true } : {}),
  };
}

export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, s.kinds ?? KINDS];
  const words = queryToSql(s.query, [TEXT], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT ${COLUMNS}, COUNT(*) OVER () AS total FROM ${RECORDS} x
     WHERE x.kind = ANY($6::text[]) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR ${WHO} = ANY($1) OR x.r->>'updated_by' = ANY($1))
       AND ($2::timestamptz IS NULL OR ${DATE} >= $2)
       AND ($3::timestamptz IS NULL OR ${DATE} < $3)
     ORDER BY ${DATE} DESC, x.r->>'id'
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT ${COLUMNS}, 0 AS total FROM ${RECORDS} x WHERE x.r->>'id' = ANY($1::text[])`, [wanted]);
  const items: ExportItem[] = rows.map((r) => ({
    ...hit(r, { query: { groups: [], none: [] } }),
    app: APP,
    metadata: { ...r.r, ...(r.deleted_at ? { heldDeletedAt: new Date(r.deleted_at).toISOString() } : {}) },
    text: r.text,
  }));
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
