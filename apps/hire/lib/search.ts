import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { q } from "./db";
import { STAGE_LABELS, type Stage, isRecruiter } from "./hire";

export const APP = "hire";

/** What suite search can ask Hire for. */
export const KINDS = ["job", "candidate"];

/** Suite search for one person: the jobs and candidates they can see (all of them for recruiters). */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const all = isRecruiter(me.email);
  const results: SearchResult[] = [];
  if (want("job")) {
    const params: unknown[] = [all, me.email.toLowerCase(), s.limit];
    const words = queryToSql(s.parsed, ["j.title", "j.department", "j.location", "j.description"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; title: string; department: string; location: string; status: string; description: string; modified_at: Date }>(
      `SELECT j.id, j.title, j.department, j.location, j.status, j.description, j.modified_at FROM jobs j
       WHERE ($1::boolean OR j.hiring_manager = $2) AND ${words.sql} ORDER BY j.modified_at DESC, j.id LIMIT $3`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "job",
        title: r.title,
        snippet: r.description ? snippet(r.description, s.parsed) : [r.department, r.location, r.status].filter(Boolean).join(" · "),
        date: r.modified_at.toISOString(),
        url: `/?job=${r.id}`,
        ...(s.text ? { text: clipText([r.title, [r.department, r.location].filter(Boolean).join(", "), `Status: ${r.status}`, r.description].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  if (want("candidate")) {
    const params: unknown[] = [all, me.email.toLowerCase(), s.limit];
    const words = queryToSql(s.parsed, ["c.name", "c.email", "c.cover_note"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; job_id: string; name: string; email: string; stage: Stage; cover_note: string; job: string; modified_at: Date }>(
      `SELECT c.id, c.job_id, c.name, c.email, c.stage, c.cover_note, j.title AS job, c.modified_at
       FROM candidates c JOIN jobs j ON j.id = c.job_id
       WHERE ($1::boolean OR j.hiring_manager = $2) AND ${words.sql} ORDER BY c.modified_at DESC, c.id LIMIT $3`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "candidate",
        title: r.name,
        snippet: `${r.job} · ${STAGE_LABELS[r.stage]}`,
        date: r.modified_at.toISOString(),
        url: `/?job=${r.job_id}&candidate=${r.id}`,
        person: r.email,
        ...(s.text ? { text: clipText(`${r.name} <${r.email}>\nApplied for ${r.job}, stage ${STAGE_LABELS[r.stage]}\n${r.cover_note}`) } : {}),
      });
    }
  }
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { app: APP, results: results.slice(0, s.limit) };
}
