import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { MY_LISTS } from "./todo";

/** What suite search can ask To Do for. */
export const KINDS = ["task"];

/** A task's steps as one line of text, without any deleted under a hold. */
const STEPS = `COALESCE((SELECT string_agg(s.title, ' ' ORDER BY s.position, s.id) FROM steps s
  WHERE s.task_id = t.id AND s.held_deleted_at IS NULL), '')`;

type Row = {
  id: string; list_id: string; list_name: string; title: string; notes: string; steps_text: string;
  person: string; modified_at: Date;
};

/**
 * Suite search for one person: tasks in their own lists and in lists shared with them (To Do's
 * own MY_LISTS rule), by title, notes, steps and list name. Anything deleted under a hold is left out.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("task")) return { app: APP, results: [] };
  const params: unknown[] = [me.email, s.limit];
  const words = queryToSql(s.parsed, ["t.title", "t.notes", STEPS, "l.name"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT t.id, t.list_id, l.name AS list_name, t.title, t.notes, ${STEPS} AS steps_text,
       COALESCE(t.assigned_to, l.owner) AS person, t.modified_at
     FROM tasks t JOIN lists l ON l.id = t.list_id
     WHERE t.list_id IN ${MY_LISTS} AND t.held_deleted_at IS NULL AND ${words.sql}
     ORDER BY t.modified_at DESC, t.id
     LIMIT $2`,
    params,
  );
  const results = rows.map((r): SearchResult => {
    const body = [r.notes, r.steps_text].filter(Boolean).join(" ");
    return {
      id: r.id,
      kind: "task",
      title: r.title,
      snippet: body ? snippet(body, s.parsed) : r.list_name,
      date: r.modified_at.toISOString(),
      url: `/?list=${r.list_id}&task=${r.id}`,
      person: r.person,
      ...(s.text ? { text: clipText([r.title, body, `List: ${r.list_name}`].filter(Boolean).join("\n")) } : {}),
    };
  });
  return { app: APP, results };
}
