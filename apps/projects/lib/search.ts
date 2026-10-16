import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { MY_PROJECTS } from "./projects";

/** What suite search can ask Projects for. */
export const KINDS = ["project", "task"];

type ProjectRow = { id: string; code: string; name: string; description: string; client_name: string; modified_at: Date };
type TaskRow = { id: string; project_id: string; project_name: string; title: string; notes: string; assigned_to: string | null; modified_at: Date };

/**
 * Suite search for one person: the projects they are on (by code, name, client and description)
 * and those projects' tasks (by title and notes). Anything deleted under a hold is left out.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const results: SearchResult[] = [];
  if (want("project")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["p.code", "p.name", "p.client_name", "p.description"], params.length + 1);
    params.push(...words.params);
    const rows = await q<ProjectRow>(
      `SELECT p.id, p.code, p.name, p.description, p.client_name, p.modified_at FROM projects p
       WHERE p.id IN ${MY_PROJECTS} AND ${words.sql} ORDER BY p.modified_at DESC, p.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "project",
        title: `${r.code} ${r.name}`,
        snippet: r.description ? snippet(r.description, s.parsed) : r.client_name,
        date: r.modified_at.toISOString(),
        url: `/?project=${r.id}`,
        ...(s.text ? { text: clipText([`${r.code} ${r.name}`, r.client_name && `Client: ${r.client_name}`, r.description].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  if (want("task")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["t.title", "t.notes"], params.length + 1);
    params.push(...words.params);
    const rows = await q<TaskRow>(
      `SELECT t.id, t.project_id, p.name AS project_name, t.title, t.notes, t.assigned_to, t.modified_at
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.project_id IN ${MY_PROJECTS} AND t.held_deleted_at IS NULL AND ${words.sql}
       ORDER BY t.modified_at DESC, t.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "task",
        title: r.title,
        snippet: r.notes ? snippet(r.notes, s.parsed) : r.project_name,
        date: r.modified_at.toISOString(),
        url: `/?project=${r.project_id}&task=${r.id}`,
        ...(r.assigned_to ? { person: r.assigned_to } : {}),
        ...(s.text ? { text: clipText([r.title, r.notes, `Project: ${r.project_name}`].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { app: APP, results: results.slice(0, s.limit) };
}
