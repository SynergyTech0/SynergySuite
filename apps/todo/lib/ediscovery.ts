import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/** To Do's one kind of content for the Admin center: tasks, with their list, steps and notes. */
export const KINDS = ["task"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everyone else on a task: the list's members, whoever made, was given or finished it. */
const PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(
  ARRAY(SELECT m.email FROM list_members m WHERE m.list_id = t.list_id) || ARRAY[t.created_by, t.assigned_to, t.completed_by]
) e WHERE e IS NOT NULL AND e <> l.owner ORDER BY e)`;

const STEPS = `COALESCE((SELECT string_agg(s.title, ' ' ORDER BY s.position, s.id) FROM steps s WHERE s.task_id = t.id), '')`;

type Row = {
  id: string; title: string; notes: string; owner: string; list_name: string; participants: string[]; steps_text: string;
  modified_at: Date; held_deleted_at: Date | null; list_held: Date | null; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const body = [r.notes, r.steps_text].filter(Boolean).join(" ");
  return {
    id: r.id,
    kind: "task",
    title: r.title,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.modified_at.toISOString(),
    snippet: snippet(body || r.title, s.query),
    size: Buffer.byteLength(`${r.title} ${body}`),
    ...(r.held_deleted_at || r.list_held ? { deleted: true } : {}),
  };
}

const SELECT = `SELECT t.id, t.title, t.notes, l.owner, l.name AS list_name, ${PEOPLE} AS participants, ${STEPS} AS steps_text,
  t.modified_at, t.held_deleted_at, l.held_deleted_at AS list_held`;

/** Tasks matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("task")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["t.title", "t.notes", STEPS, "l.name"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `${SELECT}, COUNT(*) OVER () AS total
     FROM tasks t JOIN lists l ON l.id = t.list_id
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR l.owner = ANY($1) OR ${PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR t.modified_at >= $2)
       AND ($3::timestamptz IS NULL OR t.modified_at < $3)
     ORDER BY t.modified_at DESC, t.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each task in full: notes, steps, list and the people on it. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    list_id: string; important: boolean; due: string | null; repeat: string | null; assigned_to: string | null; created_by: string;
    created_at: Date; completed_at: Date | null; completed_by: string | null; reminder_at: Date | null; reminder_by: string | null;
    members: string[]; steps: { title: string; done: boolean; deleted: boolean }[] | null;
  }>(
    `${SELECT}, 0 AS total, t.list_id, t.important, to_char(t.due, 'YYYY-MM-DD') AS due, t.repeat, t.assigned_to, t.created_by,
       t.created_at, t.completed_at, t.completed_by, t.reminder_at, t.reminder_by,
       ARRAY(SELECT m.email FROM list_members m WHERE m.list_id = t.list_id ORDER BY m.added_at) AS members,
       (SELECT json_agg(json_build_object('title', s.title, 'done', s.done, 'deleted', s.held_deleted_at IS NOT NULL) ORDER BY s.position, s.id)
          FROM steps s WHERE s.task_id = t.id) AS steps
     FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => {
    const steps = r.steps ?? [];
    return {
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: {
        list: r.list_name,
        listId: r.list_id,
        listMembers: r.members,
        important: r.important,
        due: r.due,
        repeat: r.repeat,
        assignedTo: r.assigned_to,
        createdBy: r.created_by,
        createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at?.toISOString() ?? null,
        completedBy: r.completed_by,
        reminderAt: r.reminder_at?.toISOString() ?? null,
        reminderBy: r.reminder_by,
        notes: r.notes,
        steps,
        heldDeletedAt: (r.held_deleted_at ?? r.list_held)?.toISOString() ?? null,
      },
      text: [r.title, r.notes, ...steps.map((s) => `[${s.done ? "x" : " "}] ${s.title}`)].filter(Boolean).join("\n"),
    };
  });
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
