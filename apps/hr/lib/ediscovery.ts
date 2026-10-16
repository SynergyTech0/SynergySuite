import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { q } from "./db";

/**
 * HR's content for the Admin center: each person's employee record, their time off requests and
 * their paychecks. All of it belongs to the employee, so a custodian search finds a person's HR file.
 * HR never deletes these for good (people are marked inactive, requests cancelled), so nothing is
 * ever "deleted under hold" here.
 */
export const KINDS = ["employee", "timeoff", "paycheck"];

/** One row per item, the same columns for every kind. */
const ITEMS = `
  SELECT 'employee:' || e.id AS id, 'employee' AS kind, e.name || ' (employee record)' AS title, e.email AS owner,
    ARRAY_REMOVE(ARRAY[NULLIF(e.manager_email, '')], NULL) AS participants, e.modified_at AS date,
    concat_ws(' ', e.name, e.email, e.title, e.department, e.location, e.manager_email, e.phone, e.notes,
      e.emergency_contact, e.personal_email, e.home_address) AS body
  FROM employees e
  UNION ALL
  SELECT 'timeoff:' || r.id, 'timeoff', 'Time off: ' || r.kind || ' ' || r.start_date || ' to ' || r.end_date, r.employee_email,
    ARRAY_REMOVE(ARRAY[r.decided_by], NULL), r.created_at,
    concat_ws(' ', r.kind, r.status, r.note, r.decision_note)
  FROM pto_requests r
  UNION ALL
  SELECT 'paycheck:' || p.id, 'paycheck', 'Paycheck: pay run ' || r.number || ', paid ' || r.pay_date, p.employee_email,
    ARRAY[]::text[], r.pay_date::timestamptz,
    concat_ws(' ', p.employee_name, 'pay run', r.number, r.status)
  FROM paychecks p JOIN pay_runs r ON r.id = p.run_id WHERE r.status IN ('approved','paid')`;

type Row = { id: string; kind: string; title: string; owner: string; participants: string[]; date: Date; body: string; total: string };

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id, kind: r.kind, title: r.title, owner: r.owner, ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.date.toISOString(), snippet: snippet(r.body, s.query), size: Buffer.byteLength(r.body),
  };
}

export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, kinds];
  const words = queryToSql(s.query, ["u.title", "u.body"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT u.*, COUNT(*) OVER () AS total FROM (${ITEMS}) u
     WHERE u.kind = ANY($6) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR u.owner = ANY($1) OR u.participants && $1::text[])
       AND ($2::timestamptz IS NULL OR u.date >= $2) AND ($3::timestamptz IS NULL OR u.date < $3)
     ORDER BY u.date DESC, u.id LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

const ID = /^(employee|timeoff|paycheck):([0-9a-f-]{1,36})$/i;

/** Each item in full. Paychecks carry every earning, deduction and tax line. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => ID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row>(`SELECT u.*, 0 AS total FROM (${ITEMS}) u WHERE u.id = ANY($1)`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const [, kind, key] = ID.exec(r.id)!;
    let metadata: Record<string, unknown> = {};
    if (kind === "employee") {
      const [e] = await q(`SELECT id::text, email, name, title, department, location, manager_email, phone, pronouns, employment_type,
        to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, active, emergency_contact,
        personal_email, home_address, notes, pto_days_per_year::float, sick_days_per_year::float, created_at, modified_at
        FROM employees WHERE id::text = $1`, [key]);
      const checklists = await q(`SELECT c.title, c.kind, c.created_at, json_agg(json_build_object('task', t.title, 'owner', t.owner,
          'assignee', t.assignee, 'due', t.due, 'doneAt', t.done_at, 'doneBy', t.done_by) ORDER BY t.position) AS tasks
        FROM checklists c LEFT JOIN checklist_tasks t ON t.checklist_id = c.id WHERE c.employee_id::text = $1 GROUP BY c.id`, [key]);
      metadata = { record: e, checklists };
    } else if (kind === "timeoff") {
      const [t] = await q(`SELECT id::text, employee_email, kind, to_char(start_date, 'YYYY-MM-DD') AS start_date,
        to_char(end_date, 'YYYY-MM-DD') AS end_date, days::float, note, status, decided_by, decided_at, decision_note, created_at
        FROM pto_requests WHERE id::text = $1`, [key]);
      metadata = { request: t };
    } else {
      const [p] = await q(`SELECT p.id, r.number AS run, to_char(r.period_start, 'YYYY-MM-DD') AS period_start,
        to_char(r.period_end, 'YYYY-MM-DD') AS period_end, to_char(r.pay_date, 'YYYY-MM-DD') AS pay_date, r.status, p.hours, p.profile, p.result
        FROM paychecks p JOIN pay_runs r ON r.id = p.run_id WHERE p.id::text = $1`, [key]);
      metadata = { paycheck: p };
    }
    items.push({ ...hit(r, { query: { groups: [], none: [] } }), app: APP, metadata, text: r.body });
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
