import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { q } from "./db";
import { isAuthor } from "./learn";

export const APP = "learn";

/** What suite search can ask Learn for. */
export const KINDS = ["course", "lesson"];

/** Suite search: published courses and their lessons (every course for authors). */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const all = isAuthor(me.email);
  const results: SearchResult[] = [];
  if (want("course")) {
    const params: unknown[] = [all, s.limit];
    const words = queryToSql(s.parsed, ["c.title", "c.description", "c.category"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; title: string; description: string; category: string; modified_at: Date }>(
      `SELECT c.id, c.title, c.description, c.category, c.modified_at FROM courses c
       WHERE (c.published OR $1::boolean) AND ${words.sql} ORDER BY c.modified_at DESC, c.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "course",
        title: r.title,
        snippet: r.description ? snippet(r.description, s.parsed) : r.category,
        date: r.modified_at.toISOString(),
        url: `/?course=${r.id}`,
        ...(s.text ? { text: clipText(`${r.title} (${r.category})\n${r.description}`) } : {}),
      });
    }
  }
  if (want("lesson")) {
    const params: unknown[] = [all, s.limit];
    const words = queryToSql(s.parsed, ["l.title", "l.content"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; course_id: string; title: string; content: string; course: string; modified_at: Date }>(
      `SELECT l.id, l.course_id, l.title, l.content, c.title AS course, l.modified_at FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE (c.published OR $1::boolean) AND ${words.sql} ORDER BY l.modified_at DESC, l.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "lesson",
        title: r.title,
        snippet: r.content ? snippet(r.content, s.parsed) : r.course,
        date: r.modified_at.toISOString(),
        url: `/?course=${r.course_id}&lesson=${r.id}`,
        ...(s.text ? { text: clipText(`${r.title} (in ${r.course})\n${r.content}`) } : {}),
      });
    }
  }
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { app: APP, results: results.slice(0, s.limit) };
}
