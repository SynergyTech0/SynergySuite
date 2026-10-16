import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import { APP } from "./compliance";
import { q } from "./db";
import type { Viewer } from "./hr";

/** What suite search can ask HR for: people in the directory, and time off the person may see. */
export const KINDS = ["person", "timeoff"];

type Row = { id: string; kind: string; title: string; body: string; person: string; date: Date };

/**
 * Suite search for one person. Everyone finds colleagues by name, title, team, place or email
 * (directory fields only). Time off is found by the person who asked for it, their managers and HR.
 */
export async function searchFor(v: Viewer, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const results: SearchResult[] = [];

  if (want("person")) {
    const params: unknown[] = [s.limit];
    const cols = ["e.name", "e.email", "e.title", "e.department", "e.location"];
    const words = queryToSql(s.parsed, [`concat_ws(' ', ${cols.join(", ")})`], params.length + 1);
    params.push(...words.params);
    const rows = await q<Row>(
      `SELECT e.id::text AS id, 'person' AS kind, e.name AS title, concat_ws(' · ', NULLIF(e.title, ''), NULLIF(e.department, ''), NULLIF(e.location, '')) AS body,
         e.email AS person, e.modified_at AS date
       FROM employees e WHERE e.active AND ${words.sql} ORDER BY lower(e.name) LIMIT $1`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: `person:${r.id}`, kind: "person", title: r.title, snippet: r.body || r.person, date: r.date.toISOString(),
        url: `/?person=${r.id}`, person: r.person, ...(s.text ? { text: clipText(`${r.title}\n${r.body}\n${r.person}`) } : {}),
      });
    }
  }

  if (want("timeoff")) {
    const params: unknown[] = [s.limit, v.email, v.roles.hrAdmin, [...v.team]];
    const body = "concat_ws(' ', COALESCE(e.name, r.employee_email), r.kind, r.note, r.decision_note, r.status)";
    const words = queryToSql(s.parsed, [body], params.length + 1);
    params.push(...words.params);
    const rows = await q<Row>(
      `SELECT r.id::text AS id, 'timeoff' AS kind,
         COALESCE(e.name, r.employee_email) || ': ' || r.kind || ', ' || to_char(r.start_date, 'Mon FMDD') ||
           CASE WHEN r.end_date > r.start_date THEN ' to ' || to_char(r.end_date, 'Mon FMDD') ELSE '' END AS title,
         concat_ws(' ', r.status, NULLIF(r.note, '')) AS body, r.employee_email AS person, r.created_at AS date
       FROM pto_requests r LEFT JOIN employees e ON e.email = r.employee_email
       WHERE (r.employee_email = $2 OR $3 OR r.employee_email = ANY($4)) AND ${words.sql}
       ORDER BY r.start_date DESC LIMIT $1`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: `timeoff:${r.id}`, kind: "timeoff", title: r.title, snippet: snippet(r.body, s.parsed), date: r.date.toISOString(),
        url: `/?tab=timeoff`, person: r.person, ...(s.text ? { text: clipText(`${r.title}\n${r.body}`) } : {}),
      });
    }
  }

  return { app: APP, results: results.slice(0, s.limit) };
}
