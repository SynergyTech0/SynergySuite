import { randomBytes } from "node:crypto";
import type { Me } from "./api";
import { q, tx, type Tq } from "./db";
import { notify } from "./notify";
import { type Page, type Service, type Staff, isUuid, pageById, pageBySlug, pageFor, roleOn, staffFor } from "./pages";
import { calendarBusy, meetRoom, meetUrl, moveCalendarEvent, removeCalendarEvent, addCalendarEvent, publicBase, rememberCustomer } from "./suite";
import { type Interval, DAY_MS, addDays, dayIn, freeStarts, isDay, overlaps, zonedTime } from "./time";
import { UserError, cleanEmail, text } from "./util";

export type Status = "confirmed" | "cancelled";

export type Appointment = {
  id: string; pageId: string; pageName: string; serviceId: string | null; serviceName: string;
  staffEmail: string; staffName: string; customerName: string; customerEmail: string; customerPhone: string;
  notes: string; answers: { label: string; answer: string }[]; start: string; end: string; location: string;
  joinUrl: string | null; status: Status; bookedBy: string | null; createdAt: string;
  cancelledAt: string | null; cancelledBy: string | null; cancelReason: string;
};

export type Row = {
  id: string; page_id: string; page_name: string; service_id: string | null; service_name: string; staff_email: string;
  staff_name: string; customer_name: string; customer_email: string; customer_phone: string; notes: string;
  answers: { label: string; answer: string }[]; start_at: Date; end_at: Date; block_start: Date; block_end: Date;
  location: string; meet_room: string | null; status: Status; token: string; sequence: number; calendar_event_id: string | null;
  reminders_sent: number[]; booked_by: string | null; created_at: Date; cancelled_at: Date | null; cancelled_by: string | null;
  cancel_reason: string;
};

export function toAppointment(r: Row): Appointment {
  return {
    id: r.id, pageId: r.page_id, pageName: r.page_name, serviceId: r.service_id, serviceName: r.service_name,
    staffEmail: r.staff_email, staffName: r.staff_name, customerName: r.customer_name, customerEmail: r.customer_email,
    customerPhone: r.customer_phone, notes: r.notes, answers: r.answers, start: r.start_at.toISOString(), end: r.end_at.toISOString(),
    location: r.location, joinUrl: r.meet_room ? meetUrl(r.meet_room) : null, status: r.status, bookedBy: r.booked_by,
    createdAt: r.created_at.toISOString(), cancelledAt: r.cancelled_at?.toISOString() ?? null, cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
  };
}

export const SELECT = `SELECT a.*, p.name AS page_name FROM appointments a JOIN pages p ON p.id = a.page_id`;

const MIN = 60_000;

export function manageUrl(token: string): string {
  return `${publicBase()}/booking/${token}`;
}

// ---------- availability ----------

/** Everything holding someone's time: their appointments here (with buffers) and their suite calendar. */
async function busyFor(email: string, from: number, to: number, skip?: Row): Promise<Interval[]> {
  const own = await q<{ block_start: Date; block_end: Date }>(
    `SELECT block_start, block_end FROM appointments
     WHERE staff_email = $1 AND status = 'confirmed' AND block_start < $3 AND block_end > $2 AND ($4::uuid IS NULL OR id <> $4)
       AND page_id IN (SELECT id FROM pages WHERE held_deleted_at IS NULL)`,
    [email, new Date(from), new Date(to), skip?.id ?? null],
  );
  const busy = own.map((r) => ({ start: r.block_start.getTime(), end: r.block_end.getTime() }));
  for (const b of await calendarBusy(email, from, to)) {
    // The appointment being moved is on their calendar too; it mustn't block itself.
    if (skip && skip.staff_email === email && b.start === skip.start_at.getTime() && b.end === skip.end_at.getTime()) continue;
    busy.push(b);
  }
  return busy;
}

export type Slot = { start: string; staffIds: string[] };

/** Free times for a service between two days in the page's time zone, with who can take each. */
export async function availability(
  page: Page, service: Service, fromDay: string, toDay: string,
  opts: { staffId?: string | null; now?: number; skip?: Row } = {},
): Promise<Slot[]> {
  if (!isDay(fromDay) || !isDay(toDay) || toDay < fromDay) throw new UserError("Pick a valid range of days");
  if (addDays(fromDay, 62) < toDay) throw new UserError("Ask for at most two months at a time");
  const now = opts.now ?? Date.now();
  let people = staffFor(page, service);
  if (opts.staffId) people = people.filter((s) => s.id === opts.staffId);
  const from = zonedTime(fromDay, 0, page.timeZone) - DAY_MS;
  const to = zonedTime(addDays(toDay, 1), 0, page.timeZone) + DAY_MS;
  const rules = {
    tz: page.timeZone, durationMin: service.durationMin, bufferBeforeMin: service.bufferBeforeMin, bufferAfterMin: service.bufferAfterMin,
    stepMin: page.stepMin, minNoticeMin: page.minNoticeMin, maxDaysAhead: page.maxDaysAhead,
  };
  const byStart = new Map<number, string[]>();
  await Promise.all(people.map(async (s) => {
    const busy = await busyFor(s.email, from, to, opts.skip);
    for (const t of freeStarts(s.hours ?? page.hours, busy, rules, fromDay, toDay, now)) {
      const list = byStart.get(t) ?? [];
      list.push(s.id);
      byStart.set(t, list);
    }
  }));
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([t, ids]) => ({ start: new Date(t).toISOString(), staffIds: ids }));
}

// ---------- booking ----------

export type CustomerInput = { name?: unknown; email?: unknown; phone?: unknown; notes?: unknown; answers?: unknown };

function customer(service: Service | null, b: CustomerInput) {
  const name = text(b.name, 200);
  if (!name) throw new UserError("Enter your name");
  const email = cleanEmail(b.email);
  const given = (b.answers && typeof b.answers === "object" ? b.answers : {}) as Record<string, unknown>;
  const answers = (service?.questions ?? []).map((qn) => {
    const answer = text(given[qn.id], 2000);
    if (qn.required && !answer) throw new UserError(`Answer "${qn.label}"`);
    return { label: qn.label, answer };
  }).filter((a) => a.answer);
  return { name, email, phone: text(b.phone, 50), notes: text(b.notes, 4000), answers };
}

function locationFor(page: Page, service: Service, room: string | null): string {
  if (room) return meetUrl(room);
  if (service.locationKind === "in_person") return service.location || page.address;
  if (service.locationKind === "phone") return service.location || "Phone call";
  return service.location;
}

/** Holds a staff member's day while one booking is checked and written, so two can't both land. */
async function lockStaff(tq: Tq, email: string): Promise<void> {
  await tq(`SELECT pg_advisory_xact_lock(hashtext('bookings:' || $1))`, [email]);
}

async function clashes(tq: Tq, email: string, block: Interval, skipId: string | null): Promise<boolean> {
  const rows = await tq(
    `SELECT 1 FROM appointments WHERE staff_email = $1 AND status = 'confirmed' AND block_start < $3 AND block_end > $2
       AND ($4::uuid IS NULL OR id <> $4) AND page_id IN (SELECT id FROM pages WHERE held_deleted_at IS NULL) LIMIT 1`,
    [email, new Date(block.start), new Date(block.end), skipId],
  );
  return rows.length > 0;
}

async function insert(page: Page, service: Service, staff: Staff, start: number, c: ReturnType<typeof customer>, bookedBy: string | null): Promise<Row | null> {
  const end = start + service.durationMin * MIN;
  const block = { start: start - service.bufferBeforeMin * MIN, end: end + service.bufferAfterMin * MIN };
  const room = service.locationKind === "meet" ? meetRoom() : null;
  return tx(async (tq) => {
    await lockStaff(tq, staff.email);
    if (await clashes(tq, staff.email, block, null)) return null;
    const [r] = await tq<Row>(
      `INSERT INTO appointments (page_id, service_id, service_name, staff_email, staff_name, customer_name, customer_email, customer_phone,
         notes, answers, start_at, end_at, block_start, block_end, location, meet_room, token, booked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [page.id, service.id, service.name, staff.email, staff.name, c.name, c.email, c.phone, c.notes, JSON.stringify(c.answers),
        new Date(start), new Date(end), new Date(block.start), new Date(block.end), locationFor(page, service, room), room,
        randomBytes(24).toString("base64url"), bookedBy],
    );
    return { ...r, page_name: page.name };
  });
}

/** After an appointment is written: the calendar event, the customer in Contacts, the emails. */
async function afterBooking(page: Page, r: Row): Promise<void> {
  const [eventId] = await Promise.all([
    addCalendarEvent({
      ownerEmail: r.staff_email,
      title: `${r.service_name}: ${r.customer_name}`,
      description: calendarText(r),
      location: r.location,
      startAt: r.start_at.toISOString(),
      endAt: r.end_at.toISOString(),
      attendees: [r.customer_email],
    }),
    rememberCustomer(r.staff_email, { name: r.customer_name, email: r.customer_email, phone: r.customer_phone }),
    notify(page, r, "booked"),
  ]);
  if (eventId) {
    await q(`UPDATE appointments SET calendar_event_id = $2 WHERE id = $1`, [r.id, eventId]);
    r.calendar_event_id = eventId;
  }
}

function calendarText(r: Row): string {
  return [
    `Booked through ${r.page_name}.`,
    `Customer: ${r.customer_name} <${r.customer_email}>${r.customer_phone ? `, ${r.customer_phone}` : ""}`,
    r.meet_room ? `Join: ${meetUrl(r.meet_room)}` : r.location ? `Where: ${r.location}` : "",
    r.notes ? `Notes: ${r.notes}` : "",
    ...r.answers.map((a) => `${a.label}: ${a.answer}`),
    `Manage: ${publicBase()}/?appointment=${r.id}`,
  ].filter(Boolean).join("\n");
}

export type BookInput = CustomerInput & { serviceId?: unknown; staffId?: unknown; start?: unknown };

function startOf(v: unknown): number {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) throw new UserError("Pick a time");
  return t;
}

/** How many appointments each person has that day, so "anyone" spreads the work. */
async function loads(emails: string[], day: number): Promise<Map<string, number>> {
  const rows = await q<{ staff_email: string; n: string }>(
    `SELECT staff_email, count(*) AS n FROM appointments WHERE staff_email = ANY($1) AND status = 'confirmed'
       AND start_at >= $2 AND start_at < $3 GROUP BY staff_email`,
    [emails, new Date(day - DAY_MS / 2), new Date(day + DAY_MS * 1.5)],
  );
  return new Map(rows.map((r) => [r.staff_email, Number(r.n)]));
}

/** A customer books from the public page: the time must still be free under the page's rules. */
export async function bookPublic(pageSlug: string, b: BookInput, now = Date.now()): Promise<{ token: string; appointment: Row }> {
  const page = await pageBySlug(pageSlug);
  if (!page || !page.published) throw new UserError("Booking page not found", 404);
  const service = page.services.find((s) => s.id === b.serviceId && s.active);
  if (!service) throw new UserError("That service isn't offered any more", 404);
  const c = customer(service, b);
  const start = startOf(b.start);
  const staffId = page.chooseStaff && isUuid(b.staffId) ? b.staffId : null;
  const day = dayIn(start, page.timeZone);
  const slot = (await availability(page, service, day, day, { staffId, now })).find((s) => Date.parse(s.start) === start);
  if (!slot) throw new UserError("That time has just been taken. Please pick another.", 409);
  const people = page.staff.filter((s) => slot.staffIds.includes(s.id));
  const load = await loads(people.map((p) => p.email), start);
  people.sort((x, y) => (load.get(x.email) ?? 0) - (load.get(y.email) ?? 0));
  for (const s of people) {
    const r = await insert(page, service, s, start, c, null);
    if (r) {
      await afterBooking(page, r);
      return { token: r.token, appointment: r };
    }
  }
  throw new UserError("That time has just been taken. Please pick another.", 409);
}

/**
 * Staff book for a customer (on the phone, at the desk). Outside opening hours is fine; a clash
 * with the staff member's other appointments or calendar is not.
 */
export async function bookForCustomer(me: Me, b: BookInput & { pageId?: unknown; staffEmail?: unknown }): Promise<Appointment> {
  const page = await pageFor(me, String(b.pageId ?? ""));
  const service = page.services.find((s) => s.id === b.serviceId);
  if (!service) throw new UserError("Pick a service");
  const c = customer(null, b);
  const start = startOf(b.start);
  const email = b.staffEmail ? String(b.staffEmail).toLowerCase() : me.email;
  const staff = staffFor(page, service).find((s) => s.email === email);
  if (!staff) throw new UserError(`${email} doesn't offer ${service.name}`);
  const end = start + service.durationMin * MIN;
  const block = { start: start - service.bufferBeforeMin * MIN, end: end + service.bufferAfterMin * MIN };
  if ((await calendarBusy(staff.email, block.start, block.end)).some((x) => overlaps(x, block))) {
    throw new UserError(`${staff.name} is busy then`, 409);
  }
  const r = await insert(page, service, staff, start, c, me.email);
  if (!r) throw new UserError(`${staff.name} already has an appointment then`, 409);
  await afterBooking(page, r);
  return toAppointment(r);
}

// ---------- changing ----------

async function rowById(id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  return (await q<Row>(`${SELECT} WHERE a.id = $1 AND p.held_deleted_at IS NULL`, [id]))[0] ?? null;
}

export async function rowByToken(token: string): Promise<Row | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return (await q<Row>(`${SELECT} WHERE a.token = $1 AND p.held_deleted_at IS NULL`, [token]))[0] ?? null;
}

/** An appointment on a page the person is on. */
async function staffRow(me: Me, id: string): Promise<[Page, Row]> {
  const r = await rowById(id);
  const page = r && (await pageById(r.page_id));
  if (!r || !page || !roleOn(page, me.email)) throw new UserError("Appointment not found", 404);
  return [page, r];
}

async function cancel(page: Page, r: Row, by: string, reason: unknown): Promise<Row> {
  if (r.status === "cancelled") throw new UserError("This appointment is already cancelled");
  const [u] = await q<Row>(
    `UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, sequence = sequence + 1,
       modified_at = now() WHERE id = $1 AND status = 'confirmed' RETURNING *`,
    [r.id, by, text(reason, 1000)],
  );
  if (!u) throw new UserError("This appointment is already cancelled");
  const out = { ...u, page_name: r.page_name };
  if (r.calendar_event_id) await removeCalendarEvent(r.calendar_event_id, r.staff_email);
  await notify(page, out, "cancelled");
  return out;
}

async function move(page: Page, r: Row, start: number, check: "rules" | "clash", now: number): Promise<Row> {
  if (r.status !== "confirmed") throw new UserError("This appointment was cancelled");
  const service = page.services.find((s) => s.id === r.service_id);
  const durationMin = Math.round((r.end_at.getTime() - r.start_at.getTime()) / MIN);
  const before = Math.round((r.start_at.getTime() - r.block_start.getTime()) / MIN);
  const after = Math.round((r.block_end.getTime() - r.end_at.getTime()) / MIN);
  const end = start + durationMin * MIN;
  const block = { start: start - before * MIN, end: end + after * MIN };
  if (check === "rules") {
    const staff = page.staff.find((s) => s.email === r.staff_email);
    if (!service || !service.active || !staff) throw new UserError("This appointment can't be moved online. Please contact us.", 409);
    const day = dayIn(start, page.timeZone);
    const free = await availability(page, service, day, day, { staffId: staff.id, now, skip: r });
    if (!free.some((s) => Date.parse(s.start) === start)) throw new UserError("That time isn't free. Please pick another.", 409);
  } else if ((await calendarBusy(r.staff_email, block.start, block.end)).some((x) =>
    overlaps(x, block) && !(x.start === r.start_at.getTime() && x.end === r.end_at.getTime()))) {
    throw new UserError(`${r.staff_name || r.staff_email} is busy then`, 409);
  }
  const u = await tx(async (tq) => {
    await lockStaff(tq, r.staff_email);
    if (await clashes(tq, r.staff_email, block, r.id)) return null;
    const [x] = await tq<Row>(
      `UPDATE appointments SET start_at = $2, end_at = $3, block_start = $4, block_end = $5, sequence = sequence + 1,
         reminders_sent = '{}', modified_at = now() WHERE id = $1 AND status = 'confirmed' RETURNING *`,
      [r.id, new Date(start), new Date(end), new Date(block.start), new Date(block.end)],
    );
    return x ?? null;
  });
  if (!u) throw new UserError("That time isn't free. Please pick another.", 409);
  const out = { ...u, page_name: r.page_name };
  if (r.calendar_event_id) await moveCalendarEvent(r.calendar_event_id, r.staff_email, out.start_at.toISOString(), out.end_at.toISOString());
  await notify(page, out, "moved");
  return out;
}

export async function cancelByStaff(me: Me, id: string, reason: unknown): Promise<Appointment> {
  const [page, r] = await staffRow(me, id);
  return toAppointment(await cancel(page, r, me.email, reason));
}

export async function moveByStaff(me: Me, id: string, start: unknown): Promise<Appointment> {
  const [page, r] = await staffRow(me, id);
  return toAppointment(await move(page, r, startOf(start), "clash", Date.now()));
}

/** Customers may change or cancel up to the page's notice period before the start. */
function customerMayChange(page: Page, r: Row, now: number): boolean {
  return r.status === "confirmed" && r.start_at.getTime() - now >= page.minNoticeMin * MIN;
}

export async function cancelByCustomer(token: string, reason: unknown, now = Date.now()): Promise<void> {
  const r = await rowByToken(token);
  const page = r && (await pageById(r.page_id));
  if (!r || !page) throw new UserError("Booking not found", 404);
  if (!customerMayChange(page, r, now)) throw new UserError("It's too late to cancel online. Please contact us.", 409);
  await cancel(page, r, r.customer_email, reason);
}

export async function moveByCustomer(token: string, start: unknown, now = Date.now()): Promise<void> {
  const r = await rowByToken(token);
  const page = r && (await pageById(r.page_id));
  if (!r || !page) throw new UserError("Booking not found", 404);
  if (!customerMayChange(page, r, now)) throw new UserError("It's too late to change this online. Please contact us.", 409);
  await move(page, r, startOf(start), "rules", now);
}

/** What the customer's manage page shows. */
export async function forCustomer(token: string, now = Date.now()) {
  const r = await rowByToken(token);
  const page = r && (await pageById(r.page_id));
  if (!r || !page) return null;
  return {
    page: { slug: page.slug, name: page.name, timeZone: page.timeZone, phone: page.phone, color: page.color },
    serviceId: page.services.some((s) => s.id === r.service_id && s.active) ? r.service_id : null,
    serviceName: r.service_name, staffName: r.staff_name, customerName: r.customer_name, customerEmail: r.customer_email,
    start: r.start_at.toISOString(), end: r.end_at.toISOString(), location: r.location,
    joinUrl: r.meet_room ? meetUrl(r.meet_room) : null, status: r.status,
    canChange: customerMayChange(page, r, now),
  };
}
export type CustomerView = NonNullable<Awaited<ReturnType<typeof forCustomer>>>;

/** Free times for the customer moving their own appointment: same person, same service. */
export async function slotsForMove(token: string, fromDay: string, toDay: string): Promise<Slot[]> {
  const r = await rowByToken(token);
  const page = r && (await pageById(r.page_id));
  const service = page?.services.find((s) => s.id === r?.service_id && s.active);
  const staff = page?.staff.find((s) => s.email === r?.staff_email);
  if (!r || !page || !service || !staff) return [];
  return availability(page, service, fromDay, toDay, { staffId: staff.id, skip: r });
}

// ---------- lists ----------

export type ListOpts = { pageId?: string | null; from?: string | null; to?: string | null; mine?: boolean; status?: string | null; q?: string | null };

/** Appointments on the person's pages, soonest first. */
export async function list(me: Me, o: ListOpts = {}): Promise<Appointment[]> {
  const params: unknown[] = [me.email];
  const where = [`p.held_deleted_at IS NULL`, `EXISTS (SELECT 1 FROM staff s WHERE s.page_id = a.page_id AND s.email = $1)`];
  if (o.pageId) {
    if (!isUuid(o.pageId)) return [];
    params.push(o.pageId);
    where.push(`a.page_id = $${params.length}`);
  }
  if (o.from) {
    params.push(new Date(o.from));
    where.push(`a.end_at > $${params.length}`);
  }
  if (o.to) {
    params.push(new Date(o.to));
    where.push(`a.start_at < $${params.length}`);
  }
  if (o.mine) where.push(`a.staff_email = $1`);
  if (o.status === "confirmed" || o.status === "cancelled") {
    params.push(o.status);
    where.push(`a.status = $${params.length}`);
  }
  if (o.q?.trim()) {
    params.push(`%${o.q.trim().toLowerCase().replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    where.push(`lower(a.customer_name || ' ' || a.customer_email || ' ' || a.service_name || ' ' || a.notes) LIKE $${params.length}`);
  }
  for (const v of params.slice(1)) if (v instanceof Date && Number.isNaN(v.getTime())) throw new UserError("Bad date");
  const rows = await q<Row>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY a.start_at, a.id LIMIT 2000`, params);
  return rows.map(toAppointment);
}

export async function getForStaff(me: Me, id: string): Promise<Appointment> {
  return toAppointment((await staffRow(me, id))[1]);
}

export type Customer = { email: string; name: string; phone: string; visits: number; upcoming: number; last: string };

/** Everyone who has booked on a page, most recent first. */
export async function customers(me: Me, pageId: string): Promise<Customer[]> {
  await pageFor(me, pageId);
  const rows = await q<{ email: string; name: string; phone: string; visits: string; upcoming: string; last: Date }>(
    `SELECT customer_email AS email,
       (array_agg(customer_name ORDER BY created_at DESC))[1] AS name,
       (array_agg(customer_phone ORDER BY created_at DESC) FILTER (WHERE customer_phone <> ''))[1] AS phone,
       count(*) FILTER (WHERE status = 'confirmed' AND start_at <= now()) AS visits,
       count(*) FILTER (WHERE status = 'confirmed' AND start_at > now()) AS upcoming,
       max(start_at) AS last
     FROM appointments WHERE page_id = $1 GROUP BY customer_email ORDER BY max(start_at) DESC LIMIT 5000`,
    [pageId],
  );
  return rows.map((r) => ({ email: r.email, name: r.name, phone: r.phone ?? "", visits: Number(r.visits), upcoming: Number(r.upcoming), last: r.last.toISOString() }));
}

// ---------- reminders ----------

/**
 * Sends each reminder a service asks for (say 24 hours before) once. Several replicas may run
 * this: a row is claimed and marked in one statement before anything is sent. A reminder whose
 * time had already passed when the appointment was booked is skipped; the confirmation covers it.
 */
export async function sendDueReminders(now = Date.now()): Promise<number> {
  const due = await q<Row & { hours: number }>(
    `WITH due AS (
       SELECT a.id, h.hours FROM appointments a
       JOIN pages p ON p.id = a.page_id AND p.held_deleted_at IS NULL
       JOIN services s ON s.id = a.service_id
       CROSS JOIN LATERAL unnest(s.reminder_hours) AS h(hours)
       WHERE a.status = 'confirmed' AND a.start_at > $1 AND a.start_at - make_interval(hours => h.hours) <= $1
         AND NOT (h.hours = ANY(a.reminders_sent))
       ORDER BY a.start_at LIMIT 200
       FOR UPDATE OF a SKIP LOCKED
     ), claimed AS (
       UPDATE appointments a SET reminders_sent = a.reminders_sent || ARRAY(SELECT d.hours FROM due d WHERE d.id = a.id)
       FROM (SELECT DISTINCT id FROM due) x WHERE a.id = x.id
       RETURNING a.*
     )
     SELECT c.*, p.name AS page_name, (SELECT min(d.hours) FROM due d WHERE d.id = c.id) AS hours
     FROM claimed c JOIN pages p ON p.id = c.page_id`,
    [new Date(now)],
  );
  let sent = 0;
  for (const r of due) {
    // Booked after this reminder's moment: the confirmation was the reminder.
    if (r.created_at.getTime() > r.start_at.getTime() - r.hours * 3_600_000) continue;
    const page = await pageById(r.page_id);
    if (page && (await notify(page, r, "reminder"))) sent++;
  }
  return sent;
}

export { addDays, dayIn, isDay };
