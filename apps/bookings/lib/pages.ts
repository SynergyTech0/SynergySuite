import type { Me } from "./api";
import { q, tx } from "./db";
import { removeCalendarEvent } from "./suite";
import { type WeekHours, cleanHours, defaultHours, isTimeZone } from "./time";
import { UserError, cleanEmail, isEmail, text } from "./util";

export type Role = "admin" | "staff";
export type Staff = { id: string; email: string; name: string; role: Role; hours: WeekHours | null };
export type Question = { id: string; label: string; required: boolean };
export type LocationKind = "meet" | "in_person" | "phone" | "custom";

export type Service = {
  id: string; pageId: string; slug: string; name: string; description: string;
  durationMin: number; bufferBeforeMin: number; bufferAfterMin: number;
  locationKind: LocationKind; location: string; price: string;
  staffIds: string[]; questions: Question[]; reminderHours: number[]; active: boolean; position: number;
};

export type Page = {
  id: string; slug: string; name: string; description: string; timeZone: string; hours: WeekHours;
  minNoticeMin: number; maxDaysAhead: number; stepMin: number; published: boolean; chooseStaff: boolean;
  senderEmail: string | null; phone: string; address: string; color: string; createdBy: string;
  staff: Staff[]; services: Service[];
};

export const COLORS = ["blue", "green", "red", "orange", "purple", "teal", "pink", "gray"];
const LOCATION_KINDS: LocationKind[] = ["meet", "in_person", "phone", "custom"];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** "Contoso Hair Salon!" -> "contoso-hair-salon". */
export function slugify(v: string): string {
  return v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
}

function cleanSlug(v: unknown, fallback: string): string {
  const s = v === undefined || v === null || v === "" ? slugify(fallback) : String(v).trim().toLowerCase();
  if (!SLUG.test(s)) throw new UserError("Web addresses use lower-case letters, numbers and dashes");
  return s;
}

function int(v: unknown, min: number, max: number, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export function displayName(email: string): string {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type PageRow = {
  id: string; slug: string; name: string; description: string; time_zone: string; hours: WeekHours;
  min_notice_min: number; max_days_ahead: number; step_min: number; published: boolean; choose_staff: boolean;
  sender_email: string | null; phone: string; address: string; color: string; created_by: string;
};
type StaffRow = { id: string; page_id: string; email: string; name: string; role: Role; hours: WeekHours | null };
type ServiceRow = {
  id: string; page_id: string; slug: string; name: string; description: string; duration_min: number;
  buffer_before_min: number; buffer_after_min: number; location_kind: LocationKind; location: string; price: string;
  staff_ids: string[]; questions: Question[]; reminder_hours: number[]; active: boolean; position: number;
};

function toService(r: ServiceRow): Service {
  return {
    id: r.id, pageId: r.page_id, slug: r.slug, name: r.name, description: r.description, durationMin: r.duration_min,
    bufferBeforeMin: r.buffer_before_min, bufferAfterMin: r.buffer_after_min, locationKind: r.location_kind,
    location: r.location, price: r.price, staffIds: r.staff_ids, questions: r.questions, reminderHours: r.reminder_hours,
    active: r.active, position: r.position,
  };
}

async function assemble(rows: PageRow[]): Promise<Page[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const staff = await q<StaffRow>(`SELECT * FROM staff WHERE page_id = ANY($1::uuid[]) ORDER BY role, added_at, email`, [ids]);
  const services = await q<ServiceRow>(`SELECT * FROM services WHERE page_id = ANY($1::uuid[]) ORDER BY position, created_at`, [ids]);
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description, timeZone: r.time_zone, hours: r.hours,
    minNoticeMin: r.min_notice_min, maxDaysAhead: r.max_days_ahead, stepMin: r.step_min, published: r.published,
    chooseStaff: r.choose_staff, senderEmail: r.sender_email, phone: r.phone, address: r.address, color: r.color,
    createdBy: r.created_by,
    staff: staff.filter((s) => s.page_id === r.id).map(({ id, email, name, role, hours }) => ({ id, email, name: name || displayName(email), role, hours })),
    services: services.filter((s) => s.page_id === r.id).map(toService),
  }));
}

/** Pages the person is on, as admin or staff. */
export async function myPages(me: Me): Promise<Page[]> {
  const rows = await q<PageRow>(
    `SELECT p.* FROM pages p WHERE p.held_deleted_at IS NULL AND EXISTS (SELECT 1 FROM staff s WHERE s.page_id = p.id AND s.email = $1)
     ORDER BY p.name, p.created_at`,
    [me.email],
  );
  return assemble(rows);
}

export async function pageById(id: string): Promise<Page | null> {
  if (!isUuid(id)) return null;
  return (await assemble(await q<PageRow>(`SELECT * FROM pages WHERE id = $1 AND held_deleted_at IS NULL`, [id])))[0] ?? null;
}

export async function pageBySlug(slug: string): Promise<Page | null> {
  return (await assemble(await q<PageRow>(`SELECT * FROM pages WHERE slug = $1 AND held_deleted_at IS NULL`, [String(slug).toLowerCase()])))[0] ?? null;
}

export function roleOn(page: Page, email: string): Role | null {
  return page.staff.find((s) => s.email === email)?.role ?? null;
}

/** A page the person is on; admins only when `admin` is set. Anyone else gets "not found". */
export async function pageFor(me: Me, id: string, admin = false): Promise<Page> {
  const page = await pageById(id);
  const role = page && roleOn(page, me.email);
  if (!page || !role) throw new UserError("Booking page not found", 404);
  if (admin && role !== "admin") throw new UserError("Only the page's admins can change it", 403);
  return page;
}

export type PageInput = Partial<{
  name: string; slug: string; description: string; timeZone: string; hours: unknown; minNoticeMin: number;
  maxDaysAhead: number; stepMin: number; published: boolean; chooseStaff: boolean; senderEmail: string | null;
  phone: string; address: string; color: string;
}>;

function pageFields(b: PageInput, cur?: Page) {
  const name = b.name !== undefined ? text(b.name, 120) : cur?.name ?? "";
  if (!name) throw new UserError("Give the booking page a name");
  const timeZone = b.timeZone !== undefined ? String(b.timeZone) : cur?.timeZone ?? "UTC";
  if (!isTimeZone(timeZone)) throw new UserError("Unknown time zone");
  const hours = b.hours !== undefined ? cleanHours(b.hours) : cur?.hours ?? defaultHours();
  if (!hours) throw new UserError("Opening hours need a start before their end, with no overlaps");
  const color = b.color !== undefined ? String(b.color) : cur?.color ?? "blue";
  if (!COLORS.includes(color)) throw new UserError("Unknown color");
  let senderEmail = cur?.senderEmail ?? null;
  if (b.senderEmail !== undefined) senderEmail = b.senderEmail ? cleanEmail(b.senderEmail) : null;
  return {
    name, timeZone, hours, color, senderEmail,
    slug: b.slug !== undefined ? cleanSlug(b.slug, name) : cur?.slug ?? cleanSlug(undefined, name),
    description: b.description !== undefined ? text(b.description, 4000) : cur?.description ?? "",
    minNoticeMin: b.minNoticeMin !== undefined ? int(b.minNoticeMin, 0, 60 * 24 * 30, "Notice") : cur?.minNoticeMin ?? 120,
    maxDaysAhead: b.maxDaysAhead !== undefined ? int(b.maxDaysAhead, 1, 365, "Days ahead") : cur?.maxDaysAhead ?? 60,
    stepMin: b.stepMin !== undefined ? int(b.stepMin, 5, 240, "Time slot interval") : cur?.stepMin ?? 30,
    published: b.published !== undefined ? Boolean(b.published) : cur?.published ?? false,
    chooseStaff: b.chooseStaff !== undefined ? Boolean(b.chooseStaff) : cur?.chooseStaff ?? true,
    phone: b.phone !== undefined ? text(b.phone, 50) : cur?.phone ?? "",
    address: b.address !== undefined ? text(b.address, 300) : cur?.address ?? "",
  };
}

async function freeSlug(base: string): Promise<string> {
  const taken = new Set((await q<{ slug: string }>(`SELECT slug FROM pages WHERE slug = $1 OR slug LIKE $1 || '-%'`, [base])).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A new page with its maker as admin and one 30-minute service to start from. */
export async function createPage(me: Me, b: PageInput): Promise<Page> {
  const f = pageFields(b);
  const slug = b.slug ? f.slug : await freeSlug(f.slug || "bookings");
  const id = await tx(async (tq) => {
    const [p] = await tq<{ id: string }>(
      `INSERT INTO pages (slug, name, description, time_zone, hours, min_notice_min, max_days_ahead, step_min, published,
         choose_staff, sender_email, phone, address, color, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [slug, f.name, f.description, f.timeZone, JSON.stringify(f.hours), f.minNoticeMin, f.maxDaysAhead, f.stepMin, f.published,
        f.chooseStaff, f.senderEmail, f.phone, f.address, f.color, me.email],
    );
    await tq(`INSERT INTO staff (page_id, email, name, role) VALUES ($1, $2, $3, 'admin')`, [p.id, me.email, me.name || ""]);
    await tq(`INSERT INTO services (page_id, slug, name, duration_min) VALUES ($1, 'consultation', 'Consultation', 30)`, [p.id]);
    return p.id;
  });
  return (await pageById(id))!;
}

export async function updatePage(me: Me, id: string, b: PageInput): Promise<Page> {
  const cur = await pageFor(me, id, true);
  const f = pageFields(b, cur);
  await q(
    `UPDATE pages SET slug=$2, name=$3, description=$4, time_zone=$5, hours=$6, min_notice_min=$7, max_days_ahead=$8, step_min=$9,
       published=$10, choose_staff=$11, sender_email=$12, phone=$13, address=$14, color=$15, modified_at=now() WHERE id=$1`,
    [id, f.slug, f.name, f.description, f.timeZone, JSON.stringify(f.hours), f.minNoticeMin, f.maxDaysAhead, f.stepMin,
      f.published, f.chooseStaff, f.senderEmail, f.phone, f.address, f.color],
  );
  return (await pageById(id))!;
}

/**
 * Deletes a page with its services and appointments. When anyone on it is on legal hold, the
 * page is only hidden, so its appointments stay findable by eDiscovery.
 */
export async function deletePage(me: Me, id: string, onHold: (email: string) => Promise<boolean>): Promise<void> {
  const page = await pageFor(me, id, true);
  const people = new Set(page.staff.map((s) => s.email));
  for (const r of await q<{ e: string }>(`SELECT DISTINCT unnest(ARRAY[staff_email, customer_email]) AS e FROM appointments WHERE page_id = $1`, [id])) people.add(r.e);
  let held = false;
  for (const e of people) if (await onHold(e)) { held = true; break; }
  // Upcoming appointments come off the staff's calendars; customers are not emailed.
  const upcoming = await q<{ calendar_event_id: string; staff_email: string }>(
    `SELECT calendar_event_id, staff_email FROM appointments WHERE page_id = $1 AND status = 'confirmed' AND end_at > now() AND calendar_event_id IS NOT NULL`, [id]);
  await Promise.all(upcoming.map((a) => removeCalendarEvent(a.calendar_event_id, a.staff_email)));
  if (held) await q(`UPDATE pages SET held_deleted_at = now(), published = false, slug = slug || '-deleted-' || substr(md5(random()::text), 1, 6) WHERE id = $1`, [id]);
  else await q(`DELETE FROM pages WHERE id = $1`, [id]);
}

/** Replaces the page's staff list. There must always be an admin; hours null = the page's. */
export async function setStaff(me: Me, id: string, list: unknown): Promise<Page> {
  await pageFor(me, id, true);
  if (!Array.isArray(list) || list.length > 100) throw new UserError("Staff must be a list");
  const seen = new Set<string>();
  const clean = list.map((s: Record<string, unknown>) => {
    const email = cleanEmail(s?.email);
    if (seen.has(email)) throw new UserError(`${email} is on the list twice`);
    seen.add(email);
    let hours: WeekHours | null = null;
    if (s.hours !== undefined && s.hours !== null) {
      hours = cleanHours(s.hours);
      if (!hours) throw new UserError(`Working hours for ${email} need a start before their end`);
    }
    return { email, name: text(s.name, 120), role: s.role === "admin" ? "admin" : "staff", hours };
  });
  if (!clean.some((s) => s.role === "admin")) throw new UserError("Keep at least one admin on the page");
  await tx(async (tq) => {
    await tq(`DELETE FROM staff WHERE page_id = $1 AND NOT (email = ANY($2::text[]))`, [id, clean.map((s) => s.email)]);
    for (const s of clean) {
      await tq(
        `INSERT INTO staff (page_id, email, name, role, hours) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (page_id, email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, hours = EXCLUDED.hours`,
        [id, s.email, s.name, s.role, s.hours ? JSON.stringify(s.hours) : null],
      );
    }
    // Services offered by someone who left fall back to the people still there.
    const ids = (await tq<{ id: string }>(`SELECT id FROM staff WHERE page_id = $1`, [id])).map((r) => r.id);
    await tq(`UPDATE services SET staff_ids = ARRAY(SELECT x FROM unnest(staff_ids) x WHERE x = ANY($2::uuid[])) WHERE page_id = $1`, [id, ids]);
  });
  return (await pageById(id))!;
}

export type ServiceInput = Partial<{
  name: string; slug: string; description: string; durationMin: number; bufferBeforeMin: number; bufferAfterMin: number;
  locationKind: string; location: string; price: string; staffIds: string[]; questions: unknown; reminderHours: number[];
  active: boolean; position: number;
}>;

function serviceFields(page: Page, b: ServiceInput, cur?: Service) {
  const name = b.name !== undefined ? text(b.name, 120) : cur?.name ?? "";
  if (!name) throw new UserError("Give the service a name");
  const locationKind = (b.locationKind !== undefined ? b.locationKind : cur?.locationKind ?? "meet") as LocationKind;
  if (!LOCATION_KINDS.includes(locationKind)) throw new UserError("Unknown kind of location");
  let staffIds = cur?.staffIds ?? [];
  if (b.staffIds !== undefined) {
    if (!Array.isArray(b.staffIds)) throw new UserError("staffIds must be a list");
    const known = new Set(page.staff.map((s) => s.id));
    staffIds = [...new Set(b.staffIds.map(String))];
    if (staffIds.some((s) => !known.has(s))) throw new UserError("Only people on this page can offer its services");
  }
  let questions = cur?.questions ?? [];
  if (b.questions !== undefined) {
    if (!Array.isArray(b.questions) || b.questions.length > 10) throw new UserError("Up to 10 questions");
    questions = b.questions.map((x: Record<string, unknown>, i: number) => {
      const label = text(x?.label, 200);
      if (!label) throw new UserError("Each question needs some text");
      return { id: text(x?.id, 40) || `q${i + 1}`, label, required: Boolean(x?.required) };
    });
  }
  let reminderHours = cur?.reminderHours ?? [24];
  if (b.reminderHours !== undefined) {
    if (!Array.isArray(b.reminderHours) || b.reminderHours.length > 3) throw new UserError("Up to 3 reminders");
    reminderHours = [...new Set(b.reminderHours.map((h) => int(h, 1, 24 * 14, "Reminder hours")))].sort((x, y) => y - x);
  }
  return {
    name, locationKind, staffIds, questions, reminderHours,
    slug: b.slug !== undefined ? cleanSlug(b.slug, name) : cur?.slug ?? cleanSlug(undefined, name),
    description: b.description !== undefined ? text(b.description, 2000) : cur?.description ?? "",
    durationMin: b.durationMin !== undefined ? int(b.durationMin, 5, 720, "Duration") : cur?.durationMin ?? 30,
    bufferBeforeMin: b.bufferBeforeMin !== undefined ? int(b.bufferBeforeMin, 0, 240, "Buffer before") : cur?.bufferBeforeMin ?? 0,
    bufferAfterMin: b.bufferAfterMin !== undefined ? int(b.bufferAfterMin, 0, 240, "Buffer after") : cur?.bufferAfterMin ?? 0,
    location: b.location !== undefined ? text(b.location, 300) : cur?.location ?? "",
    price: b.price !== undefined ? text(b.price, 60) : cur?.price ?? "",
    active: b.active !== undefined ? Boolean(b.active) : cur?.active ?? true,
    position: b.position !== undefined ? int(b.position, 0, 1000, "Position") : cur?.position ?? page.services.length,
  };
}

export async function createService(me: Me, pageId: string, b: ServiceInput): Promise<Service> {
  const page = await pageFor(me, pageId, true);
  const f = serviceFields(page, b);
  if (page.services.some((s) => s.slug === f.slug)) {
    if (b.slug) throw new UserError("Another service already uses that web address", 409);
    for (let i = 2; ; i++) if (!page.services.some((s) => s.slug === `${f.slug}-${i}`)) { f.slug = `${f.slug}-${i}`; break; }
  }
  const [r] = await q<ServiceRow>(
    `INSERT INTO services (page_id, slug, name, description, duration_min, buffer_before_min, buffer_after_min, location_kind, location,
       price, staff_ids, questions, reminder_hours, active, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12,$13::int[],$14,$15) RETURNING *`,
    [pageId, f.slug, f.name, f.description, f.durationMin, f.bufferBeforeMin, f.bufferAfterMin, f.locationKind, f.location,
      f.price, f.staffIds, JSON.stringify(f.questions), f.reminderHours, f.active, f.position],
  );
  return toService(r);
}

async function serviceAndPage(me: Me, id: string): Promise<[Page, Service]> {
  if (!isUuid(id)) throw new UserError("Service not found", 404);
  const [row] = await q<{ page_id: string }>(`SELECT page_id FROM services WHERE id = $1`, [id]);
  if (!row) throw new UserError("Service not found", 404);
  const page = await pageFor(me, row.page_id, true);
  return [page, page.services.find((s) => s.id === id)!];
}

export async function updateService(me: Me, id: string, b: ServiceInput): Promise<Service> {
  const [page, cur] = await serviceAndPage(me, id);
  const f = serviceFields(page, b, cur);
  if (page.services.some((s) => s.id !== id && s.slug === f.slug)) throw new UserError("Another service already uses that web address", 409);
  const [r] = await q<ServiceRow>(
    `UPDATE services SET slug=$2, name=$3, description=$4, duration_min=$5, buffer_before_min=$6, buffer_after_min=$7, location_kind=$8,
       location=$9, price=$10, staff_ids=$11::uuid[], questions=$12, reminder_hours=$13::int[], active=$14, position=$15
     WHERE id = $1 RETURNING *`,
    [id, f.slug, f.name, f.description, f.durationMin, f.bufferBeforeMin, f.bufferAfterMin, f.locationKind, f.location, f.price,
      f.staffIds, JSON.stringify(f.questions), f.reminderHours, f.active, f.position],
  );
  return toService(r);
}

/** Appointments already booked keep their service's name; the service just stops being offered. */
export async function deleteService(me: Me, id: string): Promise<void> {
  await serviceAndPage(me, id);
  await q(`DELETE FROM services WHERE id = $1`, [id]);
}

/** Who can be booked for a service. */
export function staffFor(page: Page, service: Service): Staff[] {
  return service.staffIds.length ? page.staff.filter((s) => service.staffIds.includes(s.id)) : page.staff;
}

/** What a customer sees of a page: nothing about staff but their names. */
export function publicPage(page: Page) {
  const services = page.services.filter((s) => s.active);
  return {
    slug: page.slug, name: page.name, description: page.description, timeZone: page.timeZone, phone: page.phone,
    address: page.address, color: page.color, chooseStaff: page.chooseStaff, maxDaysAhead: page.maxDaysAhead,
    staff: page.chooseStaff ? page.staff.map((s) => ({ id: s.id, name: s.name })) : [],
    services: services.map((s) => ({
      id: s.id, slug: s.slug, name: s.name, description: s.description, durationMin: s.durationMin, price: s.price,
      locationKind: s.locationKind, location: s.locationKind === "in_person" ? s.location || page.address : s.locationKind === "custom" ? s.location : "",
      questions: s.questions,
      staffIds: page.chooseStaff ? staffFor(page, s).map((x) => x.id) : [],
    })),
  };
}
export type PublicPage = ReturnType<typeof publicPage>;

export { isEmail };
