import { type Roles, rolesFor, teamOf } from "./access";
import { audit, q, tx } from "./db";
import { addDays, businessDays, isDay } from "./days";
import { UserError, cleanEmail, num, oneOf, text } from "./util";
import type { Me } from "./api";

/* ------------------------------------------------------------------ people */

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "intern", "temporary"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** What each kind of viewer can see of a person. */
const DIRECTORY = ["id", "email", "name", "title", "department", "location", "manager_email", "phone", "pronouns", "active"];
const TEAM = [...DIRECTORY, "start_date", "end_date", "employment_type", "pto_days_per_year", "sick_days_per_year"];
const SELF = [...TEAM, "emergency_contact", "personal_email", "home_address"];
const HR = [...SELF, "notes", "created_at", "modified_at"];
export type Tier = "directory" | "team" | "self" | "hr";
const TIER_FIELDS: Record<Tier, string[]> = { directory: DIRECTORY, team: TEAM, self: SELF, hr: HR };

export type Employee = Record<string, unknown> & { id: string; email: string; name: string; manager_email: string; tier: Tier };

const COLS = `id::text, email, name, title, department, location, manager_email, phone, pronouns, active,
  to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, employment_type,
  pto_days_per_year::float AS pto_days_per_year, sick_days_per_year::float AS sick_days_per_year,
  emergency_contact, personal_email, home_address, notes, created_at, modified_at`;

function shape(row: Record<string, unknown>, tier: Tier): Employee {
  const out: Record<string, unknown> = { tier };
  for (const k of TIER_FIELDS[tier]) out[k] = row[k];
  return out as Employee;
}

export interface Viewer extends Me {
  roles: Roles;
  team: Set<string>;
}

export async function viewer(me: Me): Promise<Viewer> {
  const roles = await rolesFor(me.email);
  return { ...me, roles, team: new Set(roles.manager ? await teamOf(me.email) : []) };
}

function tierFor(v: Viewer, email: string): Tier {
  if (v.roles.hrAdmin) return "hr";
  if (email === v.email) return "self";
  if (v.team.has(email)) return "team";
  return "directory";
}

export async function listEmployees(v: Viewer, includeFormer = false): Promise<Employee[]> {
  const rows = await q(`SELECT ${COLS} FROM employees ${includeFormer && v.roles.hrAdmin ? "" : "WHERE active"} ORDER BY lower(name)`);
  return rows.map((r) => shape(r, tierFor(v, r.email as string)));
}

export async function getEmployee(v: Viewer, id: string): Promise<Employee> {
  if (!/^\d{1,18}$/.test(id)) throw new UserError("Not found", 404);
  const [row] = await q(`SELECT ${COLS} FROM employees WHERE id = $1`, [id]);
  if (!row || (!row.active && !v.roles.hrAdmin && row.email !== v.email)) throw new UserError("Not found", 404);
  return shape(row, tierFor(v, row.email as string));
}

export async function employeeByEmail(email: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await q(`SELECT ${COLS} FROM employees WHERE email = $1`, [email.toLowerCase()]);
  return row;
}

type Body = Record<string, unknown>;

function day(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (!isDay(v)) throw new UserError(`${name} must be a date`);
  return v;
}

/** Fields an HR admin sets. Missing keys keep their value. */
function adminFields(b: Body): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if ("name" in b) {
    f.name = text(b.name, 200);
    if (!f.name) throw new UserError("Enter a name");
  }
  for (const k of ["title", "department", "location", "phone", "pronouns"]) if (k in b) f[k] = text(b[k], 200);
  if ("managerEmail" in b) f.manager_email = b.managerEmail ? cleanEmail(b.managerEmail) : "";
  if ("employmentType" in b) f.employment_type = oneOf(b.employmentType, EMPLOYMENT_TYPES, "full_time");
  if ("startDate" in b) f.start_date = day(b.startDate, "Start date");
  if ("endDate" in b) f.end_date = day(b.endDate, "End date");
  if ("ptoDays" in b) f.pto_days_per_year = num(b.ptoDays, "Vacation days", 15, { min: 0, max: 365 });
  if ("sickDays" in b) f.sick_days_per_year = num(b.sickDays, "Sick days", 5, { min: 0, max: 365 });
  if ("active" in b) f.active = Boolean(b.active);
  if ("notes" in b) f.notes = text(b.notes, 5000);
  Object.assign(f, selfFields(b));
  return f;
}

/** Fields people keep up to date themselves. */
function selfFields(b: Body): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const k of ["phone", "pronouns"]) if (k in b) f[k] = text(b[k], 200);
  if ("emergencyContact" in b) f.emergency_contact = text(b.emergencyContact, 500);
  if ("personalEmail" in b) f.personal_email = b.personalEmail ? cleanEmail(b.personalEmail) : "";
  if ("homeAddress" in b) f.home_address = text(b.homeAddress, 500);
  return f;
}

export async function createEmployee(v: Viewer, b: Body): Promise<Employee> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can add people", 403);
  const email = cleanEmail(b.email);
  const f = adminFields({ ...b, name: b.name ?? "" });
  if (f.manager_email === email) throw new UserError("Someone can't be their own manager");
  const keys = Object.keys(f);
  const [row] = await q<{ id: string }>(
    `INSERT INTO employees (email, ${keys.join(", ")}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id::text`,
    [email, ...keys.map((k) => f[k])],
  ).catch((e) => {
    if ((e as { code?: string }).code === "23505") throw new UserError("That person is already in HR", 409);
    throw e;
  });
  await audit(v.email, "employee.create", email, { fields: keys });
  return getEmployee(v, row.id);
}

export async function updateEmployee(v: Viewer, id: string, b: Body): Promise<Employee> {
  const current = await getEmployee(v, id);
  const self = current.email === v.email;
  if (!v.roles.hrAdmin && !self) throw new UserError("Only HR admins can change someone else's record", 403);
  const f = v.roles.hrAdmin ? adminFields(b) : selfFields(b);
  if (f.manager_email && f.manager_email === current.email) throw new UserError("Someone can't be their own manager");
  if (f.manager_email && (await teamOf(current.email)).includes(f.manager_email as string)) {
    throw new UserError("That would make a loop: the new manager reports to this person");
  }
  const keys = Object.keys(f);
  if (keys.length) {
    await q(
      `UPDATE employees SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, modified_at = now() WHERE id = $1`,
      [id, ...keys.map((k) => f[k])],
    );
    await audit(v.email, "employee.update", current.email, { fields: keys });
  }
  return getEmployee(v, id);
}

/* ---------------------------------------------------------------- time off */

export const TIME_OFF_KINDS = ["vacation", "sick", "personal", "other"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];

export interface TimeOff {
  id: string; employee_email: string; employee_name: string; kind: TimeOffKind | null; start_date: string; end_date: string;
  days: number; note: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string; created_at: string;
}

const TO_COLS = `r.id::text, r.employee_email, COALESCE(e.name, r.employee_email) AS employee_name, r.kind,
  to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date, r.days::float AS days,
  r.note, r.status, r.decided_by, r.decided_at, r.decision_note, r.created_at`;
const TO_FROM = "pto_requests r LEFT JOIN employees e ON e.email = r.employee_email";

/** Why someone is out is private: others see only that they are. */
function redact(v: Viewer, r: TimeOff): TimeOff {
  if (v.roles.hrAdmin || r.employee_email === v.email || v.team.has(r.employee_email)) return r;
  return { ...r, kind: null, note: "", decision_note: "", decided_by: null };
}

export async function holidayDays(from: string, to: string): Promise<string[]> {
  const rows = await q<{ day: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM holidays WHERE day BETWEEN $1 AND $2", [from, to]);
  return rows.map((r) => r.day);
}

export async function listTimeOff(v: Viewer, scope: string, from?: string, to?: string): Promise<TimeOff[]> {
  if (scope === "approvals") {
    if (!v.roles.hrAdmin && !v.team.size) return [];
    const rows = await q<TimeOff>(
      `SELECT ${TO_COLS} FROM ${TO_FROM} WHERE r.status = 'pending' AND r.employee_email <> $1
         AND ($2 OR r.employee_email = ANY($3)) ORDER BY r.start_date`,
      [v.email, v.roles.hrAdmin, [...v.team]],
    );
    return rows;
  }
  if (scope === "calendar") {
    const a = isDay(from) ? from : new Date().toISOString().slice(0, 10);
    const b = isDay(to) ? to : addDays(a, 41);
    const rows = await q<TimeOff>(
      `SELECT ${TO_COLS} FROM ${TO_FROM} WHERE r.status IN ('approved','pending') AND r.start_date <= $2 AND r.end_date >= $1
       ORDER BY r.start_date, employee_name LIMIT 500`,
      [a, b],
    );
    // Pending requests are only shown to the people who can see them in full.
    return rows.filter((r) => r.status === "approved" || tierFor(v, r.employee_email) !== "directory").map((r) => redact(v, r));
  }
  if (scope === "all" && v.roles.hrAdmin) {
    return q<TimeOff>(`SELECT ${TO_COLS} FROM ${TO_FROM} ORDER BY r.created_at DESC LIMIT 500`);
  }
  return q<TimeOff>(`SELECT ${TO_COLS} FROM ${TO_FROM} WHERE r.employee_email = $1 ORDER BY r.start_date DESC LIMIT 200`, [v.email]);
}

export interface Balance { kind: "vacation" | "sick"; allowance: number; used: number; pending: number; remaining: number }

export async function balances(email: string, year = new Date().getUTCFullYear()): Promise<Balance[] | null> {
  const emp = await employeeByEmail(email);
  if (!emp) return null;
  const rows = await q<{ kind: string; status: string; days: number }>(
    `SELECT kind, status, SUM(days)::float AS days FROM pto_requests
     WHERE employee_email = $1 AND status IN ('approved','pending') AND EXTRACT(YEAR FROM start_date) = $2 GROUP BY kind, status`,
    [email, year],
  );
  const sum = (kind: string, status: string) => rows.filter((r) => r.kind === kind && r.status === status).reduce((s, r) => s + r.days, 0);
  return (["vacation", "sick"] as const).map((kind) => {
    const allowance = Number(kind === "vacation" ? emp.pto_days_per_year : emp.sick_days_per_year);
    const used = sum(kind, "approved");
    return { kind, allowance, used, pending: sum(kind, "pending"), remaining: allowance - used };
  });
}

export async function requestTimeOff(v: Viewer, b: Body): Promise<TimeOff> {
  const start = day(b.startDate, "Start date");
  const end = day(b.endDate, "End date") ?? start;
  if (!start || !end || start > end) throw new UserError("Pick a start date on or before the end date");
  if (end > addDays(start, 366)) throw new UserError("Ask for at most a year at a time");
  const kind = oneOf(b.kind, TIME_OFF_KINDS, "other");
  const days = businessDays(start, end, await holidayDays(start, end));
  if (days <= 0) throw new UserError("There are no working days in those dates");
  const id = await tx(async (tq) => {
    const clash = await tq(
      `SELECT 1 FROM pto_requests WHERE employee_email = $1 AND status IN ('pending','approved') AND start_date <= $3 AND end_date >= $2`,
      [v.email, start, end],
    );
    if (clash.length) throw new UserError("You already have time off on some of those days");
    const [row] = await tq<{ id: string }>(
      `INSERT INTO pto_requests (employee_email, kind, start_date, end_date, days, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text`,
      [v.email, kind, start, end, days, text(b.note, 500)],
    );
    return row.id;
  });
  return (await q<TimeOff>(`SELECT ${TO_COLS} FROM ${TO_FROM} WHERE r.id = $1`, [id]))[0];
}

async function oneRequest(id: string): Promise<TimeOff> {
  if (!/^\d{1,18}$/.test(id)) throw new UserError("Not found", 404);
  const [r] = await q<TimeOff>(`SELECT ${TO_COLS} FROM ${TO_FROM} WHERE r.id = $1`, [id]);
  if (!r) throw new UserError("Not found", 404);
  return r;
}

export async function decideTimeOff(v: Viewer, id: string, b: Body): Promise<TimeOff> {
  const r = await oneRequest(id);
  if (r.employee_email === v.email) throw new UserError("Someone else has to approve your own time off", 403);
  if (!v.roles.hrAdmin && !v.team.has(r.employee_email)) throw new UserError("Only their manager or HR can decide this", 403);
  const status = b.status === "approved" ? "approved" : "denied";
  const rows = await q(
    `UPDATE pto_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, modified_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id, status, v.email, text(b.note, 500)],
  );
  if (!rows.length) throw new UserError("That request was already decided or cancelled", 409);
  await audit(v.email, `timeoff.${status}`, r.employee_email, { id, start: r.start_date, end: r.end_date });
  return oneRequest(id);
}

export async function cancelTimeOff(v: Viewer, id: string): Promise<TimeOff> {
  const r = await oneRequest(id);
  if (r.employee_email !== v.email && !v.roles.hrAdmin) throw new UserError("Not found", 404);
  const rows = await q(
    `UPDATE pto_requests SET status = 'cancelled', modified_at = now() WHERE id = $1 AND status IN ('pending','approved') RETURNING id`,
    [id],
  );
  if (!rows.length) throw new UserError("That request can't be cancelled now", 409);
  return oneRequest(id);
}

/* ---------------------------------------------------------------- holidays */

export async function listHolidays(year: number): Promise<{ day: string; name: string }[]> {
  return q("SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM holidays WHERE EXTRACT(YEAR FROM day) = $1 ORDER BY day", [year]);
}

export async function setHoliday(v: Viewer, b: Body): Promise<void> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can change holidays", 403);
  const d = day(b.day, "Date");
  if (!d) throw new UserError("Pick a date");
  const name = text(b.name, 120);
  if (!name) throw new UserError("Name the holiday");
  await q("INSERT INTO holidays (day, name) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name", [d, name]);
}

export async function removeHoliday(v: Viewer, d: string): Promise<void> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can change holidays", 403);
  if (!isDay(d)) throw new UserError("Not found", 404);
  await q("DELETE FROM holidays WHERE day = $1", [d]);
}

/* -------------------------------------------------------------- checklists */

export type Owner = "employee" | "manager" | "hr";
export interface TemplateTask { title: string; owner: Owner; dueDays: number }
export interface Template { id: string; kind: "onboarding" | "offboarding"; name: string; tasks: TemplateTask[] }

const DEFAULT_TEMPLATES: Omit<Template, "id">[] = [
  {
    kind: "onboarding",
    name: "New hire",
    tasks: [
      { title: "Order a laptop and equipment", owner: "manager", dueDays: -7 },
      { title: "Send the welcome email with first-day details", owner: "hr", dueDays: -3 },
      { title: "Create their suite account and mailbox", owner: "hr", dueDays: -2 },
      { title: "Plan the first week and pick a buddy", owner: "manager", dueDays: -1 },
      { title: "Add your emergency contact and home address", owner: "employee", dueDays: 0 },
      { title: "Give HR your W-4 and direct deposit details", owner: "employee", dueDays: 0 },
      { title: "Read the employee handbook", owner: "employee", dueDays: 3 },
      { title: "Set up payroll and benefits", owner: "hr", dueDays: 3 },
      { title: "30-day check-in", owner: "manager", dueDays: 30 },
    ],
  },
  {
    kind: "offboarding",
    name: "Leaver",
    tasks: [
      { title: "Agree the handover plan", owner: "manager", dueDays: -10 },
      { title: "Hold the exit interview", owner: "hr", dueDays: -2 },
      { title: "Hand over your work and files", owner: "employee", dueDays: -1 },
      { title: "Return the laptop, badge and equipment", owner: "employee", dueDays: 0 },
      { title: "Turn off their suite sign-in", owner: "hr", dueDays: 0 },
      { title: "Run the final paycheck and end benefits", owner: "hr", dueDays: 0 },
    ],
  },
];

export async function listTemplates(): Promise<Template[]> {
  let rows = await q<Template>("SELECT id, kind, name, tasks FROM checklist_templates ORDER BY kind, name");
  if (!rows.length) {
    for (const t of DEFAULT_TEMPLATES) {
      await q("INSERT INTO checklist_templates (kind, name, tasks) VALUES ($1, $2, $3)", [t.kind, t.name, JSON.stringify(t.tasks)]);
    }
    rows = await q<Template>("SELECT id, kind, name, tasks FROM checklist_templates ORDER BY kind, name");
  }
  return rows;
}

function cleanTasks(v: unknown): TemplateTask[] {
  if (!Array.isArray(v)) throw new UserError("tasks must be a list");
  const tasks = v.slice(0, 100).map((t: Body) => ({
    title: text(t?.title, 300),
    owner: oneOf(t?.owner, ["employee", "manager", "hr"] as const, "hr"),
    dueDays: Math.round(num(t?.dueDays, "Due", 0, { min: -365, max: 365 })),
  })).filter((t) => t.title);
  if (!tasks.length) throw new UserError("Add at least one task");
  return tasks;
}

export async function saveTemplate(v: Viewer, id: string | null, b: Body): Promise<Template> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can change checklists", 403);
  const name = text(b.name, 120);
  if (!name) throw new UserError("Name the checklist");
  const kind = oneOf(b.kind, ["onboarding", "offboarding"] as const, "onboarding");
  const tasks = cleanTasks(b.tasks);
  const [row] = id
    ? await q<Template>("UPDATE checklist_templates SET name = $2, kind = $3, tasks = $4 WHERE id = $1 RETURNING id, kind, name, tasks", [id, name, kind, JSON.stringify(tasks)])
    : await q<Template>("INSERT INTO checklist_templates (name, kind, tasks) VALUES ($1, $2, $3) RETURNING id, kind, name, tasks", [name, kind, JSON.stringify(tasks)]);
  if (!row) throw new UserError("Not found", 404);
  return row;
}

export async function deleteTemplate(v: Viewer, id: string): Promise<void> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can change checklists", 403);
  await q("DELETE FROM checklist_templates WHERE id = $1", [id]);
}

export interface Task {
  id: string; checklist_id: string; title: string; owner: Owner; assignee: string; due: string | null;
  done_at: string | null; done_by: string | null; employee_id: string; employee_name: string; kind: string;
}

const TASK_COLS = `t.id, t.checklist_id, t.title, t.owner, t.assignee, to_char(t.due, 'YYYY-MM-DD') AS due, t.done_at, t.done_by,
  c.employee_id::text AS employee_id, e.name AS employee_name, c.kind`;
const TASK_FROM = "checklist_tasks t JOIN checklists c ON c.id = t.checklist_id JOIN employees e ON e.id = c.employee_id";

export async function startChecklist(v: Viewer, b: Body): Promise<{ id: string }> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can start checklists", 403);
  const emp = await getEmployee(v, String(b.employeeId ?? ""));
  const [tpl] = await q<Template>("SELECT id, kind, name, tasks FROM checklist_templates WHERE id::text = $1", [String(b.templateId ?? "")]);
  if (!tpl) throw new UserError("Pick a checklist");
  const anchor = (tpl.kind === "onboarding" ? emp.start_date : emp.end_date) as string | null;
  const base = anchor || new Date().toISOString().slice(0, 10);
  return tx(async (tq) => {
    const [c] = await tq<{ id: string }>(
      "INSERT INTO checklists (employee_id, kind, title, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
      [emp.id, tpl.kind, `${tpl.name}: ${emp.name}`, v.email],
    );
    let i = 0;
    for (const t of tpl.tasks) {
      const assignee = t.owner === "employee" ? emp.email : t.owner === "manager" ? emp.manager_email : "";
      await tq("INSERT INTO checklist_tasks (checklist_id, title, owner, assignee, due, position) VALUES ($1,$2,$3,$4,$5,$6)",
        [c.id, t.title, t.owner, assignee, addDays(base, t.dueDays), i++]);
    }
    await audit(v.email, "checklist.start", emp.email, { template: tpl.name }, tq);
    return { id: c.id };
  });
}

/** Open tasks for this person: their own, plus unassigned HR tasks for HR admins. */
export async function myTasks(v: Viewer): Promise<Task[]> {
  return q<Task>(
    `SELECT ${TASK_COLS} FROM ${TASK_FROM}
     WHERE t.done_at IS NULL AND (t.assignee = $1 OR ($2 AND t.owner = 'hr' AND t.assignee = ''))
     ORDER BY t.due NULLS LAST, t.position`,
    [v.email, v.roles.hrAdmin],
  );
}

export interface Checklist { id: string; employee_id: string; employee_name: string; kind: string; title: string; created_at: string; tasks: Task[] }

/** Checklists HR admins see for everyone, managers for their team and people for themselves. */
export async function listChecklists(v: Viewer, employeeId?: string): Promise<Checklist[]> {
  const rows = await q<Omit<Checklist, "tasks"> & { email: string }>(
    `SELECT c.id, c.employee_id::text AS employee_id, e.name AS employee_name, e.email, c.kind, c.title, c.created_at
     FROM checklists c JOIN employees e ON e.id = c.employee_id
     WHERE ($1::text IS NULL OR c.employee_id::text = $1) ORDER BY c.created_at DESC LIMIT 200`,
    [employeeId ?? null],
  );
  const visible = rows.filter((r) => tierFor(v, r.email) !== "directory");
  if (!visible.length) return [];
  const tasks = await q<Task>(`SELECT ${TASK_COLS} FROM ${TASK_FROM} WHERE t.checklist_id = ANY($1) ORDER BY t.position`, [visible.map((r) => r.id)]);
  return visible.map(({ email: _email, ...c }) => ({ ...c, tasks: tasks.filter((t) => t.checklist_id === c.id) }));
}

export async function setTaskDone(v: Viewer, id: string, done: boolean): Promise<void> {
  const [t] = await q<Task & { email: string }>(`SELECT ${TASK_COLS}, e.email FROM ${TASK_FROM} WHERE t.id::text = $1`, [id]);
  if (!t) throw new UserError("Not found", 404);
  const mine = t.assignee === v.email || (t.owner === "manager" && v.team.has(t.email));
  if (!mine && !v.roles.hrAdmin) throw new UserError("That task belongs to someone else", 403);
  await q(`UPDATE checklist_tasks SET done_at = ${done ? "now()" : "NULL"}, done_by = $2 WHERE id = $1`, [id, done ? v.email : null]);
}

export async function deleteChecklist(v: Viewer, id: string): Promise<void> {
  if (!v.roles.hrAdmin) throw new UserError("Only HR admins can remove checklists", 403);
  await q("DELETE FROM checklists WHERE id::text = $1", [id]);
}
