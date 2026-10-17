import { type Tq, q, tx } from "./db";
import { noteTicket } from "./desk";
import { type Staff, getSettings, nameOf, rateFor, requireDispatcher, requireStaff, technicians } from "./staff";
import { UserError, text, uuidish } from "./util";
import { type Booking, type WorkOrder, WO_COLS, WO_FROM, access, assertOpen, event, toBooking, toWorkOrder } from "./workorders";

/**
 * The schedule: bookings put a technician on a work order for a stretch of time. Dispatchers book
 * and move them on the board; technicians step through each visit (on the way, on site, done)
 * from their phone, and finishing a visit records the time on site as labor.
 */

const ACTIVE = "('scheduled', 'traveling', 'on_site')";

function when(v: unknown, what: string): Date {
  const d = new Date(String(v ?? ""));
  if (!v || Number.isNaN(d.getTime())) throw new UserError(`${what} must be a date and time`);
  return d;
}

function range(b: Record<string, unknown>): { start: Date; end: Date } {
  const start = when(b.start, "Start");
  const end = when(b.end, "End");
  if (end <= start) throw new UserError("A booking has to end after it starts");
  if (end.getTime() - start.getTime() > 14 * 86_400_000) throw new UserError("A booking can be at most two weeks long");
  return { start, end };
}

/** The minutes from UTC that `tz` is at the instant `at`. */
export function zoneOffset(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((local - at.getTime()) / 60_000);
}

/** The instant it is `hour`:00 on `day` (YYYY-MM-DD) in `tz`. */
export function zonedTime(day: string, hour: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  let at = new Date(guess - zoneOffset(new Date(guess), tz) * 60_000);
  at = new Date(guess - zoneOffset(at, tz) * 60_000); // again, in case the first guess crossed a clock change
  return at;
}

/** Today (YYYY-MM-DD) in `tz`. */
export function zonedDay(at: Date, tz: string): string {
  return new Date(at.getTime() + zoneOffset(at, tz) * 60_000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekend(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 || w === 6;
}

function fmt(at: Date, tz: string): string {
  return at.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function assertTechnician(email: string): Promise<string> {
  const e = text(email, 200).toLowerCase();
  const [t] = await q("SELECT 1 FROM staff WHERE email = $1 AND role = 'technician' AND active", [e]);
  if (!t) throw new UserError("Pick a technician on the team");
  return e;
}

/** Bookings that would overlap this one for the same technician. */
async function clashes(technician: string, start: Date, end: Date, except?: string) {
  return q<{ number: string; starts_at: Date }>(
    `SELECT w.number, b.starts_at FROM bookings b JOIN work_orders w ON w.id = b.work_order_id
     WHERE b.technician = $1 AND b.status <> 'cancelled' AND b.starts_at < $3 AND b.ends_at > $2 AND ($4::uuid IS NULL OR b.id <> $4)
     ORDER BY b.starts_at`,
    [technician, start, end, except ?? null],
  );
}

async function refuseClash(technician: string, start: Date, end: Date, force: unknown, except?: string): Promise<void> {
  if (force === true) return;
  const c = await clashes(technician, start, end, except);
  if (c.length) {
    const tz = (await getSettings()).timeZone;
    throw new UserError(`That overlaps ${c.map((x) => `${x.number} at ${fmt(new Date(x.starts_at), tz)}`).join(", ")}. Book anyway to double-book.`, 409);
  }
}

export async function book(me: string, b: Record<string, unknown>): Promise<Booking> {
  await requireDispatcher(me);
  const workOrderId = String(b.workOrderId ?? "");
  await access(me, workOrderId);
  const w = await assertOpen(workOrderId);
  const technician = await assertTechnician(String(b.technician ?? ""));
  const { start, end } = range(b);
  await refuseClash(technician, start, end, b.force);
  const tz = (await getSettings()).timeZone;
  const who = await nameOf(technician);
  const r = await tx(async (tq) => {
    const [row] = await tq("INSERT INTO bookings (work_order_id, technician, starts_at, ends_at, booked_by) VALUES ($1, $2, $3, $4, $5) RETURNING *", [
      workOrderId, technician, start, end, me,
    ]);
    await tq("UPDATE work_orders SET status = 'scheduled', modified_at = now() WHERE id = $1 AND status IN ('new', 'on_hold')", [workOrderId]);
    await event(tq, workOrderId, me, `Booked ${who} for ${fmt(start, tz)}`);
    return row;
  });
  if (w.desk_ticket) await noteTicket(workOrderId, w.desk_ticket, `Field service ${w.number}: a technician is booked for ${fmt(start, tz)}.`);
  return toBooking(r);
}

async function bookingRow(id: string) {
  if (!uuidish(id)) throw new UserError("That booking doesn't exist", 404);
  const [b] = await q("SELECT * FROM bookings WHERE id = $1", [id]);
  if (!b) throw new UserError("That booking doesn't exist", 404);
  return b;
}

/** Moves a booking that hasn't started, to another time or technician. */
export async function moveBooking(me: string, id: string, b: Record<string, unknown>): Promise<Booking> {
  await requireDispatcher(me);
  const cur = await bookingRow(id);
  if (cur.status !== "scheduled") throw new UserError("This visit has started, so it can't be moved", 409);
  await assertOpen(cur.work_order_id as string);
  const technician = b.technician === undefined ? (cur.technician as string) : await assertTechnician(String(b.technician));
  const { start, end } = range({ start: b.start ?? cur.starts_at, end: b.end ?? cur.ends_at });
  await refuseClash(technician, start, end, b.force, id);
  const tz = (await getSettings()).timeZone;
  const [r] = await q("UPDATE bookings SET technician = $2, starts_at = $3, ends_at = $4, modified_at = now() WHERE id = $1 RETURNING *", [id, technician, start, end]);
  await event(q, cur.work_order_id as string, me, `Moved the visit to ${await nameOf(technician)}, ${fmt(start, tz)}`);
  return toBooking(r);
}

export async function cancelBooking(me: string, id: string): Promise<void> {
  await requireDispatcher(me);
  const cur = await bookingRow(id);
  if (cur.status === "done" || cur.status === "cancelled") throw new UserError(`This visit is already ${cur.status}`, 409);
  if (cur.status === "on_site") throw new UserError("The technician is on site; they finish the visit from their phone", 409);
  const who = await nameOf(cur.technician as string);
  await tx(async (tq) => {
    await tq("UPDATE bookings SET status = 'cancelled', modified_at = now() WHERE id = $1", [id]);
    await tq(
      `UPDATE work_orders w SET status = 'new', modified_at = now() WHERE w.id = $1 AND w.status = 'scheduled'
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.work_order_id = w.id AND b.status IN ${ACTIVE})`,
      [cur.work_order_id],
    );
    await event(tq, cur.work_order_id as string, me, `Cancelled ${who}'s visit`);
  });
}

export type Step = "travel" | "arrive" | "finish";

/**
 * A technician moves their visit along: on the way, on site, done. Finishing records the time on
 * site as labor at the technician's rate. The job stays open until someone completes it, and waits
 * on hold if no other visit is booked.
 */
export async function step(me: string, id: string, s: Step): Promise<Booking> {
  const role = await requireStaff(me);
  const cur = await bookingRow(id);
  if (role !== "dispatcher" && cur.technician !== me.toLowerCase()) throw new UserError("That booking doesn't exist", 404);
  const woId = cur.work_order_id as string;
  await assertOpen(woId);
  const from: Record<Step, string[]> = { travel: ["scheduled"], arrive: ["scheduled", "traveling"], finish: ["on_site"] };
  if (!from[s].includes(cur.status as string)) {
    throw new UserError(s === "finish" ? "Arrive on site before finishing the visit" : `This visit is already ${String(cur.status).replace("_", " ")}`, 409);
  }
  const r = await tx(async (tq) => {
    if (s === "travel") {
      const [row] = await tq("UPDATE bookings SET status = 'traveling', travel_at = now(), modified_at = now() WHERE id = $1 RETURNING *", [id]);
      await event(tq, woId, me, "On the way");
      return row;
    }
    if (s === "arrive") {
      const [row] = await tq("UPDATE bookings SET status = 'on_site', arrived_at = now(), modified_at = now() WHERE id = $1 RETURNING *", [id]);
      await tq("UPDATE work_orders SET status = 'in_progress', modified_at = now() WHERE id = $1", [woId]);
      await event(tq, woId, me, "Arrived on site");
      return row;
    }
    const row = await finishVisit(tq, cur);
    const [left] = await tq<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE work_order_id = $1 AND status IN ${ACTIVE}`, [woId]);
    await tq("UPDATE work_orders SET status = $2, modified_at = now() WHERE id = $1", [woId, left.n ? "scheduled" : "on_hold"]);
    await event(tq, woId, me, left.n ? "Visit finished; another visit is booked" : "Visit finished; the job isn't complete yet");
    return row;
  });
  return toBooking(r);
}

/** Closes an on-site visit and records the time on site as labor. */
export async function finishVisit(tq: Tq, cur: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [row] = await tq("UPDATE bookings SET status = 'done', finished_at = now(), modified_at = now() WHERE id = $1 RETURNING *", [cur.id]);
  const arrived = new Date((cur.arrived_at as string) ?? (row.finished_at as string));
  const mins = Math.min(1440, Math.max(1, Math.round((new Date(row.finished_at as string).getTime() - arrived.getTime()) / 60_000)));
  const tz = (await getSettings()).timeZone;
  await tq("INSERT INTO labor (work_order_id, booking_id, technician, day, minutes, rate_cents) VALUES ($1, $2, $3, $4, $5, $6)", [
    cur.work_order_id, cur.id, cur.technician, zonedDay(arrived, tz), mins, await rateFor(cur.technician as string),
  ]);
  return row;
}

export type BoardBooking = Booking & { number: string; title: string; customerName: string; address: string; priority: string; woStatus: string };

export type Board = { technicians: Staff[]; bookings: BoardBooking[]; unscheduled: WorkOrder[]; timeZone: string };

/** The dispatch board: every technician's bookings between two instants, and the jobs waiting for one. */
export async function board(me: string, fromV: unknown, toV: unknown): Promise<Board> {
  await requireDispatcher(me);
  const from = when(fromV, "From");
  const to = when(toV, "To");
  if (to <= from || to.getTime() - from.getTime() > 31 * 86_400_000) throw new UserError("Show up to a month at a time");
  const [techs, rows, waiting, settings] = await Promise.all([
    technicians(),
    q(
      `SELECT b.*, w.number, w.title, c.name AS customer_name, w.address, w.priority, w.status AS wo_status
       FROM bookings b JOIN work_orders w ON w.id = b.work_order_id JOIN customers c ON c.id = w.customer_id
       WHERE b.status <> 'cancelled' AND b.starts_at < $2 AND b.ends_at > $1 AND w.held_deleted_at IS NULL ORDER BY b.starts_at`,
      [from, to],
    ),
    q(
      `SELECT ${WO_COLS} FROM ${WO_FROM}
       WHERE w.held_deleted_at IS NULL AND w.status IN ('new', 'on_hold')
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.work_order_id = w.id AND b.status IN ${ACTIVE})
       ORDER BY CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, w.due_day NULLS LAST, w.created_at
       LIMIT 300`,
    ),
    getSettings(),
  ]);
  return {
    technicians: techs,
    bookings: rows.map((r) => ({
      ...toBooking(r), number: r.number as string, title: r.title as string, customerName: r.customer_name as string,
      address: r.address as string, priority: r.priority as string, woStatus: r.wo_status as string,
    })),
    unscheduled: waiting.map(toWorkOrder),
    timeZone: settings.timeZone,
  };
}

/** A technician's own visits between two instants, with the jobs they're for. */
export async function myVisits(me: string, fromV: unknown, toV: unknown): Promise<{ visits: (BoardBooking & { contactName: string; contactPhone: string })[]; timeZone: string }> {
  await requireStaff(me);
  const from = when(fromV, "From");
  const to = when(toV, "To");
  if (to <= from || to.getTime() - from.getTime() > 31 * 86_400_000) throw new UserError("Show up to a month at a time");
  const rows = await q(
    `SELECT b.*, w.number, w.title, c.name AS customer_name, w.address, w.priority, w.status AS wo_status, w.contact_name, w.contact_phone
     FROM bookings b JOIN work_orders w ON w.id = b.work_order_id JOIN customers c ON c.id = w.customer_id
     WHERE b.technician = $1 AND b.status <> 'cancelled' AND w.held_deleted_at IS NULL
       AND ((b.starts_at < $3 AND b.ends_at > $2) OR b.status IN ('traveling', 'on_site'))
     ORDER BY b.starts_at`,
    [me.toLowerCase(), from, to],
  );
  return {
    visits: rows.map((r) => ({
      ...toBooking(r), number: r.number as string, title: r.title as string, customerName: r.customer_name as string, address: r.address as string,
      priority: r.priority as string, woStatus: r.wo_status as string, contactName: r.contact_name as string, contactPhone: r.contact_phone as string,
    })),
    timeZone: (await getSettings()).timeZone,
  };
}

export type Suggestion = { technician: string; name: string; skillMatch: boolean; start: string; end: string; bookedMinutes: number };

const DAY_START = 8;
const DAY_END = 17;

/**
 * Who could take a job soonest: for each technician, the first gap in their working day (8:00 to
 * 17:00 on weekdays in the install's time zone, from `day` for up to a week) long enough for the
 * job's estimate. Technicians with the job's skill come first, then the earliest slot, then the
 * lightest day.
 */
export async function suggest(me: string, workOrderId: string, dayV?: unknown, now = new Date()): Promise<Suggestion[]> {
  await requireDispatcher(me);
  await access(me, workOrderId);
  const [w] = await q<{ skill: string; estimate_minutes: number }>("SELECT skill, estimate_minutes FROM work_orders WHERE id = $1", [workOrderId]);
  const { timeZone: tz } = await getSettings();
  const first = typeof dayV === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayV) ? dayV : zonedDay(now, tz);
  const need = Math.min(w.estimate_minutes, (DAY_END - DAY_START) * 60) * 60_000;
  const techs = await technicians();
  const windowStart = zonedTime(first, 0, tz);
  const windowEnd = zonedTime(addDays(first, 9), 0, tz);
  const busy = await q<{ technician: string; starts_at: Date; ends_at: Date }>(
    "SELECT technician, starts_at, ends_at FROM bookings WHERE status <> 'cancelled' AND starts_at < $2 AND ends_at > $1 ORDER BY starts_at",
    [windowStart, windowEnd],
  );
  const out: Suggestion[] = [];
  for (const t of techs) {
    const mine = busy.filter((b) => b.technician === t.email).map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()] as const);
    for (let i = 0; i < 8; i++) {
      const day = addDays(first, i);
      if (weekend(day)) continue;
      const open = Math.max(zonedTime(day, DAY_START, tz).getTime(), Math.ceil(now.getTime() / 900_000) * 900_000);
      const close = zonedTime(day, DAY_END, tz).getTime();
      let at = open;
      for (const [s, e] of mine) {
        if (e <= at || s >= close) continue;
        if (s - at >= need) break;
        at = Math.max(at, e);
      }
      if (at + need <= close) {
        const dayStart = zonedTime(day, 0, tz).getTime();
        const dayEnd = zonedTime(addDays(day, 1), 0, tz).getTime();
        const booked = mine.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, dayEnd) - Math.max(s, dayStart)), 0);
        out.push({
          technician: t.email, name: t.name, skillMatch: !w.skill || t.skills.includes(w.skill),
          start: new Date(at).toISOString(), end: new Date(at + need).toISOString(), bookedMinutes: Math.round(booked / 60_000),
        });
        break;
      }
    }
  }
  out.sort((a, b) => Number(b.skillMatch) - Number(a.skillMatch) || a.start.localeCompare(b.start) || a.bookedMinutes - b.bookedMinutes);
  return out;
}

const MAX_SIGNATURE = 300_000;

/**
 * Finishes the job: the resolution is recorded with who signed it off on site, any visit still
 * running is closed (its time recorded) and visits still to come are cancelled. The Desk case, if
 * there is one, gets a note with the resolution.
 */
export async function complete(me: string, id: string, b: Record<string, unknown>): Promise<void> {
  await access(me, id);
  const w = await assertOpen(id);
  const resolution = text(b.resolution, 8000);
  if (!resolution) throw new UserError("Say what was done");
  let signature: string | null = null;
  if (b.signature) {
    signature = String(b.signature);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > MAX_SIGNATURE) throw new UserError("The signature didn't come through; clear it and sign again");
  }
  const signedBy = text(b.signedBy, 200);
  if (signature && !signedBy) throw new UserError("Type the name of the person who signed");
  await tx(async (tq) => {
    const running = await tq("SELECT * FROM bookings WHERE work_order_id = $1 AND status = 'on_site' FOR UPDATE", [id]);
    for (const r of running) await finishVisit(tq, r);
    await tq("UPDATE bookings SET status = 'cancelled', modified_at = now() WHERE work_order_id = $1 AND status IN ('scheduled', 'traveling')", [id]);
    await tq(
      `UPDATE work_orders SET status = 'completed', resolution = $2, signed_by = $3, signature = $4, completed_at = now(), completed_by = $5, modified_at = now()
       WHERE id = $1`,
      [id, resolution, signedBy, signature, me],
    );
    await event(tq, id, me, signedBy ? `Completed, signed off by ${signedBy}` : "Completed");
  });
  if (w.desk_ticket) await noteTicket(id, w.desk_ticket, `Field service ${w.number} is complete.\n\n${resolution}`);
}
