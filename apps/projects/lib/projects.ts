import { holdChecker } from "./compliance";
import { q, tx, type Tq } from "./db";
import { dayOf, finishAfter, isDay, nextWorkday, onWorkday, workdays } from "./dates";
import {
  BILLINGS, STATUSES, type Billing, type Member, type Project, type ProjectSummary, type Role, type Status, type Task,
} from "./types";
import { UserError, cents, cleanEmail, minutes, text, uuidish } from "./util";

// Access

/** Projects someone is on (not ones kept by a legal hold). */
export const MY_PROJECTS = `(SELECT m.project_id FROM members m JOIN projects mp ON mp.id = m.project_id AND mp.held_deleted_at IS NULL WHERE m.email = $1)`;

/** The person's role on a project; 404 when they aren't on it. */
export async function roleOn(email: string, projectId: string, tq: Tq = q): Promise<Role> {
  if (!uuidish(projectId)) throw new UserError("Project not found", 404);
  const [row] = await tq<{ role: Role }>(
    `SELECT m.role FROM members m JOIN projects p ON p.id = m.project_id
     WHERE m.project_id = $2::uuid AND m.email = $1 AND p.held_deleted_at IS NULL`,
    [email, projectId],
  );
  if (!row) throw new UserError("Project not found", 404);
  return row.role;
}

export async function requireManager(email: string, projectId: string, tq: Tq = q): Promise<void> {
  if ((await roleOn(email, projectId, tq)) !== "manager") throw new UserError("Only the project's managers can do that", 403);
}

// Projects

type ProjectRow = {
  id: string; code: string; name: string; description: string; client_name: string; client_email: string; status: Status;
  billing: Billing; currency: string; start_day: string | null; finish_day: string | null; budget_minutes: number | null;
  budget_cents: string | null; fixed_fee_cents: string | null; default_rate_cents: string | null; planner_board_id: string | null;
  created_by: string; created_at: Date;
};

type MemberRow = { email: string; role: Role; bill_rate_cents: string | null; cost_rate_cents: string | null; weekly_minutes: number };

const num = (v: string | number | null): number | null => (v === null || v === undefined ? null : Number(v));

const PROJECT_COLS = `p.id, p.code, p.name, p.description, p.client_name, p.client_email, p.status, p.billing, p.currency,
  to_char(p.start_day, 'YYYY-MM-DD') AS start_day, to_char(p.finish_day, 'YYYY-MM-DD') AS finish_day, p.budget_minutes,
  p.budget_cents, p.fixed_fee_cents, p.default_rate_cents, p.planner_board_id, p.created_by, p.created_at`;

function toProject(r: ProjectRow, role: Role, members: MemberRow[]): Project {
  const manager = role === "manager";
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    clientName: r.client_name,
    clientEmail: r.client_email,
    status: r.status,
    billing: r.billing,
    currency: r.currency,
    start: r.start_day,
    finish: r.finish_day,
    budgetMinutes: r.budget_minutes,
    budgetCents: manager ? num(r.budget_cents) : null,
    fixedFeeCents: manager ? num(r.fixed_fee_cents) : null,
    defaultRateCents: manager ? num(r.default_rate_cents) : null,
    plannerBoardId: r.planner_board_id,
    myRole: role,
    members: members.map((m): Member => ({
      email: m.email,
      role: m.role,
      weeklyMinutes: m.weekly_minutes,
      ...(manager ? { billRateCents: num(m.bill_rate_cents), costRateCents: num(m.cost_rate_cents) } : {}),
    })),
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

export async function getProject(email: string, id: string): Promise<Project> {
  const role = await roleOn(email, id);
  const [row] = await q<ProjectRow>(`SELECT ${PROJECT_COLS} FROM projects p WHERE p.id = $1::uuid`, [id]);
  const members = await q<MemberRow>(
    `SELECT email, role, bill_rate_cents, cost_rate_cents, weekly_minutes FROM members WHERE project_id = $1::uuid
     ORDER BY role = 'manager' DESC, email`,
    [id],
  );
  return toProject(row, role, members);
}

/** The person's projects, with progress and hours, active ones first. */
export async function listProjects(email: string, today: string): Promise<ProjectSummary[]> {
  const rows = await q<ProjectRow & { role: Role; logged: string; open_tasks: string; late_tasks: string }>(
    `SELECT ${PROJECT_COLS}, m.role,
       COALESCE((SELECT sum(minutes) FROM time_entries t WHERE t.project_id = p.id AND t.held_deleted_at IS NULL), 0) AS logged,
       (SELECT count(*) FROM tasks k WHERE k.project_id = p.id AND k.held_deleted_at IS NULL AND k.percent_done < 100
          AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = k.id AND c.held_deleted_at IS NULL)) AS open_tasks,
       (SELECT count(*) FROM tasks k WHERE k.project_id = p.id AND k.held_deleted_at IS NULL AND k.percent_done < 100 AND k.finish_day < $2::date
          AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = k.id AND c.held_deleted_at IS NULL)) AS late_tasks
     FROM projects p JOIN members m ON m.project_id = p.id AND m.email = $1
     WHERE p.held_deleted_at IS NULL
     ORDER BY array_position(ARRAY['active','planning','on_hold','done','cancelled'], p.status), p.name`,
    [email, today],
  );
  const out: ProjectSummary[] = [];
  for (const r of rows) {
    const tasks = await taskRows(r.id);
    out.push({
      id: r.id,
      code: r.code,
      name: r.name,
      clientName: r.client_name,
      status: r.status,
      myRole: r.role,
      start: r.start_day,
      finish: r.finish_day,
      percentDone: overallPercent(buildTasks(tasks, new Map())),
      loggedMinutes: Number(r.logged),
      budgetMinutes: r.budget_minutes,
      openTasks: Number(r.open_tasks),
      lateTasks: Number(r.late_tasks),
    });
  }
  return out;
}

export type ProjectInput = {
  name?: unknown; description?: unknown; clientName?: unknown; clientEmail?: unknown; status?: unknown; billing?: unknown;
  currency?: unknown; start?: unknown; finish?: unknown; budgetHours?: unknown; budget?: unknown; fixedFee?: unknown;
  defaultRate?: unknown; plannerBoardId?: unknown;
};

/** Checks a create or edit; only the fields given are returned, as column → value. */
function projectFields(v: ProjectInput, creating: boolean): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (v.name !== undefined || creating) {
    const name = text(v.name, 200);
    if (!name) throw new UserError("Give the project a name");
    f.name = name;
  }
  if (v.description !== undefined) f.description = text(v.description, 5000);
  if (v.clientName !== undefined) f.client_name = text(v.clientName, 200);
  if (v.clientEmail !== undefined) f.client_email = v.clientEmail === "" || v.clientEmail === null ? "" : cleanEmail(v.clientEmail);
  if (v.status !== undefined) {
    if (!STATUSES.includes(v.status as Status)) throw new UserError("Unknown status");
    f.status = v.status;
  }
  if (v.billing !== undefined) {
    if (!BILLINGS.includes(v.billing as Billing)) throw new UserError("Billing must be time, fixed or none");
    f.billing = v.billing;
  }
  if (v.currency !== undefined) {
    const c = text(v.currency, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new UserError("Currency must be a three-letter code like USD");
    f.currency = c;
  }
  for (const [key, col] of [["start", "start_day"], ["finish", "finish_day"]] as const) {
    if (v[key] === undefined) continue;
    if (v[key] === null || v[key] === "") f[col] = null;
    else if (!isDay(v[key])) throw new UserError(`Bad ${key} date`);
    else f[col] = v[key];
  }
  if (f.start_day && f.finish_day && (f.finish_day as string) < (f.start_day as string)) throw new UserError("The project finishes before it starts");
  if (v.budgetHours !== undefined) f.budget_minutes = minutes(v.budgetHours, "Budget hours") || null;
  if (v.budget !== undefined) f.budget_cents = cents(v.budget, "Budget");
  if (v.fixedFee !== undefined) f.fixed_fee_cents = cents(v.fixedFee, "Fixed fee");
  if (v.defaultRate !== undefined) f.default_rate_cents = cents(v.defaultRate, "Rate");
  if (v.plannerBoardId !== undefined) {
    const b = v.plannerBoardId === null || v.plannerBoardId === "" ? null : text(v.plannerBoardId, 100);
    if (b !== null && !uuidish(b)) throw new UserError("Pick a Planner board");
    f.planner_board_id = b;
  }
  return f;
}

export async function createProject(email: string, v: ProjectInput): Promise<Project> {
  const f = projectFields(v, true);
  const id = await tx(async (tq) => {
    const cols = Object.keys(f);
    const [row] = await tq<{ id: string }>(
      `INSERT INTO projects (code, created_by, ${cols.join(", ")})
       VALUES ('PRJ-' || lpad(nextval('project_code_seq')::text, 4, '0'), $1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
       RETURNING id`,
      [email, ...cols.map((c) => f[c])],
    );
    await tq(`INSERT INTO members (project_id, email, role, added_by) VALUES ($1, $2, 'manager', $2)`, [row.id, email]);
    return row.id;
  });
  return getProject(email, id);
}

export async function updateProject(email: string, id: string, v: ProjectInput): Promise<Project> {
  await requireManager(email, id);
  const f = projectFields(v, false);
  const cols = Object.keys(f);
  if (cols.length) {
    await q(
      `UPDATE projects SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, modified_at = now() WHERE id = $1::uuid`,
      [id, ...cols.map((c) => f[c])],
    );
    const [p] = await q<{ s: string | null; f: string | null }>(`SELECT start_day::text AS s, finish_day::text AS f FROM projects WHERE id = $1::uuid`, [id]);
    if (p.s && p.f && p.f < p.s) {
      await q(`UPDATE projects SET finish_day = start_day WHERE id = $1::uuid`, [id]);
    }
  }
  return getProject(email, id);
}

/**
 * Deletes a project with its plan, time and expenses. While anyone on it is on legal hold it is
 * only hidden, so eDiscovery still finds everything in it.
 */
export async function deleteProject(email: string, id: string): Promise<void> {
  await requireManager(email, id);
  const people = await q<{ email: string }>(
    `SELECT email FROM members WHERE project_id = $1::uuid
     UNION SELECT person FROM time_entries WHERE project_id = $1::uuid
     UNION SELECT person FROM expenses WHERE project_id = $1::uuid`,
    [id],
  );
  const held = holdChecker();
  for (const p of people) {
    if (await held(p.email)) {
      await q(`UPDATE projects SET held_deleted_at = now() WHERE id = $1::uuid`, [id]);
      await q(`DELETE FROM timers WHERE project_id = $1::uuid`, [id]);
      return;
    }
  }
  await q(`DELETE FROM projects WHERE id = $1::uuid`, [id]);
}

// Team

export type MemberInput = { email?: unknown; role?: unknown; billRate?: unknown; costRate?: unknown; weeklyHours?: unknown };

export async function setMember(email: string, projectId: string, v: MemberInput): Promise<Project> {
  await requireManager(email, projectId);
  const who = cleanEmail(v.email);
  const role = v.role === undefined ? undefined : v.role === "manager" ? "manager" : v.role === "member" ? "member" : null;
  if (role === null) throw new UserError("Role must be manager or member");
  const bill = v.billRate === undefined ? undefined : cents(v.billRate, "Bill rate");
  const cost = v.costRate === undefined ? undefined : cents(v.costRate, "Cost rate");
  const weekly = v.weeklyHours === undefined ? undefined : minutes(v.weeklyHours, "Weekly hours");
  if (weekly !== undefined && weekly > 168 * 60) throw new UserError("A week has 168 hours");
  await tx(async (tq) => {
    await tq(
      `INSERT INTO members (project_id, email, role, bill_rate_cents, cost_rate_cents, weekly_minutes, added_by)
       VALUES ($1::uuid, $2, COALESCE($3, 'member'), $4, $5, COALESCE($6, 2400), $7)
       ON CONFLICT (project_id, email) DO UPDATE SET
         role = COALESCE($3, members.role),
         bill_rate_cents = CASE WHEN $8 THEN $4 ELSE members.bill_rate_cents END,
         cost_rate_cents = CASE WHEN $9 THEN $5 ELSE members.cost_rate_cents END,
         weekly_minutes = COALESCE($6, members.weekly_minutes)`,
      [projectId, who, role ?? null, bill ?? null, cost ?? null, weekly ?? null, email, bill !== undefined, cost !== undefined],
    );
    await keepAManager(tq, projectId);
  });
  return getProject(email, projectId);
}

/** People can leave a project themselves; managers can take anyone off. The last manager stays. */
export async function removeMember(email: string, projectId: string, who: string): Promise<void> {
  const role = await roleOn(email, projectId);
  const target = cleanEmail(who);
  if (target !== email && role !== "manager") throw new UserError("Only the project's managers can do that", 403);
  await tx(async (tq) => {
    await tq(`DELETE FROM members WHERE project_id = $1::uuid AND email = $2`, [projectId, target]);
    await keepAManager(tq, projectId);
    await tq(`DELETE FROM timers WHERE project_id = $1::uuid AND person = $2`, [projectId, target]);
  });
}

async function keepAManager(tq: Tq, projectId: string): Promise<void> {
  const [row] = await tq<{ n: string }>(`SELECT count(*) AS n FROM members WHERE project_id = $1::uuid AND role = 'manager'`, [projectId]);
  if (Number(row.n) === 0) throw new UserError("A project needs at least one manager");
}

/** What an hour of someone's time bills at and costs on a project. */
export async function ratesFor(tq: Tq, projectId: string, person: string): Promise<{ bill: number; cost: number }> {
  const [r] = await tq<{ bill: string | null; cost: string | null }>(
    `SELECT COALESCE(m.bill_rate_cents, p.default_rate_cents) AS bill, m.cost_rate_cents AS cost
     FROM projects p LEFT JOIN members m ON m.project_id = p.id AND m.email = $2 WHERE p.id = $1::uuid`,
    [projectId, person],
  );
  return { bill: Number(r?.bill ?? 0), cost: Number(r?.cost ?? 0) };
}

// Tasks

export type TaskRow = {
  id: string; parent_id: string | null; title: string; notes: string; start_day: string | null; finish_day: string | null;
  estimate_minutes: number | null; percent_done: number; assigned_to: string | null; milestone: boolean; billable: boolean;
  depends_on: string[]; position: number; planner_card_id: string | null; created_by: string;
};

const TASK_COLS = `id, parent_id, title, notes, to_char(start_day, 'YYYY-MM-DD') AS start_day, to_char(finish_day, 'YYYY-MM-DD') AS finish_day,
  estimate_minutes, percent_done, assigned_to, milestone, billable, depends_on::text[] AS depends_on, position, planner_card_id, created_by`;

export async function taskRows(projectId: string, tq: Tq = q): Promise<TaskRow[]> {
  return tq<TaskRow>(
    `SELECT ${TASK_COLS} FROM tasks WHERE project_id = $1::uuid AND held_deleted_at IS NULL ORDER BY position, created_at`,
    [projectId],
  );
}

/**
 * The plan as an outline: each task after its parent, numbered 1, 1.1, 1.2 … Summary tasks take
 * their dates, estimate and progress from their subtasks.
 */
export function buildTasks(rows: TaskRow[], logged: Map<string, number>): Task[] {
  const kids = new Map<string | null, TaskRow[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const parent = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
    kids.set(parent, [...(kids.get(parent) ?? []), r]);
  }
  const out: Task[] = [];
  const walk = (parent: string | null, prefix: string, depth: number): Task[] => {
    const mine: Task[] = [];
    (kids.get(parent) ?? []).forEach((r, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const t: Task = {
        id: r.id, parentId: parent, wbs, depth, title: r.title, notes: r.notes, start: r.start_day, finish: r.finish_day,
        estimateMinutes: r.estimate_minutes, percentDone: r.percent_done, assignedTo: r.assigned_to, milestone: r.milestone,
        billable: r.billable, dependsOn: r.depends_on ?? [], plannerCardId: r.planner_card_id, summary: false,
        loggedMinutes: logged.get(r.id) ?? 0,
      };
      out.push(t);
      const children = walk(r.id, wbs, depth + 1);
      if (children.length) {
        t.summary = true;
        t.milestone = false;
        const starts = children.map((c) => c.start).filter((d): d is string => !!d).sort();
        const finishes = children.map((c) => c.finish).filter((d): d is string => !!d).sort();
        t.start = starts[0] ?? null;
        t.finish = finishes[finishes.length - 1] ?? null;
        const est = children.reduce((s, c) => s + (c.estimateMinutes ?? 0), 0);
        t.estimateMinutes = est || null;
        t.percentDone = overallPercent(children);
        t.loggedMinutes += children.reduce((s, c) => s + c.loggedMinutes, 0);
      }
      mine.push(t);
    });
    return mine;
  };
  walk(null, "", 0);
  return out;
}

/** Progress across tasks, weighted by estimate (or by length in workdays when there's none). */
export function overallPercent(tasks: Task[]): number {
  const top = tasks.filter((t) => t.depth === tasks[0]?.depth);
  if (!top.length) return 0;
  let weight = 0;
  let done = 0;
  for (const t of top) {
    const w = t.estimateMinutes || (t.start && t.finish ? workdays(t.start, t.finish) * 480 : 480);
    weight += w;
    done += (w * t.percentDone) / 100;
  }
  return weight ? Math.round((done / weight) * 100) : 0;
}

export async function listTasks(email: string, projectId: string): Promise<Task[]> {
  await roleOn(email, projectId);
  const logged = await q<{ task_id: string; m: string }>(
    `SELECT task_id, sum(minutes) AS m FROM time_entries WHERE project_id = $1::uuid AND task_id IS NOT NULL AND held_deleted_at IS NULL GROUP BY task_id`,
    [projectId],
  );
  return buildTasks(await taskRows(projectId), new Map(logged.map((r) => [r.task_id, Number(r.m)])));
}

export type TaskInput = {
  title?: unknown; notes?: unknown; parentId?: unknown; start?: unknown; finish?: unknown; durationDays?: unknown;
  estimateHours?: unknown; percentDone?: unknown; assignedTo?: unknown; milestone?: unknown; billable?: unknown;
  dependsOn?: unknown; position?: unknown; after?: unknown;
};

async function taskOf(tq: Tq, projectId: string, id: unknown, what: string): Promise<TaskRow> {
  if (!uuidish(id)) throw new UserError(`${what} not found`, 404);
  const [row] = await tq<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1::uuid AND project_id = $2::uuid AND held_deleted_at IS NULL`, [id, projectId]);
  if (!row) throw new UserError(`${what} not found`, 404);
  return row;
}

async function taskFields(tq: Tq, projectId: string, v: TaskInput, current: TaskRow | null): Promise<Record<string, unknown>> {
  const f: Record<string, unknown> = {};
  if (v.title !== undefined || !current) {
    const t = text(v.title, 300);
    if (!t) throw new UserError("Give the task a title");
    f.title = t;
  }
  if (v.notes !== undefined) f.notes = text(v.notes, 10000);
  if (v.parentId !== undefined) {
    if (v.parentId === null || v.parentId === "") f.parent_id = null;
    else {
      const parent = await taskOf(tq, projectId, v.parentId, "Parent task");
      // A task can't go under itself or one of its own subtasks.
      if (current) {
        let p: string | null = parent.id;
        while (p) {
          if (p === current.id) throw new UserError("A task can't go under one of its own subtasks");
          const [up]: { parent_id: string | null }[] = await tq<{ parent_id: string | null }>(`SELECT parent_id FROM tasks WHERE id = $1::uuid`, [p]);
          p = up?.parent_id ?? null;
        }
      }
      f.parent_id = parent.id;
    }
  }
  for (const [key, col] of [["start", "start_day"], ["finish", "finish_day"]] as const) {
    if (v[key] === undefined) continue;
    if (v[key] === null || v[key] === "") f[col] = null;
    else if (!isDay(v[key])) throw new UserError(`Bad ${key} date`);
    else f[col] = v[key];
  }
  const milestone = v.milestone !== undefined ? v.milestone === true : current?.milestone ?? false;
  if (v.milestone !== undefined) f.milestone = milestone;
  const start = (f.start_day !== undefined ? f.start_day : current?.start_day ?? null) as string | null;
  if (v.durationDays !== undefined && v.durationDays !== null && v.durationDays !== "") {
    const n = Number(v.durationDays);
    if (!Number.isInteger(n) || n < 1 || n > 2000) throw new UserError("Duration must be a whole number of workdays");
    if (start) f.finish_day = finishAfter(start, n);
  }
  if (milestone && start) f.finish_day = start;
  const finish = (f.finish_day !== undefined ? f.finish_day : current?.finish_day ?? null) as string | null;
  if (start && finish && finish < start) throw new UserError("The task finishes before it starts");
  if (start && !finish) f.finish_day = start;
  if (!start && finish) f.start_day = finish;
  if (v.estimateHours !== undefined) f.estimate_minutes = minutes(v.estimateHours, "Estimate") || null;
  if (v.percentDone !== undefined) {
    const n = Number(v.percentDone);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new UserError("Progress must be 0 to 100");
    f.percent_done = n;
  }
  if (v.assignedTo !== undefined) {
    if (v.assignedTo === null || v.assignedTo === "") f.assigned_to = null;
    else {
      const who = cleanEmail(v.assignedTo);
      const [m] = await tq(`SELECT 1 FROM members WHERE project_id = $1::uuid AND email = $2`, [projectId, who]);
      if (!m) throw new UserError("Add them to the team first");
      f.assigned_to = who;
    }
  }
  if (v.billable !== undefined) f.billable = v.billable !== false;
  if (v.dependsOn !== undefined) {
    const list = Array.isArray(v.dependsOn) ? [...new Set(v.dependsOn)] : null;
    if (!list || list.some((d) => !uuidish(d))) throw new UserError("Predecessors must be tasks in this project");
    for (const d of list) await taskOf(tq, projectId, d, "Predecessor");
    if (current && list.includes(current.id)) throw new UserError("A task can't come after itself");
    f.depends_on = list;
  }
  return f;
}

/** Refuses a change that would make tasks wait on each other in a circle. */
function checkNoCycle(rows: TaskRow[]): void {
  const deps = new Map(rows.map((r) => [r.id, r.depends_on ?? []]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new UserError("Those predecessors would make tasks wait on each other in a circle");
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d);
    state.set(id, 2);
  };
  for (const id of deps.keys()) visit(id);
}

/**
 * Moves tasks later so each one starts the workday after its predecessors finish, keeping its
 * length in workdays. Tasks are only pushed forward, never pulled earlier, as with Project's
 * "start as soon as possible" when the plan already has dates. Returns how many moved.
 */
export async function reschedule(tq: Tq, projectId: string): Promise<number> {
  const rows = await taskRows(projectId, tq);
  checkNoCycle(rows);
  const built = new Map(buildTasks(rows, new Map()).map((t) => [t.id, t]));
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const children = new Map<string, string[]>();
  for (const r of rows) if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r.id]);
  const finishOf = (id: string): string | null => {
    const kids = children.get(id);
    if (kids?.length) {
      const f = kids.map(finishOf).filter((d): d is string => !!d).sort();
      return f[f.length - 1] ?? null;
    }
    return byId.get(id)?.finish_day ?? null;
  };
  const done = new Set<string>();
  let moved = 0;
  const place = async (id: string): Promise<void> => {
    if (done.has(id)) return;
    done.add(id);
    const r = byId.get(id)!;
    for (const d of r.depends_on ?? []) if (byId.has(d)) await place(d);
    // A summary task moves by moving its subtasks; give them the summary's predecessors too.
    const preds = [...(r.depends_on ?? [])];
    for (let p = r.parent_id; p; p = byId.get(p)?.parent_id ?? null) preds.push(...(byId.get(p)?.depends_on ?? []));
    for (const d of preds) if (byId.has(d)) await place(d);
    const latest = preds.map(finishOf).filter((d): d is string => !!d).sort().pop();
    if (latest && !children.get(id)?.length) {
      const earliest = nextWorkday(latest);
      if (!r.start_day || r.start_day < earliest) {
        const length = r.milestone ? 1 : r.start_day && r.finish_day ? workdays(r.start_day, r.finish_day) : 1;
        r.start_day = r.milestone ? earliest : onWorkday(earliest);
        r.finish_day = r.milestone ? r.start_day : finishAfter(r.start_day, length);
        await tq(`UPDATE tasks SET start_day = $2, finish_day = $3, modified_at = now() WHERE id = $1::uuid`, [id, r.start_day, r.finish_day]);
        moved++;
      }
    }
    for (const k of children.get(id) ?? []) await place(k);
  };
  for (const id of [...built.keys()]) await place(id);
  return moved;
}

export async function createTask(email: string, projectId: string, v: TaskInput): Promise<Task> {
  await roleOn(email, projectId);
  const id = await tx(async (tq) => {
    const f = await taskFields(tq, projectId, v, null);
    // New tasks go at the end, or straight after the task named in `after`.
    let position: number;
    if (v.after !== undefined && v.after !== null) {
      const after = await taskOf(tq, projectId, v.after, "Task");
      position = after.position + 1;
      await tq(`UPDATE tasks SET position = position + 1 WHERE project_id = $1::uuid AND position >= $2`, [projectId, position]);
      if (f.parent_id === undefined) f.parent_id = after.parent_id;
    } else {
      const [m] = await tq<{ p: number | null }>(`SELECT max(position) AS p FROM tasks WHERE project_id = $1::uuid`, [projectId]);
      position = (m.p ?? -1) + 1;
    }
    const cols = Object.keys(f);
    const [row] = await tq<{ id: string }>(
      `INSERT INTO tasks (project_id, created_by, position${cols.map((c) => `, ${c}`).join("")})
       VALUES ($1::uuid, $2, $3${cols.map((_, i) => `, $${i + 4}`).join("")}) RETURNING id`,
      [projectId, email, position, ...cols.map((c) => f[c])],
    );
    await reschedule(tq, projectId);
    return row.id;
  });
  return (await listTasks(email, projectId)).find((t) => t.id === id)!;
}

export async function updateTask(email: string, projectId: string, taskId: string, v: TaskInput): Promise<Task[]> {
  await roleOn(email, projectId);
  await tx(async (tq) => {
    const current = await taskOf(tq, projectId, taskId, "Task");
    const f = await taskFields(tq, projectId, v, current);
    const cols = Object.keys(f);
    if (cols.length) {
      await tq(
        `UPDATE tasks SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, modified_at = now() WHERE id = $1::uuid`,
        [taskId, ...cols.map((c) => f[c])],
      );
    }
    if (v.position !== undefined) {
      const to = Number(v.position);
      if (!Number.isInteger(to) || to < 0) throw new UserError("Bad position");
      const ids = (await taskRows(projectId, tq)).map((r) => r.id).filter((i) => i !== taskId);
      ids.splice(Math.min(to, ids.length), 0, taskId);
      for (let i = 0; i < ids.length; i++) await tq(`UPDATE tasks SET position = $2 WHERE id = $1::uuid`, [ids[i], i]);
    }
    await reschedule(tq, projectId);
  });
  return listTasks(email, projectId);
}

/**
 * Deletes a task and its subtasks; time logged on them stays on the project without a task. While
 * whoever made a task or the project's managers are on legal hold, tasks are only hidden.
 */
export async function deleteTask(email: string, projectId: string, taskId: string): Promise<void> {
  await roleOn(email, projectId);
  const current = await taskOf(q, projectId, taskId, "Task");
  const tree = await q<{ id: string; created_by: string }>(
    `WITH RECURSIVE t AS (SELECT id, created_by FROM tasks WHERE id = $1::uuid
       UNION ALL SELECT c.id, c.created_by FROM tasks c JOIN t ON c.parent_id = t.id WHERE c.held_deleted_at IS NULL)
     SELECT id, created_by FROM t`,
    [current.id],
  );
  const managers = await q<{ email: string }>(`SELECT email FROM members WHERE project_id = $1::uuid AND role = 'manager'`, [projectId]);
  const held = holdChecker();
  let keep = false;
  for (const e of [...new Set([...tree.map((t) => t.created_by), ...managers.map((m) => m.email)])]) if (await held(e)) keep = true;
  const ids = tree.map((t) => t.id);
  await tx(async (tq) => {
    await tq(`UPDATE tasks SET depends_on = array_remove(depends_on, x) FROM unnest($2::uuid[]) x WHERE project_id = $1::uuid AND x = ANY(depends_on)`, [projectId, ids]);
    if (keep) await tq(`UPDATE tasks SET held_deleted_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
    else await tq(`DELETE FROM tasks WHERE id = $1::uuid`, [current.id]);
  });
}

/** Adds several tasks at once (a drafted plan, an import), in order, under optional phases. */
export async function addPlan(
  email: string,
  projectId: string,
  start: string,
  phases: { title: string; tasks: { title: string; durationDays: number; estimateHours?: number; milestone?: boolean }[] }[],
): Promise<Task[]> {
  await roleOn(email, projectId);
  if (!isDay(start)) throw new UserError("Bad start date");
  await tx(async (tq) => {
    const [m] = await tq<{ p: number | null }>(`SELECT max(position) AS p FROM tasks WHERE project_id = $1::uuid`, [projectId]);
    let position = (m.p ?? -1) + 1;
    let day = onWorkday(start);
    let previous: string | null = null;
    for (const phase of phases.slice(0, 20)) {
      const title = text(phase.title, 300);
      let parent: string | null = null;
      if (title) {
        const [row] = await tq<{ id: string }>(
          `INSERT INTO tasks (project_id, created_by, position, title) VALUES ($1::uuid, $2, $3, $4) RETURNING id`,
          [projectId, email, position++, title],
        );
        parent = row.id;
      }
      for (const t of phase.tasks.slice(0, 40)) {
        const name = text(t.title, 300);
        if (!name) continue;
        const length = t.milestone ? 1 : Math.min(250, Math.max(1, Math.round(Number(t.durationDays) || 1)));
        const finish = t.milestone ? day : finishAfter(day, length);
        const est = t.estimateHours ? Math.round(Math.min(10000, Math.max(0, Number(t.estimateHours) || 0)) * 60) || null : null;
        const [row]: { id: string }[] = await tq<{ id: string }>(
          `INSERT INTO tasks (project_id, created_by, position, title, parent_id, start_day, finish_day, estimate_minutes, milestone, depends_on)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [projectId, email, position++, name, parent, day, finish, est, t.milestone === true, previous ? [previous] : []],
        );
        previous = row.id;
        day = nextWorkday(finish);
      }
    }
  });
  return listTasks(email, projectId);
}

export { dayOf };
