import { holdChecker } from "./compliance";
import { q, tx, type Tq } from "./db";
import { addDays, isDay, weekStart } from "./dates";
import { MY_PROJECTS, ratesFor, requireManager, roleOn } from "./projects";
import type { EntryStatus, Expense, SheetRow, TimeEntry, Timer, Timesheet } from "./types";
import { UserError, cents, minutes, text, uuidish } from "./util";

// Time entries

type EntryRow = {
  id: string; project_id: string; project_name: string; project_code: string; task_id: string | null; task_title: string | null;
  person: string; day: string; minutes: number; notes: string; billable: boolean; status: EntryStatus; invoice_id: string | null;
  reject_reason: string | null;
};

const ENTRY_SELECT = `SELECT e.id, e.project_id, p.name AS project_name, p.code AS project_code, e.task_id, k.title AS task_title,
  e.person, to_char(e.day, 'YYYY-MM-DD') AS day, e.minutes, e.notes, e.billable, e.status, e.invoice_id, e.reject_reason
  FROM time_entries e JOIN projects p ON p.id = e.project_id LEFT JOIN tasks k ON k.id = e.task_id AND k.held_deleted_at IS NULL`;

function toEntry(r: EntryRow): TimeEntry {
  return {
    id: r.id, projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, taskId: r.task_id,
    taskTitle: r.task_title, person: r.person, day: r.day, minutes: r.minutes, notes: r.notes, billable: r.billable,
    status: r.status, invoiced: !!r.invoice_id, rejectReason: r.reject_reason,
  };
}

/** Time can be changed by the person who logged it while it is a draft or was sent back. */
const OPEN: EntryStatus[] = ["draft", "rejected"];

async function checkTask(tq: Tq, projectId: string, taskId: unknown): Promise<{ id: string | null; billable: boolean }> {
  if (taskId === null || taskId === undefined || taskId === "") return { id: null, billable: true };
  if (!uuidish(taskId)) throw new UserError("Task not found", 404);
  const [t] = await tq<{ billable: boolean }>(
    `SELECT billable FROM tasks WHERE id = $1::uuid AND project_id = $2::uuid AND held_deleted_at IS NULL`,
    [taskId, projectId],
  );
  if (!t) throw new UserError("Task not found", 404);
  return { id: taskId, billable: t.billable };
}

async function billableByDefault(tq: Tq, projectId: string, taskBillable: boolean): Promise<boolean> {
  const [p] = await tq<{ billing: string }>(`SELECT billing FROM projects WHERE id = $1::uuid`, [projectId]);
  return p.billing === "time" && taskBillable;
}

export type CellInput = { projectId?: unknown; taskId?: unknown; day?: unknown; hours?: unknown; notes?: unknown; billable?: unknown };

/**
 * Sets one timesheet cell: the time a person spent on a project (and task) on a day. Zero clears
 * it. A cell that has been submitted or approved can't be changed; one that was sent back
 * becomes a draft again.
 */
export async function setCell(email: string, v: CellInput): Promise<TimeEntry | null> {
  const projectId = String(v.projectId ?? "");
  await roleOn(email, projectId);
  if (!isDay(v.day)) throw new UserError("Bad date");
  const day = v.day;
  const mins = v.hours === undefined ? undefined : minutes(v.hours);
  if (mins !== undefined && mins > 24 * 60) throw new UserError("A day has 24 hours");
  const id = await tx(async (tq) => {
    const task = await checkTask(tq, projectId, v.taskId);
    const [cell] = await tq<{ id: string; status: EntryStatus }>(
      `SELECT id, status FROM time_entries WHERE person = $1 AND project_id = $2::uuid AND task_id IS NOT DISTINCT FROM $3::uuid
         AND day = $4 AND held_deleted_at IS NULL FOR UPDATE`,
      [email, projectId, task.id, day],
    );
    if (cell && !OPEN.includes(cell.status)) throw new UserError(`That time is ${cell.status} and can't be changed`, 409);
    if (mins === 0) {
      if (cell) await removeEntry(tq, cell.id, email);
      return null;
    }
    if (!cell) {
      if (mins === undefined) throw new UserError("Enter the hours");
      const billable = v.billable === undefined ? await billableByDefault(tq, projectId, task.billable) : v.billable === true;
      const [row] = await tq<{ id: string }>(
        `INSERT INTO time_entries (project_id, task_id, person, day, minutes, notes, billable) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7) RETURNING id`,
        [projectId, task.id, email, day, mins, text(v.notes, 2000), billable],
      );
      return row.id;
    }
    await tq(
      `UPDATE time_entries SET minutes = COALESCE($2, minutes), notes = COALESCE($3, notes), billable = COALESCE($4, billable),
         status = 'draft', reject_reason = NULL, modified_at = now() WHERE id = $1::uuid`,
      [cell.id, mins ?? null, v.notes === undefined ? null : text(v.notes, 2000), v.billable === undefined ? null : v.billable === true],
    );
    return cell.id;
  });
  if (!id) return null;
  const [row] = await q<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $1::uuid`, [id]);
  return toEntry(row);
}

/** Deletes an entry, or hides it while the person who logged it is on legal hold. */
async function removeEntry(tq: Tq, id: string, person: string): Promise<void> {
  if (await holdChecker()(person)) await tq(`UPDATE time_entries SET held_deleted_at = now() WHERE id = $1::uuid`, [id]);
  else await tq(`DELETE FROM time_entries WHERE id = $1::uuid`, [id]);
}

/** Takes a project and task off a week's timesheet: its open cells are cleared. */
export async function clearRow(email: string, week: string, projectId: string, taskId: string | null): Promise<void> {
  if (!isDay(week)) throw new UserError("Bad week");
  const start = weekStart(week);
  await tx(async (tq) => {
    const rows = await tq<{ id: string; status: EntryStatus }>(
      `SELECT id, status FROM time_entries WHERE person = $1 AND project_id = $2::uuid AND task_id IS NOT DISTINCT FROM $3::uuid
         AND day >= $4 AND day < $5 AND held_deleted_at IS NULL FOR UPDATE`,
      [email, projectId, taskId, start, addDays(start, 7)],
    );
    if (rows.some((r) => !OPEN.includes(r.status))) throw new UserError("Some of that time is already submitted", 409);
    for (const r of rows) await removeEntry(tq, r.id, email);
  });
}

/** A person's week, Monday to Sunday, as a grid of projects and tasks by day. */
export async function timesheet(email: string, anyDay: string): Promise<Timesheet> {
  if (!isDay(anyDay)) throw new UserError("Bad date");
  const week = weekStart(anyDay);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const rows = await q<EntryRow>(
    `${ENTRY_SELECT} WHERE e.person = $1 AND e.day >= $2 AND e.day < $3 AND e.held_deleted_at IS NULL AND p.held_deleted_at IS NULL
     ORDER BY p.name, k.position NULLS FIRST, e.day`,
    [email, week, addDays(week, 7)],
  );
  const grid = new Map<string, SheetRow>();
  for (const r of rows) {
    const key = `${r.project_id}/${r.task_id ?? ""}`;
    if (!grid.has(key)) {
      grid.set(key, {
        projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, taskId: r.task_id,
        taskTitle: r.task_title, cells: days.map(() => null),
      });
    }
    grid.get(key)!.cells[days.indexOf(r.day)] = toEntry(r);
  }
  const projects = await q<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM projects WHERE id IN ${MY_PROJECTS} AND status IN ('planning', 'active', 'on_hold') ORDER BY name`,
    [email],
  );
  const tasks = projects.length
    ? await q<{ id: string; project_id: string; title: string }>(
        `SELECT id, project_id, title FROM tasks k WHERE project_id = ANY($1::uuid[]) AND held_deleted_at IS NULL AND percent_done < 100
           AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = k.id AND c.held_deleted_at IS NULL)
         ORDER BY position`,
        [projects.map((p) => p.id)],
      )
    : [];
  return {
    week,
    days,
    rows: [...grid.values()],
    totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    choices: projects.map((p) => ({
      ...p,
      tasks: tasks.filter((t) => t.project_id === p.id).map((t) => ({ id: t.id, title: t.title })),
    })),
  };
}

/** Sends a week's drafts (and anything sent back) to the project managers. */
export async function submitWeek(email: string, anyDay: string): Promise<number> {
  if (!isDay(anyDay)) throw new UserError("Bad date");
  const week = weekStart(anyDay);
  const rows = await q<{ id: string }>(
    `UPDATE time_entries SET status = 'submitted', submitted_at = now(), reject_reason = NULL, modified_at = now()
     WHERE person = $1 AND day >= $2 AND day < $3 AND status IN ('draft', 'rejected') AND held_deleted_at IS NULL RETURNING id`,
    [email, week, addDays(week, 7)],
  );
  return rows.length;
}

/** Takes a submitted week back before anyone has approved it. */
export async function recallWeek(email: string, anyDay: string): Promise<number> {
  if (!isDay(anyDay)) throw new UserError("Bad date");
  const week = weekStart(anyDay);
  const rows = await q<{ id: string }>(
    `UPDATE time_entries SET status = 'draft', submitted_at = NULL, modified_at = now()
     WHERE person = $1 AND day >= $2 AND day < $3 AND status = 'submitted' AND held_deleted_at IS NULL RETURNING id`,
    [email, week, addDays(week, 7)],
  );
  return rows.length;
}

/** Time logged on a project, newest first; members see their own, managers everyone's. */
export async function projectTime(email: string, projectId: string): Promise<TimeEntry[]> {
  const role = await roleOn(email, projectId);
  const rows = await q<EntryRow>(
    `${ENTRY_SELECT} WHERE e.project_id = $1::uuid AND e.held_deleted_at IS NULL AND ($2 OR e.person = $3)
     ORDER BY e.day DESC, e.person LIMIT 1000`,
    [projectId, role === "manager", email],
  );
  return rows.map(toEntry);
}

// Timer

export async function getTimer(email: string): Promise<Timer | null> {
  const [r] = await q<{ project_id: string; project_name: string; task_id: string | null; task_title: string | null; notes: string; started_at: Date }>(
    `SELECT t.project_id, p.name AS project_name, t.task_id, k.title AS task_title, t.notes, t.started_at
     FROM timers t JOIN projects p ON p.id = t.project_id LEFT JOIN tasks k ON k.id = t.task_id WHERE t.person = $1`,
    [email],
  );
  return r
    ? { projectId: r.project_id, projectName: r.project_name, taskId: r.task_id, taskTitle: r.task_title, notes: r.notes, startedAt: r.started_at.toISOString() }
    : null;
}

export async function startTimer(email: string, v: { projectId?: unknown; taskId?: unknown; notes?: unknown }): Promise<Timer> {
  const projectId = String(v.projectId ?? "");
  await roleOn(email, projectId);
  const task = await checkTask(q, projectId, v.taskId);
  const [running] = await q(`SELECT 1 FROM timers WHERE person = $1`, [email]);
  if (running) throw new UserError("A timer is already running; stop it first", 409);
  await q(`INSERT INTO timers (person, project_id, task_id, notes) VALUES ($1, $2::uuid, $3::uuid, $4)`, [email, projectId, task.id, text(v.notes, 2000)]);
  return (await getTimer(email))!;
}

/**
 * Stops the timer and adds the time to the day it is stopped on (the browser's `today`), in whole
 * minutes, at least one. When that day's cell is already submitted the time is kept on the timer.
 */
export async function stopTimer(email: string, today: unknown, now = new Date()): Promise<TimeEntry | null> {
  if (!isDay(today)) throw new UserError("Bad date");
  const timer = await getTimer(email);
  if (!timer) throw new UserError("No timer is running", 404);
  const mins = Math.min(24 * 60, Math.max(1, Math.round((now.getTime() - new Date(timer.startedAt).getTime()) / 60000)));
  const [existing] = await q<{ minutes: number; notes: string }>(
    `SELECT minutes, notes FROM time_entries WHERE person = $1 AND project_id = $2::uuid AND task_id IS NOT DISTINCT FROM $3::uuid
       AND day = $4 AND held_deleted_at IS NULL`,
    [email, timer.projectId, timer.taskId, today],
  );
  const total = Math.min(24 * 60, (existing?.minutes ?? 0) + mins);
  const notes = [existing?.notes, timer.notes].filter(Boolean).join("; ").slice(0, 2000);
  const entry = await setCell(email, { projectId: timer.projectId, taskId: timer.taskId, day: today, hours: total / 60, notes });
  await q(`DELETE FROM timers WHERE person = $1`, [email]);
  return entry;
}

export async function discardTimer(email: string): Promise<void> {
  await q(`DELETE FROM timers WHERE person = $1`, [email]);
}

// Expenses

type ExpenseRow = {
  id: string; project_id: string; project_name: string; project_code: string; person: string; day: string; category: string;
  description: string; amount_cents: string; currency: string; billable: boolean; status: EntryStatus; invoice_id: string | null;
  reject_reason: string | null; receipt_name: string | null;
};

const EXPENSE_SELECT = `SELECT x.id, x.project_id, p.name AS project_name, p.code AS project_code, x.person, to_char(x.day, 'YYYY-MM-DD') AS day,
  x.category, x.description, x.amount_cents, p.currency, x.billable, x.status, x.invoice_id, x.reject_reason, x.receipt_name
  FROM expenses x JOIN projects p ON p.id = x.project_id`;

function toExpense(r: ExpenseRow): Expense {
  return {
    id: r.id, projectId: r.project_id, projectName: r.project_name, projectCode: r.project_code, person: r.person, day: r.day,
    category: r.category, description: r.description, amountCents: Number(r.amount_cents), currency: r.currency, billable: r.billable, status: r.status,
    invoiced: !!r.invoice_id, rejectReason: r.reject_reason, receiptName: r.receipt_name,
  };
}

export type ExpenseInput = {
  projectId?: unknown; day?: unknown; category?: unknown; description?: unknown; amount?: unknown; billable?: unknown;
};

export const MAX_RECEIPT = 10 * 1024 * 1024;
const RECEIPT_TYPES = /^(image\/(png|jpeg|gif|webp|heic)|application\/pdf)$/;

export async function myExpenses(email: string): Promise<Expense[]> {
  const rows = await q<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE x.person = $1 AND x.held_deleted_at IS NULL AND p.held_deleted_at IS NULL ORDER BY x.day DESC, x.created_at DESC LIMIT 500`,
    [email],
  );
  return rows.map(toExpense);
}

export async function projectExpenses(email: string, projectId: string): Promise<Expense[]> {
  const role = await roleOn(email, projectId);
  const rows = await q<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE x.project_id = $1::uuid AND x.held_deleted_at IS NULL AND ($2 OR x.person = $3) ORDER BY x.day DESC LIMIT 1000`,
    [projectId, role === "manager", email],
  );
  return rows.map(toExpense);
}

async function expenseOf(email: string, id: string): Promise<ExpenseRow> {
  if (!uuidish(id)) throw new UserError("Expense not found", 404);
  const [row] = await q<ExpenseRow>(`${EXPENSE_SELECT} WHERE x.id = $1::uuid AND x.person = $2 AND x.held_deleted_at IS NULL`, [id, email]);
  if (!row) throw new UserError("Expense not found", 404);
  return row;
}

function expenseFields(v: ExpenseInput, creating: boolean): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (v.day !== undefined || creating) {
    if (!isDay(v.day)) throw new UserError("Bad date");
    f.day = v.day;
  }
  if (v.category !== undefined || creating) {
    const c = text(v.category, 60);
    if (!c) throw new UserError("Pick a category");
    f.category = c;
  }
  if (v.description !== undefined) f.description = text(v.description, 1000);
  if (v.amount !== undefined || creating) {
    const a = cents(v.amount);
    if (!a) throw new UserError("Enter the amount");
    f.amount_cents = a;
  }
  if (v.billable !== undefined) f.billable = v.billable !== false;
  return f;
}

export async function createExpense(email: string, v: ExpenseInput): Promise<Expense> {
  const projectId = String(v.projectId ?? "");
  await roleOn(email, projectId);
  const f = expenseFields(v, true);
  if (f.billable === undefined) {
    const [p] = await q<{ billing: string }>(`SELECT billing FROM projects WHERE id = $1::uuid`, [projectId]);
    f.billable = p.billing !== "none";
  }
  const cols = Object.keys(f);
  const [row] = await q<{ id: string }>(
    `INSERT INTO expenses (project_id, person, ${cols.join(", ")}) VALUES ($1::uuid, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")}) RETURNING id`,
    [projectId, email, ...cols.map((c) => f[c])],
  );
  return toExpense((await q<ExpenseRow>(`${EXPENSE_SELECT} WHERE x.id = $1::uuid`, [row.id]))[0]);
}

export async function updateExpense(email: string, id: string, v: ExpenseInput & { status?: unknown }): Promise<Expense> {
  const current = await expenseOf(email, id);
  if (v.status === "submitted" || v.status === "draft") {
    // Submit a draft, or take back a submitted one before it is decided.
    const from = v.status === "submitted" ? ["draft", "rejected"] : ["submitted"];
    if (!from.includes(current.status)) throw new UserError(`That expense is ${current.status}`, 409);
    await q(
      `UPDATE expenses SET status = $2, submitted_at = CASE WHEN $2 = 'submitted' THEN now() END, reject_reason = NULL, modified_at = now() WHERE id = $1::uuid`,
      [id, v.status],
    );
  }
  const f = expenseFields(v, false);
  const cols = Object.keys(f);
  if (cols.length) {
    if (!OPEN.includes(current.status)) throw new UserError(`That expense is ${current.status} and can't be changed`, 409);
    await q(
      `UPDATE expenses SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, status = 'draft', reject_reason = NULL, modified_at = now() WHERE id = $1::uuid`,
      [id, ...cols.map((c) => f[c])],
    );
  }
  return toExpense((await q<ExpenseRow>(`${EXPENSE_SELECT} WHERE x.id = $1::uuid`, [id]))[0]);
}

export async function setReceipt(email: string, id: string, file: { name: string; type: string; bytes: Buffer } | null): Promise<void> {
  const current = await expenseOf(email, id);
  if (!OPEN.includes(current.status)) throw new UserError(`That expense is ${current.status} and can't be changed`, 409);
  if (file) {
    if (!RECEIPT_TYPES.test(file.type)) throw new UserError("A receipt must be a picture or a PDF");
    if (file.bytes.length > MAX_RECEIPT) throw new UserError("A receipt can be up to 10 MB");
  }
  await q(`UPDATE expenses SET receipt_name = $2, receipt_type = $3, receipt = $4, modified_at = now() WHERE id = $1::uuid`, [
    id, file ? text(file.name, 200) || "receipt" : null, file?.type ?? null, file?.bytes ?? null,
  ]);
}

/** The receipt, for the person who filed it and the project's managers. */
export async function getReceipt(email: string, id: string): Promise<{ name: string; type: string; bytes: Buffer } | null> {
  if (!uuidish(id)) throw new UserError("Expense not found", 404);
  const [row] = await q<{ project_id: string; person: string; receipt_name: string | null; receipt_type: string | null; receipt: Buffer | null }>(
    `SELECT project_id, person, receipt_name, receipt_type, receipt FROM expenses WHERE id = $1::uuid AND held_deleted_at IS NULL`,
    [id],
  );
  if (!row) throw new UserError("Expense not found", 404);
  if (row.person !== email) await requireManager(email, row.project_id).catch(() => { throw new UserError("Expense not found", 404); });
  if (!row.receipt) return null;
  return { name: row.receipt_name ?? "receipt", type: row.receipt_type ?? "application/octet-stream", bytes: row.receipt };
}

export async function deleteExpense(email: string, id: string): Promise<void> {
  const current = await expenseOf(email, id);
  if (!OPEN.includes(current.status)) throw new UserError(`That expense is ${current.status} and can't be deleted`, 409);
  if (await holdChecker()(email)) await q(`UPDATE expenses SET held_deleted_at = now() WHERE id = $1::uuid`, [id]);
  else await q(`DELETE FROM expenses WHERE id = $1::uuid`, [id]);
}

// Approvals

export type Approvals = { time: TimeEntry[]; expenses: Expense[] };

/** Everything waiting on this person as a manager, oldest first. */
export async function pendingApprovals(email: string): Promise<Approvals> {
  const managed = `(SELECT project_id FROM members WHERE email = $1 AND role = 'manager')`;
  const time = await q<EntryRow>(
    `${ENTRY_SELECT} WHERE e.project_id IN ${managed} AND e.status = 'submitted' AND e.held_deleted_at IS NULL AND p.held_deleted_at IS NULL
     ORDER BY e.person, e.day LIMIT 2000`,
    [email],
  );
  const expenses = await q<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE x.project_id IN ${managed} AND x.status = 'submitted' AND x.held_deleted_at IS NULL AND p.held_deleted_at IS NULL
     ORDER BY x.person, x.day LIMIT 1000`,
    [email],
  );
  return { time: time.map(toEntry), expenses: expenses.map(toExpense) };
}

export type Decision = { time?: unknown; expenses?: unknown; approve?: unknown; reason?: unknown };

/**
 * Approves or sends back submitted time and expenses on projects this person manages. Approving
 * time fixes its bill and cost rates from the team list as they are now.
 */
export async function decide(email: string, v: Decision): Promise<{ time: number; expenses: number }> {
  const timeIds = Array.isArray(v.time) ? v.time.filter(uuidish) : [];
  const expenseIds = Array.isArray(v.expenses) ? v.expenses.filter(uuidish) : [];
  if (!timeIds.length && !expenseIds.length) throw new UserError("Pick what to approve");
  const approve = v.approve === true;
  const reason = approve ? null : text(v.reason, 500);
  if (!approve && !reason) throw new UserError("Say why it's being sent back");
  return tx(async (tq) => {
    const managed = `(SELECT project_id FROM members WHERE email = $1 AND role = 'manager')`;
    const times = await tq<{ id: string; project_id: string; person: string }>(
      `SELECT id, project_id, person FROM time_entries WHERE id = ANY($2::uuid[]) AND status = 'submitted' AND project_id IN ${managed} FOR UPDATE`,
      [email, timeIds],
    );
    for (const t of times) {
      const rates = approve ? await ratesFor(tq, t.project_id, t.person) : { bill: null, cost: null };
      await tq(
        `UPDATE time_entries SET status = $2, decided_by = $3, decided_at = now(), reject_reason = $4, rate_cents = $5, cost_cents = $6, modified_at = now()
         WHERE id = $1::uuid`,
        [t.id, approve ? "approved" : "rejected", email, reason, rates.bill, rates.cost],
      );
    }
    const exp = await tq<{ id: string }>(
      `UPDATE expenses SET status = $3, decided_by = $1, decided_at = now(), reject_reason = $4, modified_at = now()
       WHERE id = ANY($2::uuid[]) AND status = 'submitted' AND project_id IN ${managed} RETURNING id`,
      [email, expenseIds, approve ? "approved" : "rejected", reason],
    );
    if (times.length + exp.length < timeIds.length + expenseIds.length) {
      throw new UserError("Some of those are no longer waiting for you; refresh and try again", 409);
    }
    return { time: times.length, expenses: exp.length };
  });
}

/** A manager reopens approved time or expenses that haven't been billed, back to the person as drafts. */
export async function reopen(email: string, v: { time?: unknown; expenses?: unknown }): Promise<number> {
  const timeIds = Array.isArray(v.time) ? v.time.filter(uuidish) : [];
  const expenseIds = Array.isArray(v.expenses) ? v.expenses.filter(uuidish) : [];
  const managed = `(SELECT project_id FROM members WHERE email = $1 AND role = 'manager')`;
  const a = await q(
    `UPDATE time_entries SET status = 'draft', decided_by = NULL, decided_at = NULL, rate_cents = NULL, cost_cents = NULL, modified_at = now()
     WHERE id = ANY($2::uuid[]) AND status = 'approved' AND invoice_id IS NULL AND project_id IN ${managed} RETURNING id`,
    [email, timeIds],
  );
  const b = await q(
    `UPDATE expenses SET status = 'draft', decided_by = NULL, decided_at = NULL, modified_at = now()
     WHERE id = ANY($2::uuid[]) AND status = 'approved' AND invoice_id IS NULL AND project_id IN ${managed} RETURNING id`,
    [email, expenseIds],
  );
  return a.length + b.length;
}
