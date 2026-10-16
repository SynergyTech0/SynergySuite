import { holdChecker } from "./compliance";
import { q, tx } from "./db";
import { addDays, daysBetween, isDay, nextDue } from "./dates";
import { COLORS, REPEATS, type Counts, type List, type Repeat, type SmartView, type Task } from "./types";
import { UserError, cleanEmail, text } from "./util";

type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

// Access

/** Lists someone can see: their own and the ones shared with them (not ones kept by a legal hold). */
export const MY_LISTS = `(SELECT id FROM lists WHERE owner = $1 AND held_deleted_at IS NULL
  UNION SELECT m.list_id FROM list_members m JOIN lists ml ON ml.id = m.list_id AND ml.held_deleted_at IS NULL WHERE m.email = $1)`;

async function canUse(email: string, listId: string, tq: Tq = q): Promise<{ owner: string; isDefault: boolean }> {
  const [row] = await tq<{ owner: string; is_default: boolean }>(
    `SELECT owner, is_default FROM lists WHERE id = $2::uuid AND id IN ${MY_LISTS}`,
    [email, listId],
  );
  if (!row) throw new UserError("List not found", 404);
  return { owner: row.owner, isDefault: row.is_default };
}

async function ownList(email: string, listId: string): Promise<{ isDefault: boolean }> {
  const l = await canUse(email, listId);
  if (l.owner !== email) throw new UserError("Only the list's owner can do that", 403);
  return l;
}

async function taskList(email: string, taskId: string, tq: Tq = q): Promise<string> {
  const [row] = await tq<{ list_id: string }>(`SELECT list_id FROM tasks WHERE id = $2::uuid AND held_deleted_at IS NULL AND list_id IN ${MY_LISTS}`, [email, taskId]);
  if (!row) throw new UserError("Task not found", 404);
  return row.list_id;
}

// Lists

/** Everyone starts with a "Tasks" list, made the first time they open To Do. */
export async function defaultList(email: string): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO lists (owner, name, is_default) VALUES ($1, 'Tasks', true)
     ON CONFLICT (owner) WHERE is_default DO UPDATE SET name = lists.name RETURNING id`,
    [email],
  );
  return row.id;
}

export async function lists(email: string): Promise<List[]> {
  await defaultList(email);
  const rows = await q<{ id: string; name: string; color: string; is_default: boolean; owner: string; members: string[] | null; open: number }>(
    `SELECT l.id, l.name, l.color, l.is_default, l.owner,
       (SELECT array_agg(m.email ORDER BY m.added_at) FROM list_members m WHERE m.list_id = l.id) AS members,
       (SELECT count(*)::int FROM tasks t WHERE t.list_id = l.id AND t.completed_at IS NULL AND t.held_deleted_at IS NULL) AS open
     FROM lists l WHERE l.id IN ${MY_LISTS}
     ORDER BY (l.is_default AND l.owner = $1) DESC, l.created_at`,
    [email],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color as List["color"], isDefault: r.is_default, owner: r.owner, members: r.members ?? [], open: r.open }));
}

function listName(v: unknown): string {
  const name = text(v, 100);
  if (!name) throw new UserError("Give the list a name");
  return name;
}

function color(v: unknown): string {
  return COLORS.includes(v as never) ? String(v) : "blue";
}

export async function createList(email: string, name: unknown, c?: unknown): Promise<List> {
  const [row] = await q<{ id: string }>(`INSERT INTO lists (owner, name, color) VALUES ($1, $2, $3) RETURNING id`, [email, listName(name), color(c)]);
  return (await lists(email)).find((l) => l.id === row.id)!;
}

export async function updateList(email: string, id: string, v: { name?: unknown; color?: unknown }): Promise<void> {
  const l = await ownList(email, id);
  if (v.name !== undefined) {
    if (l.isDefault) throw new UserError("Your Tasks list can't be renamed");
    await q(`UPDATE lists SET name = $2 WHERE id = $1::uuid`, [id, listName(v.name)]);
  }
  if (v.color !== undefined) await q(`UPDATE lists SET color = $2 WHERE id = $1::uuid`, [id, color(v.color)]);
}

/**
 * Deletes a list and its tasks. Tasks whose owner or creator is on legal hold are kept instead,
 * with the list, out of everyone's sight and still found by eDiscovery.
 */
export async function deleteList(email: string, id: string): Promise<void> {
  const l = await ownList(email, id);
  if (l.isDefault) throw new UserError("Your Tasks list can't be deleted");
  const held = holdChecker();
  const tasks = await q<{ id: string; created_by: string }>(`SELECT id, created_by FROM tasks WHERE list_id = $1::uuid`, [id]);
  const keep: string[] = [];
  for (const t of tasks) if ((await held(email)) || (await held(t.created_by))) keep.push(t.id);
  if (!keep.length && !(await held(email))) {
    await q(`DELETE FROM lists WHERE id = $1::uuid`, [id]);
    return;
  }
  await tx(async (tq) => {
    await tq(`DELETE FROM tasks WHERE list_id = $1::uuid AND id <> ALL($2::uuid[])`, [id, keep]);
    await tq(`DELETE FROM my_day WHERE task_id = ANY($1::uuid[])`, [keep]);
    await tq(`UPDATE lists SET held_deleted_at = now() WHERE id = $1::uuid`, [id]);
  });
}

/** Whether a task's list owner or creator is on legal hold. */
async function taskHeld(id: string): Promise<boolean> {
  const [t] = await q<{ owner: string; created_by: string }>(
    `SELECT l.owner, t.created_by FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = $1::uuid`,
    [id],
  );
  const held = holdChecker();
  return !!t && ((await held(t.owner)) || (await held(t.created_by)));
}

export async function share(email: string, id: string, who: unknown): Promise<void> {
  const l = await ownList(email, id);
  if (l.isDefault) throw new UserError("Make a new list to share; your Tasks list stays yours");
  const to = cleanEmail(who);
  if (to === email) throw new UserError("You already own this list");
  await q(`INSERT INTO list_members (list_id, email, added_by) VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING`, [id, to, email]);
}

/** The owner removes someone, or a member leaves. Their My Day picks and assignments on the list go too. */
export async function unshare(email: string, id: string, who: unknown): Promise<void> {
  const l = await canUse(email, id);
  const target = String(who ?? "").toLowerCase();
  if (l.owner !== email && target !== email) throw new UserError("Only the list's owner can do that", 403);
  await tx(async (tq) => {
    await tq(`DELETE FROM list_members WHERE list_id = $1::uuid AND email = $2`, [id, target]);
    await tq(`DELETE FROM my_day WHERE email = $2 AND task_id IN (SELECT id FROM tasks WHERE list_id = $1::uuid)`, [id, target]);
    await tq(`UPDATE tasks SET assigned_to = NULL WHERE list_id = $1::uuid AND assigned_to = $2 AND held_deleted_at IS NULL`, [id, target]);
  });
}

// Tasks

type Row = {
  id: string; list_id: string; list_name: string; title: string; notes: string; important: boolean; due: string | null;
  reminder_at: Date | null; reminder_by: string | null; repeat: Repeat | null; assigned_to: string | null; my_day: boolean;
  completed_at: Date | null; completed_by: string | null; created_by: string; created_at: Date;
  steps: { id: string; title: string; done: boolean }[] | null;
};

// $1 is the viewer and $2 is today, in every query that uses these columns.
const COLS = `t.id, t.list_id, l.name AS list_name, t.title, t.notes, t.important, to_char(t.due, 'YYYY-MM-DD') AS due,
  t.reminder_at, t.reminder_by, t.repeat, t.assigned_to, t.completed_at, t.completed_by, t.created_by, t.created_at,
  EXISTS (SELECT 1 FROM my_day d WHERE d.task_id = t.id AND d.email = $1 AND d.day = $2::date) AS my_day,
  (SELECT json_agg(json_build_object('id', s.id, 'title', s.title, 'done', s.done) ORDER BY s.position, s.id)
     FROM steps s WHERE s.task_id = t.id AND s.held_deleted_at IS NULL) AS steps`;

function toTask(r: Row, viewer: string): Task {
  return {
    id: r.id, listId: r.list_id, listName: r.list_name, title: r.title, notes: r.notes, important: r.important,
    due: r.due,
    // A reminder is personal to whoever set it.
    reminderAt: r.reminder_at && r.reminder_by === viewer ? r.reminder_at.toISOString() : null,
    repeat: r.repeat, assignedTo: r.assigned_to, myDay: r.my_day,
    completedAt: r.completed_at?.toISOString() ?? null, completedBy: r.completed_by,
    createdBy: r.created_by, createdAt: r.created_at.toISOString(), steps: r.steps ?? [],
  };
}

function today(v: unknown): string {
  if (!isDay(v)) throw new UserError("Bad date");
  return v;
}

export type TaskQuery = { view?: SmartView; list?: string; today: string; q?: string };

export async function tasks(email: string, opts: TaskQuery): Promise<Task[]> {
  const day = today(opts.today);
  const params: unknown[] = [email, day];
  const where = [`t.list_id IN ${MY_LISTS}`, "t.held_deleted_at IS NULL"];
  if (opts.list) {
    await canUse(email, opts.list);
    params.push(opts.list);
    where.push(`t.list_id = $${params.length}::uuid`);
  } else {
    switch (opts.view) {
      case "myday":
        where.push(`EXISTS (SELECT 1 FROM my_day d WHERE d.task_id = t.id AND d.email = $1 AND d.day = $2::date)`);
        break;
      case "important":
        where.push("t.important", "t.completed_at IS NULL");
        break;
      case "planned":
        where.push("t.due IS NOT NULL", "t.completed_at IS NULL");
        break;
      case "assigned":
        where.push("t.assigned_to = $1");
        break;
      case "all":
        break;
      default:
        throw new UserError("Pick a list");
    }
  }
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    where.push(`(t.title ILIKE $${params.length} OR t.notes ILIKE $${params.length} OR EXISTS (SELECT 1 FROM steps s WHERE s.task_id = t.id AND s.held_deleted_at IS NULL AND s.title ILIKE $${params.length}))`);
  }
  const order = opts.view === "planned" && !opts.list ? "t.due, t.created_at DESC" : "t.created_at DESC";
  const rows = await q<Row>(
    `SELECT ${COLS} FROM tasks t JOIN lists l ON l.id = t.list_id WHERE ${where.join(" AND ")}
     ORDER BY (t.completed_at IS NOT NULL), t.completed_at DESC NULLS FIRST, ${order} LIMIT 2000`,
    params,
  );
  return rows.map((r) => toTask(r, email));
}

export async function counts(email: string, day: string): Promise<Counts> {
  const [r] = await q<Counts>(
    `SELECT
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM my_day d WHERE d.task_id = t.id AND d.email = $1 AND d.day = $2::date))::int AS myday,
       count(*) FILTER (WHERE t.important)::int AS important,
       count(*) FILTER (WHERE t.due IS NOT NULL)::int AS planned,
       count(*) FILTER (WHERE t.assigned_to = $1)::int AS assigned,
       count(*)::int AS "all"
     FROM tasks t WHERE t.list_id IN ${MY_LISTS} AND t.completed_at IS NULL AND t.held_deleted_at IS NULL`,
    [email, today(day)],
  );
  return r;
}

export async function getTask(email: string, id: string, day: string): Promise<Task> {
  await taskList(email, id);
  const [r] = await q<Row>(`SELECT ${COLS} FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = $3::uuid`, [email, today(day), id]);
  return toTask(r, email);
}

function title(v: unknown): string {
  const t = text(v, 400);
  if (!t) throw new UserError("Give the task a title");
  return t;
}

async function member(listId: string, who: string, tq: Tq): Promise<void> {
  const [ok] = await tq(`SELECT 1 FROM lists WHERE id = $1::uuid AND owner = $2 UNION SELECT 1 FROM list_members WHERE list_id = $1::uuid AND email = $2`, [listId, who]);
  if (!ok) throw new UserError("Share the list with them before assigning them a task");
}

export type NewTask = { listId?: string; title?: unknown; important?: unknown; due?: unknown; myDay?: unknown; today: string };

export async function createTask(email: string, v: NewTask): Promise<Task> {
  const day = today(v.today);
  const listId = v.listId || (await defaultList(email));
  const id = await tx(async (tq) => {
    await canUse(email, listId, tq);
    const due = v.due ? (isDay(v.due) ? v.due : null) : null;
    const [row] = await tq<{ id: string }>(
      `INSERT INTO tasks (list_id, title, important, due, created_by) VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id`,
      [listId, title(v.title), v.important === true, due, email],
    );
    if (v.myDay === true) await tq(`INSERT INTO my_day (email, task_id, day) VALUES ($1, $2, $3)`, [email, row.id, day]);
    return row.id;
  });
  return getTask(email, id, day);
}

export type TaskPatch = {
  title?: unknown; notes?: unknown; important?: unknown; due?: unknown; reminderAt?: unknown; repeat?: unknown;
  myDay?: unknown; completed?: unknown; listId?: unknown; assignedTo?: unknown; today: string;
};

/** Changes a task. Completing a repeating task also makes the next one, which is returned as `next`. */
export async function updateTask(email: string, id: string, v: TaskPatch): Promise<Task & { next?: Task }> {
  const day = today(v.today);
  const nextId = await tx(async (tq) => {
    const listId = await taskList(email, id, tq);
    const set: string[] = [];
    const params: unknown[] = [id];
    const put = (sql: string, value: unknown) => {
      params.push(value);
      set.push(`${sql} = $${params.length}`);
    };
    if (v.title !== undefined) put("title", title(v.title));
    if (v.notes !== undefined) put("notes", text(v.notes, 20000));
    if (v.important !== undefined) put("important", v.important === true);
    if (v.due !== undefined) {
      if (v.due !== null && v.due !== "" && !isDay(v.due)) throw new UserError("Pick a due date");
      put("due", v.due || null);
    }
    if (v.reminderAt !== undefined) {
      if (v.reminderAt) {
        const at = new Date(String(v.reminderAt));
        if (Number.isNaN(at.getTime())) throw new UserError("Pick a time for the reminder");
        put("reminder_at", at);
        put("reminder_by", email);
      } else {
        put("reminder_at", null);
        put("reminder_by", null);
      }
      set.push("reminded_at = NULL");
    }
    if (v.repeat !== undefined) {
      if (v.repeat && !REPEATS.includes(v.repeat as Repeat)) throw new UserError("Pick how often it repeats");
      put("repeat", v.repeat || null);
      // A repeating task needs a first due date to count from.
      if (v.repeat && v.due === undefined) {
        params.push(day);
        set.push(`due = COALESCE(due, $${params.length}::date)`);
      }
    }
    if (v.listId !== undefined && v.listId !== listId) {
      const to = String(v.listId);
      await canUse(email, to, tq);
      put("list_id", to);
      // Someone not on the new list can't stay assigned.
      const n = params.length;
      if (v.assignedTo === undefined) set.push(`assigned_to = CASE WHEN assigned_to IS NULL OR assigned_to IN (SELECT owner FROM lists WHERE id = $${n}::uuid UNION SELECT email FROM list_members WHERE list_id = $${n}::uuid) THEN assigned_to ELSE NULL END`);
    }
    if (v.assignedTo !== undefined) {
      if (v.assignedTo) {
        const who = cleanEmail(v.assignedTo);
        await member(String(v.listId ?? listId), who, tq);
        put("assigned_to", who);
      } else put("assigned_to", null);
    }
    let completing = false;
    if (v.completed !== undefined) {
      const [cur] = await tq<{ done: boolean }>(`SELECT completed_at IS NOT NULL AS done FROM tasks WHERE id = $1::uuid`, [id]);
      completing = v.completed === true && !cur.done;
      if (v.completed === true && !cur.done) {
        set.push("completed_at = now()");
        put("completed_by", email);
      } else if (v.completed === false) set.push("completed_at = NULL", "completed_by = NULL");
    }
    if (set.length) await tq(`UPDATE tasks SET ${set.join(", ")}, modified_at = now() WHERE id = $1::uuid`, params);

    if (v.myDay === true) await tq(`INSERT INTO my_day (email, task_id, day) VALUES ($1, $2::uuid, $3) ON CONFLICT (email, task_id) DO UPDATE SET day = $3`, [email, id, day]);
    else if (v.myDay === false) await tq(`DELETE FROM my_day WHERE email = $1 AND task_id = $2::uuid`, [email, id]);

    return completing ? repeatTask(tq, id, day) : undefined;
  });
  const task = await getTask(email, id, day);
  return nextId ? { ...task, next: await getTask(email, nextId, day) } : task;
}

/** The next copy of a repeating task: due on the next date, with the same reminder time of day and fresh steps. */
async function repeatTask(tq: Tq, id: string, day: string): Promise<string | undefined> {
  const [t] = await tq<{ list_id: string; title: string; notes: string; important: boolean; due: string | null; repeat: Repeat | null; reminder_at: Date | null; reminder_by: string | null; assigned_to: string | null; created_by: string }>(
    `SELECT list_id, title, notes, important, to_char(due, 'YYYY-MM-DD') AS due, repeat, reminder_at, reminder_by, assigned_to, created_by FROM tasks WHERE id = $1::uuid`,
    [id],
  );
  if (!t.repeat) return undefined;
  // Skip ahead past today, so finishing an old task doesn't make another that is already late.
  let due = nextDue(t.due ?? day, t.repeat);
  for (let i = 0; due <= day && i < 1000; i++) due = nextDue(due, t.repeat);
  const shift = daysBetween(t.due ?? day, due);
  const reminder = t.reminder_at ? new Date(t.reminder_at.getTime() + shift * 86400000) : null;
  const [n] = await tq<{ id: string }>(
    `INSERT INTO tasks (list_id, title, notes, important, due, repeat, reminder_at, reminder_by, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [t.list_id, t.title, t.notes, t.important, due, t.repeat, reminder, reminder ? t.reminder_by : null, t.assigned_to, t.created_by],
  );
  await tq(`INSERT INTO steps (task_id, title, position) SELECT $2::uuid, title, position FROM steps WHERE task_id = $1::uuid AND held_deleted_at IS NULL`, [id, n.id]);
  // The finished one stops repeating, so un-completing and completing it again doesn't make a second copy.
  await tq(`UPDATE tasks SET repeat = NULL WHERE id = $1::uuid`, [id]);
  return n.id;
}

/** Deletes a task for good, or, while its owner or creator is on legal hold, only hides it. */
export async function deleteTask(email: string, id: string): Promise<void> {
  await taskList(email, id);
  if (await taskHeld(id)) {
    await q(`UPDATE tasks SET held_deleted_at = now() WHERE id = $1::uuid`, [id]);
    await q(`DELETE FROM my_day WHERE task_id = $1::uuid`, [id]);
  } else await q(`DELETE FROM tasks WHERE id = $1::uuid`, [id]);
}

/** Tasks left in yesterday's My Day (or older), for the "Suggestions" panel. */
export async function suggestions(email: string, day: string): Promise<Task[]> {
  const d = today(day);
  const rows = await q<Row>(
    `SELECT ${COLS} FROM tasks t JOIN lists l ON l.id = t.list_id
     WHERE t.list_id IN ${MY_LISTS} AND t.completed_at IS NULL AND t.held_deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM my_day d WHERE d.task_id = t.id AND d.email = $1 AND d.day = $2::date)
       AND (EXISTS (SELECT 1 FROM my_day d WHERE d.task_id = t.id AND d.email = $1 AND d.day < $2::date)
            OR t.due <= $3::date)
     ORDER BY t.due NULLS LAST, t.created_at DESC LIMIT 30`,
    [email, d, addDays(d, 1)],
  );
  return rows.map((r) => toTask(r, email));
}

// Steps

export async function addStep(email: string, taskId: string, t: unknown): Promise<void> {
  await taskList(email, taskId);
  const name = text(t, 400);
  if (!name) throw new UserError("Give the step a name");
  await q(`INSERT INTO steps (task_id, title, position) VALUES ($1::uuid, $2, (SELECT COALESCE(max(position), 0) + 1 FROM steps WHERE task_id = $1::uuid))`, [taskId, name]);
  await q(`UPDATE tasks SET modified_at = now() WHERE id = $1::uuid`, [taskId]);
}

export async function updateStep(email: string, taskId: string, stepId: string, v: { title?: unknown; done?: unknown }): Promise<void> {
  await taskList(email, taskId);
  if (v.title !== undefined) {
    const name = text(v.title, 400);
    if (!name) throw new UserError("Give the step a name");
    await q(`UPDATE steps SET title = $3 WHERE id = $2::uuid AND task_id = $1::uuid AND held_deleted_at IS NULL`, [taskId, stepId, name]);
  }
  if (v.done !== undefined) await q(`UPDATE steps SET done = $3 WHERE id = $2::uuid AND task_id = $1::uuid AND held_deleted_at IS NULL`, [taskId, stepId, v.done === true]);
}

export async function deleteStep(email: string, taskId: string, stepId: string): Promise<void> {
  await taskList(email, taskId);
  if (await taskHeld(taskId)) await q(`UPDATE steps SET held_deleted_at = now() WHERE id = $2::uuid AND task_id = $1::uuid`, [taskId, stepId]);
  else await q(`DELETE FROM steps WHERE id = $2::uuid AND task_id = $1::uuid`, [taskId, stepId]);
}

// Reminders

/**
 * Reminders that have come due for this person. Each is handed out once: the first open tab to ask
 * shows it, so two tabs or devices don't both ring.
 */
export async function dueReminders(email: string): Promise<{ id: string; title: string; listName: string; due: string | null }[]> {
  return q(
    `UPDATE tasks t SET reminded_at = now() FROM lists l
     WHERE l.id = t.list_id AND t.reminder_by = $1 AND t.reminder_at <= now() AND t.reminded_at IS NULL AND t.completed_at IS NULL
       AND t.held_deleted_at IS NULL AND t.list_id IN ${MY_LISTS}
     RETURNING t.id, t.title, l.name AS "listName", to_char(t.due, 'YYYY-MM-DD') AS due`,
    [email],
  );
}
