// eDiscovery for the Admin center, and the legal hold on deletes. A record deleted while its owner
// is on hold is copied whole into held_records before it goes, so the CRM itself never sees it
// again but search and export still do (as deleted).
import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q, type Tq } from "./db";
import { APP, type Search, holdChecker, nextCursor, snippet } from "./compliance";

export const KINDS = ["account", "contact", "lead", "opportunity", "activity"] as const;
export type Kind = (typeof KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RELATED_NAME = `CASE t.related_type
    WHEN 'account' THEN (SELECT name FROM accounts WHERE id = t.related_id)
    WHEN 'contact' THEN (SELECT name FROM contacts WHERE id = t.related_id)
    WHEN 'lead' THEN (SELECT name FROM leads WHERE id = t.related_id)
    WHEN 'opportunity' THEN (SELECT name FROM opportunities WHERE id = t.related_id)
  END`;

/** Each kind's rows as JSON (`r`), with the names a reader needs alongside. */
export const SOURCE: Record<Kind, string> = {
  account: `SELECT to_jsonb(t) - 'search_text' AS r FROM accounts t`,
  contact: `SELECT to_jsonb(t) - 'search_text' || jsonb_build_object('account_name', (SELECT name FROM accounts WHERE id = t.account_id)) AS r FROM contacts t`,
  opportunity: `SELECT to_jsonb(t) || jsonb_build_object('account_name', (SELECT name FROM accounts WHERE id = t.account_id)) AS r FROM opportunities t`,
  lead: `SELECT to_jsonb(t) AS r FROM leads t`,
  activity: `SELECT to_jsonb(t) || jsonb_build_object('related_name', ${RELATED_NAME}) AS r FROM activities t`,
};

const TABLE: Record<Kind, string> = { account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities", activity: "activities" };

/** Who a record belongs to: its owner, or for an activity whoever it is assigned to. */
export const OWNER = (kind: Kind) => (kind === "activity" ? "assignee" : "owner");

/** What each kind says, as plain text, for keywords and snippets. */
export const TEXT_KEYS: Record<Kind, string[]> = {
  account: ["name", "industry", "website", "phone", "address", "city", "state", "postal_code", "type"],
  contact: ["name", "email", "phone", "title", "account_name"],
  opportunity: ["name", "stage", "amount", "close_date", "account_name"],
  lead: ["name", "company", "email", "phone", "status", "source", "score_rationale"],
  activity: ["subject", "body", "type", "status", "related_name"],
};

/**
 * Copies the rows of `kind` matching `where` (over alias t, params from $1) whose owner is on
 * hold into held_records. Call it in the delete's transaction, before the delete. An activity
 * is also kept when whoever logged it is held.
 */
export async function keepHeld(tq: Tq, by: string, kind: Kind, where: string, params: unknown[]): Promise<void> {
  const rows = await tq<{ id: string; owner: string; created_by: string | null }>(
    `SELECT t.id, t.${OWNER(kind)} AS owner, t.created_by FROM ${TABLE[kind]} t WHERE ${where}`,
    params,
  );
  if (!rows.length) return;
  const held = holdChecker();
  const keep: string[] = [];
  for (const r of rows) if ((await held(r.owner)) || (kind === "activity" && r.created_by && (await held(r.created_by)))) keep.push(r.id);
  if (!keep.length) return;
  await tq(
    `INSERT INTO held_records (id, kind, owner, record, deleted_by)
     SELECT (s.r->>'id')::uuid, $2, s.r->>'${OWNER(kind)}', s.r, $3 FROM (${SOURCE[kind]} WHERE t.id = ANY($1::uuid[])) s
     ON CONFLICT (id) DO NOTHING`,
    [keep, kind, by],
  );
}

/** Every record of every kind, live ones and those kept by a hold, as (kind, r, deleted_at). */
const RECORDS = `(${KINDS.map((k) => `SELECT '${k}'::text AS kind, s.r, NULL::timestamptz AS deleted_at FROM (${SOURCE[k]}) s`).join(" UNION ALL ")}
  UNION ALL SELECT kind, record, deleted_at FROM held_records)`;

const caseOf = (pick: (k: Kind) => string) => `CASE x.kind ${KINDS.map((k) => `WHEN '${k}' THEN ${pick(k)}`).join(" ")} END`;
const TEXT = caseOf((k) => `concat_ws(' ', ${TEXT_KEYS[k].map((f) => `x.r->>'${f}'`).join(", ")})`);
const TITLE = caseOf((k) => (k === "activity" ? "x.r->>'subject'" : "x.r->>'name'"));
const WHO = caseOf((k) => `x.r->>'${OWNER(k)}'`);
const DATE = `(x.r->>'updated_at')::timestamptz`;
const PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[x.r->>'created_by', x.r->>'updated_by']) e WHERE e IS NOT NULL AND e <> ${WHO} ORDER BY e)`;

type Row = { kind: Kind; r: Record<string, unknown>; deleted_at: Date | null; title: string; who: string; date: Date; text: string; people: string[]; total: string };

const COLUMNS = `x.kind, x.r, x.deleted_at, ${TITLE} AS title, ${WHO} AS who, ${DATE} AS date, ${TEXT} AS text, ${PEOPLE} AS people`;

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: String(r.r.id),
    kind: r.kind,
    title: r.title,
    owner: r.who,
    ...(r.people.length ? { participants: r.people } : {}),
    date: r.date.toISOString(),
    snippet: snippet(r.text, s.query),
    size: Buffer.byteLength(JSON.stringify(r.r)),
    ...(r.deleted_at ? { deleted: true } : {}),
  };
}

/** Records matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, s.kinds ?? KINDS];
  const words = queryToSql(s.query, [TEXT], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT ${COLUMNS}, COUNT(*) OVER () AS total FROM ${RECORDS} x
     WHERE x.kind = ANY($6::text[]) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR ${WHO} = ANY($1) OR x.r->>'created_by' = ANY($1) OR x.r->>'updated_by' = ANY($1))
       AND ($2::timestamptz IS NULL OR ${DATE} >= $2)
       AND ($3::timestamptz IS NULL OR ${DATE} < $3)
     ORDER BY ${DATE} DESC, x.r->>'id'
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each record in full, and for accounts, contacts, leads and deals their activity timeline. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT ${COLUMNS}, 0 AS total FROM ${RECORDS} x WHERE x.r->>'id' = ANY($1::text[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const id = String(r.r.id);
    const timeline =
      r.kind === "activity"
        ? undefined
        : (
            await q<{ r: Record<string, unknown>; deleted_at: Date | null }>(
              `SELECT x.r, x.deleted_at FROM ${RECORDS} x WHERE x.kind = 'activity' AND x.r->>'related_id' = $1 ORDER BY x.r->>'created_at'`,
              [id],
            )
          ).map((a) => ({
            id: a.r.id, type: a.r.type, subject: a.r.subject, body: a.r.body, status: a.r.status, dueAt: a.r.due_at,
            assignee: a.r.assignee, createdBy: a.r.created_by, createdAt: a.r.created_at, ...(a.deleted_at ? { deleted: true } : {}),
          }));
    items.push({
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: { ...r.r, ...(timeline ? { activities: timeline } : {}), ...(r.deleted_at ? { heldDeletedAt: r.deleted_at.toISOString() } : {}) },
      text: r.text,
    });
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
