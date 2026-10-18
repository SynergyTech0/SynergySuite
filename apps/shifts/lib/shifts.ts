import type { Me } from "./api";
import { isScheduler } from "./access";
import { q, tx, type Tq } from "./db";
import { UserError, addDays, color, day, id, minutes, optionalEmail, optionalId, text, today, weekStart } from "./util";

export type Position = { id: string; name: string; color: string };
export type Employee = {
  id: string;
  name: string;
  email: string;
  position_id: string | null;
  position_name: string | null;
  position_color: string | null;
  active: boolean;
};
export type Shift = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  position_id: string | null;
  position_name: string | null;
  position_color: string | null;
  location: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  notes: string;
  published: boolean;
};

function scheduler(me: Me): void {
  if (!isScheduler(me.email)) throw new UserError("Only schedulers can change the schedule", 403);
}

// ---- positions ----

export async function listPositions(): Promise<Position[]> {
  return q<Position>("SELECT id::text, name, color FROM positions ORDER BY lower(name)");
}

export async function createPosition(me: Me, b: Record<string, unknown>): Promise<Position> {
  scheduler(me);
  const name = text(b.name, 60);
  if (!name) throw new UserError("Name the position");
  const [p] = await q<Position>("INSERT INTO positions (name, color) VALUES ($1, $2) RETURNING id::text, name, color", [name, color(b.color)]);
  return p;
}

export async function updatePosition(me: Me, pid: unknown, b: Record<string, unknown>): Promise<Position> {
  scheduler(me);
  const name = b.name === undefined ? null : text(b.name, 60);
  if (name === "") throw new UserError("Name the position");
  const [p] = await q<Position>(
    "UPDATE positions SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 RETURNING id::text, name, color",
    [id(pid), name, b.color === undefined ? null : color(b.color)],
  );
  if (!p) throw new UserError("Not found", 404);
  return p;
}

/** Shifts and people with this position keep everything else and lose only the position. */
export async function deletePosition(me: Me, pid: unknown): Promise<void> {
  scheduler(me);
  const rows = await q("DELETE FROM positions WHERE id = $1 RETURNING id", [id(pid)]);
  if (!rows.length) throw new UserError("Not found", 404);
}

// ---- employees ----

const EMPLOYEE = `e.id::text, e.name, e.email, e.position_id::text, p.name AS position_name, p.color AS position_color, e.active`;

export async function listEmployees(includeInactive = false): Promise<Employee[]> {
  return q<Employee>(
    `SELECT ${EMPLOYEE} FROM employees e LEFT JOIN positions p ON p.id = e.position_id
     WHERE e.active OR $1 ORDER BY NOT e.active, lower(e.name)`,
    [includeInactive],
  );
}

async function employee(eid: string | number): Promise<Employee> {
  const [e] = await q<Employee>(`SELECT ${EMPLOYEE} FROM employees e LEFT JOIN positions p ON p.id = e.position_id WHERE e.id = $1`, [eid]);
  if (!e) throw new UserError("Not found", 404);
  return e;
}

export async function createEmployee(me: Me, b: Record<string, unknown>): Promise<Employee> {
  scheduler(me);
  const name = text(b.name, 100);
  if (!name) throw new UserError("Enter the person's name");
  const [r] = await q<{ id: string }>("INSERT INTO employees (name, email, position_id) VALUES ($1, $2, $3) RETURNING id::text", [
    name,
    optionalEmail(b.email),
    optionalId(b.positionId),
  ]);
  return employee(r.id);
}

export async function updateEmployee(me: Me, eid: unknown, b: Record<string, unknown>): Promise<Employee> {
  scheduler(me);
  const n = id(eid);
  const name = b.name === undefined ? null : text(b.name, 100);
  if (name === "") throw new UserError("Enter the person's name");
  const rows = await q(
    `UPDATE employees SET name = COALESCE($2, name), email = COALESCE($3, email),
       position_id = CASE WHEN $4 THEN $5::bigint ELSE position_id END, active = COALESCE($6, active)
     WHERE id = $1 RETURNING id`,
    [
      n,
      name,
      b.email === undefined ? null : optionalEmail(b.email),
      b.positionId !== undefined,
      b.positionId === undefined ? null : optionalId(b.positionId),
      b.active === undefined ? null : Boolean(b.active),
    ],
  );
  if (!rows.length) throw new UserError("Not found", 404);
  return employee(n);
}

/** The roster entry for a suite account, matched by email. */
export async function rosterEntry(email: string): Promise<Employee | null> {
  const [e] = await q<Employee>(
    `SELECT ${EMPLOYEE} FROM employees e LEFT JOIN positions p ON p.id = e.position_id WHERE lower(e.email) = lower($1) AND e.active`,
    [email],
  );
  return e ?? null;
}

// ---- shifts ----

const SHIFT = `s.id::text, s.employee_id::text, e.name AS employee_name, s.position_id::text, p.name AS position_name,
  p.color AS position_color, s.location, to_char(s.shift_date, 'YYYY-MM-DD') AS shift_date, s.start_min, s.end_min, s.notes, s.published`;
const SHIFT_FROM = "shifts s LEFT JOIN employees e ON e.id = s.employee_id LEFT JOIN positions p ON p.id = s.position_id";

async function getShift(sid: string | number): Promise<Shift> {
  const [s] = await q<Shift>(`SELECT ${SHIFT} FROM ${SHIFT_FROM} WHERE s.id = $1`, [sid]);
  if (!s) throw new UserError("Not found", 404);
  return s;
}

/**
 * Refuses a shift that overlaps another of the same person's that day. Locks the person's roster
 * row first, so two changes for one person can't both pass the check at once.
 */
async function noClash(tq: Tq, employeeId: number | null, date: string, start: number, end: number, except: number | null, who = "This person") {
  if (employeeId === null) return;
  const [e] = await tq<{ active: boolean }>("SELECT active FROM employees WHERE id = $1 FOR UPDATE", [employeeId]);
  if (!e) throw new UserError("That person isn't on the roster", 404);
  if (!e.active) throw new UserError("That person is no longer on the roster");
  const clash = await tq(
    `SELECT 1 FROM shifts WHERE employee_id = $1 AND shift_date = $2 AND start_min < $4 AND end_min > $3 AND ($5::bigint IS NULL OR id <> $5)`,
    [employeeId, date, start, end, except],
  );
  if (clash.length) throw new UserError(`${who} already has a shift that overlaps this one`, 409);
}

export async function createShift(me: Me, b: Record<string, unknown>): Promise<Shift> {
  scheduler(me);
  const date = day(b.date);
  const start = minutes(b.start, "Start");
  const end = minutes(b.end, "End");
  if (start >= end) throw new UserError("A shift has to end after it starts");
  const employeeId = optionalId(b.employeeId);
  const sid = await tx(async (tq) => {
    await noClash(tq, employeeId, date, start, end, null);
    const [r] = await tq<{ id: string }>(
      `INSERT INTO shifts (employee_id, position_id, location, shift_date, start_min, end_min, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
      [employeeId, optionalId(b.positionId), text(b.location, 100), date, start, end, text(b.notes, 300), me.email],
    );
    return r.id;
  });
  return getShift(sid);
}

export async function updateShift(me: Me, sidRaw: unknown, b: Record<string, unknown>): Promise<Shift> {
  scheduler(me);
  const sid = id(sidRaw);
  await tx(async (tq) => {
    const [cur] = await tq<{ employee_id: string | null; shift_date: string; start_min: number; end_min: number }>(
      "SELECT employee_id::text, to_char(shift_date, 'YYYY-MM-DD') AS shift_date, start_min, end_min FROM shifts WHERE id = $1 FOR UPDATE",
      [sid],
    );
    if (!cur) throw new UserError("Not found", 404);
    const employeeId = b.employeeId === undefined ? (cur.employee_id ? Number(cur.employee_id) : null) : optionalId(b.employeeId);
    const date = b.date === undefined ? cur.shift_date : day(b.date);
    const start = b.start === undefined ? cur.start_min : minutes(b.start, "Start");
    const end = b.end === undefined ? cur.end_min : minutes(b.end, "End");
    if (start >= end) throw new UserError("A shift has to end after it starts");
    await noClash(tq, employeeId, date, start, end, sid);
    await tq(
      `UPDATE shifts SET employee_id = $2, shift_date = $3, start_min = $4, end_min = $5,
         position_id = CASE WHEN $6 THEN $7::bigint ELSE position_id END,
         location = COALESCE($8, location), notes = COALESCE($9, notes), updated_at = now()
       WHERE id = $1`,
      [
        sid,
        employeeId,
        date,
        start,
        end,
        b.positionId !== undefined,
        b.positionId === undefined ? null : optionalId(b.positionId),
        b.location === undefined ? null : text(b.location, 100),
        b.notes === undefined ? null : text(b.notes, 300),
      ],
    );
  });
  return getShift(sid);
}

export async function deleteShift(me: Me, sid: unknown): Promise<void> {
  scheduler(me);
  const rows = await q("DELETE FROM shifts WHERE id = $1 RETURNING id", [id(sid)]);
  if (!rows.length) throw new UserError("Not found", 404);
}

/** The week containing `of` (default this week). Schedulers see drafts; everyone else only published shifts. */
export async function schedule(me: Me, of?: unknown) {
  const monday = weekStart(of ? day(of, "Week") : today());
  const sunday = addDays(monday, 6);
  const admin = isScheduler(me.email);
  const shifts = await q<Shift>(
    `SELECT ${SHIFT} FROM ${SHIFT_FROM} WHERE s.shift_date BETWEEN $1 AND $2 AND (s.published OR $3) ORDER BY s.shift_date, s.start_min, s.id`,
    [monday, sunday, admin],
  );
  const hours: Record<string, number> = {};
  for (const s of shifts) if (s.employee_id) hours[s.employee_id] = (hours[s.employee_id] ?? 0) + (s.end_min - s.start_min) / 60;
  const drafts = shifts.filter((s) => !s.published).length;
  const me_ = await rosterEntry(me.email);
  return { weekOf: monday, weekEnd: sunday, shifts, hours, drafts, admin, me: me_?.id ?? null };
}

/** Publishes every draft shift in the week containing `of`. */
export async function publish(me: Me, of: unknown): Promise<{ published: number }> {
  scheduler(me);
  const monday = weekStart(day(of, "Week"));
  const rows = await q("UPDATE shifts SET published = true, updated_at = now() WHERE shift_date BETWEEN $1 AND $2 AND NOT published RETURNING id", [
    monday,
    addDays(monday, 6),
  ]);
  return { published: rows.length };
}

/** Takes a published open shift for the signed-in person, if they are on the roster and free then. */
export async function claim(me: Me, sidRaw: unknown): Promise<Shift> {
  const sid = id(sidRaw);
  const emp = await rosterEntry(me.email);
  if (!emp) throw new UserError("You aren't on the roster, so you can't claim shifts. Ask a scheduler to add you.", 403);
  await tx(async (tq) => {
    const [s] = await tq<{ employee_id: string | null; published: boolean; shift_date: string; start_min: number; end_min: number }>(
      "SELECT employee_id::text, published, to_char(shift_date, 'YYYY-MM-DD') AS shift_date, start_min, end_min FROM shifts WHERE id = $1 FOR UPDATE",
      [sid],
    );
    if (!s || !s.published) throw new UserError("Not found", 404);
    if (s.employee_id) throw new UserError("Someone has already taken this shift", 409);
    if (s.shift_date < today()) throw new UserError("This shift is in the past");
    await noClash(tq, Number(emp.id), s.shift_date, s.start_min, s.end_min, sid, "You");
    await tq("UPDATE shifts SET employee_id = $2, updated_at = now() WHERE id = $1", [sid, emp.id]);
  });
  return getShift(sid);
}

/** The signed-in person's published shifts from yesterday on. */
export async function myShifts(me: Me): Promise<Shift[]> {
  const emp = await rosterEntry(me.email);
  if (!emp) return [];
  return q<Shift>(
    `SELECT ${SHIFT} FROM ${SHIFT_FROM} WHERE s.employee_id = $1 AND s.published AND s.shift_date >= $2::date - 1
     ORDER BY s.shift_date, s.start_min LIMIT 200`,
    [emp.id, today()],
  );
}
