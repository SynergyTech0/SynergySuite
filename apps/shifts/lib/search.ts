import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery } from "@synergy/search";
import type { Me } from "./api";
import { isScheduler } from "./access";
import { q } from "./db";

/** What suite search can ask Shifts for. */
export const KINDS = ["shift"];

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Suite search for one person: shifts by person, position, location and notes. Drafts only for schedulers. */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const results: SearchResult[] = [];
  if (!s.kinds.length || s.kinds.includes("shift")) {
    const params: unknown[] = [s.limit, isScheduler(me.email)];
    const words = queryToSql(s.parsed, ["coalesce(e.name, 'Open shift')", "coalesce(p.name, '')", "s.location", "s.notes"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; who: string; position: string | null; location: string; notes: string; day: string; start_min: number; end_min: number; published: boolean; updated_at: Date }>(
      `SELECT s.id::text, coalesce(e.name, 'Open shift') AS who, p.name AS position, s.location, s.notes, to_char(s.shift_date, 'YYYY-MM-DD') AS day,
              s.start_min, s.end_min, s.published, s.updated_at
       FROM shifts s LEFT JOIN employees e ON e.id = s.employee_id LEFT JOIN positions p ON p.id = s.position_id
       WHERE (s.published OR $2) AND ${words.sql} ORDER BY s.shift_date DESC, s.start_min, s.id LIMIT $1`,
      params,
    );
    for (const r of rows) {
      const about = [`${r.day} ${hm(r.start_min)}-${hm(r.end_min)}`, r.position, r.location, r.published ? "" : "draft"].filter(Boolean).join(" · ");
      results.push({
        id: r.id,
        kind: "shift",
        title: `${r.who}, ${r.day}`,
        snippet: r.notes ? `${about} · ${r.notes}` : about,
        date: r.updated_at.toISOString(),
        url: `/?week=${r.day}`,
        ...(s.text ? { text: clipText(`${r.who}\n${about}\n${r.notes}`) } : {}),
      });
    }
  }
  return { app: "shifts", results };
}
