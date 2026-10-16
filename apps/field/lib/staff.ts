import { q } from "./db";
import { UserError, cents, cleanEmail, text } from "./util";

/**
 * Who uses Field Service. Dispatchers take jobs in, book technicians, bill and manage the team;
 * technicians see and work the jobs booked to them. The first person to open the app becomes its
 * first dispatcher, so a new install isn't locked; after that a dispatcher adds everyone else.
 */
export type Role = "dispatcher" | "technician";

export type Staff = {
  email: string; name: string; role: Role; skills: string[]; phone: string; homeBase: string;
  billRateCents: number | null; active: boolean;
};

type Row = { email: string; name: string; role: Role; skills: string[]; phone: string; home_base: string; bill_rate_cents: string | null; active: boolean };

function toStaff(r: Row): Staff {
  return {
    email: r.email, name: r.name, role: r.role, skills: r.skills, phone: r.phone, homeBase: r.home_base,
    billRateCents: r.bill_rate_cents === null ? null : Number(r.bill_rate_cents), active: r.active,
  };
}

/** The person's role, or null when they aren't on the team. */
export async function existingRole(email: string): Promise<Role | null> {
  const [r] = await q<{ role: Role; active: boolean }>("SELECT role, active FROM staff WHERE email = $1", [email.trim().toLowerCase()]);
  return r?.active ? r.role : null;
}

/** As existingRole, but the first person into a new install becomes its dispatcher. */
export async function roleOf(email: string, name = ""): Promise<Role | null> {
  const e = email.trim().toLowerCase();
  const [r] = await q<{ role: Role; active: boolean }>("SELECT role, active FROM staff WHERE email = $1", [e]);
  if (r) return r.active ? r.role : null;
  const claimed = await q<{ role: Role }>(
    `INSERT INTO staff (email, name, role, added_by) SELECT $1, $2, 'dispatcher', $1
     WHERE NOT EXISTS (SELECT 1 FROM staff) ON CONFLICT DO NOTHING RETURNING role`,
    [e, text(name, 200)],
  );
  return claimed[0]?.role ?? null;
}

export async function requireStaff(email: string): Promise<Role> {
  const role = await existingRole(email);
  if (!role) throw new UserError("You're not on the field service team. Ask a dispatcher to add you.", 403);
  return role;
}

export async function requireDispatcher(email: string): Promise<void> {
  if ((await requireStaff(email)) !== "dispatcher") throw new UserError("Only dispatchers can do that", 403);
}

export async function listStaff(): Promise<Staff[]> {
  return (await q<Row>("SELECT * FROM staff ORDER BY active DESC, role, name, email")).map(toStaff);
}

export async function technicians(): Promise<Staff[]> {
  return (await q<Row>("SELECT * FROM staff WHERE role = 'technician' AND active ORDER BY name, email")).map(toStaff);
}

export function cleanSkills(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? "").split(",");
  return [...new Set(list.map((s) => text(s, 60).toLowerCase()).filter(Boolean))].slice(0, 30);
}

export async function saveStaff(me: string, b: Record<string, unknown>): Promise<Staff> {
  await requireDispatcher(me);
  const email = cleanEmail(b.email);
  const role = b.role === "dispatcher" ? "dispatcher" : "technician";
  if (role !== "dispatcher" || b.active === false) await keepADispatcher(email);
  const [r] = await q<Row>(
    `INSERT INTO staff (email, name, role, skills, phone, home_base, bill_rate_cents, active, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, skills = EXCLUDED.skills, phone = EXCLUDED.phone,
       home_base = EXCLUDED.home_base, bill_rate_cents = EXCLUDED.bill_rate_cents, active = EXCLUDED.active
     RETURNING *`,
    [email, text(b.name, 200), role, cleanSkills(b.skills), text(b.phone, 60), text(b.homeBase, 300), cents(b.billRate, "Bill rate"), b.active !== false, me],
  );
  return toStaff(r);
}

/** Refuses a change to `email` that would leave nobody able to run the app. */
async function keepADispatcher(email: string): Promise<void> {
  const [r] = await q<{ n: number }>(
    "SELECT count(*)::int AS n FROM staff WHERE role = 'dispatcher' AND active AND email <> $1",
    [email.trim().toLowerCase()],
  );
  if (r.n === 0) throw new UserError("Keep at least one dispatcher", 400);
}

export async function removeStaff(me: string, email: string): Promise<void> {
  await requireDispatcher(me);
  await keepADispatcher(email);
  // Booked work stays on record under their name; they just can't open the app any more.
  await q("UPDATE staff SET active = false WHERE email = $1", [email.trim().toLowerCase()]);
}

export type Settings = { currency: string; laborRateCents: number; tripFeeCents: number; timeZone: string };

const DEFAULTS: Settings = { currency: "USD", laborRateCents: 9500, tripFeeCents: 0, timeZone: "UTC" };

export async function getSettings(): Promise<Settings> {
  const rows = await q<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out as Settings;
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function saveSettings(me: string, b: Record<string, unknown>): Promise<Settings> {
  await requireDispatcher(me);
  const next: Partial<Settings> = {};
  if (b.currency !== undefined) {
    const c = text(b.currency, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new UserError("Currency is a three-letter code like USD");
    next.currency = c;
  }
  if (b.laborRate !== undefined) next.laborRateCents = cents(b.laborRate, "Labor rate") ?? 0;
  if (b.tripFee !== undefined) next.tripFeeCents = cents(b.tripFee, "Trip fee") ?? 0;
  if (b.timeZone !== undefined) {
    const tz = text(b.timeZone, 64);
    if (!validZone(tz)) throw new UserError("That isn't a time zone, try one like America/Chicago");
    next.timeZone = tz;
  }
  for (const [k, v] of Object.entries(next)) {
    await q("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(v)]);
  }
  return getSettings();
}

/** What an hour of this technician's time is billed at: their own rate, else the default. */
export async function rateFor(email: string): Promise<number> {
  const [r] = await q<{ bill_rate_cents: string | null }>("SELECT bill_rate_cents FROM staff WHERE email = $1", [email.toLowerCase()]);
  if (r?.bill_rate_cents != null) return Number(r.bill_rate_cents);
  return (await getSettings()).laborRateCents;
}

/** A team member's name for timelines and notes, falling back to their email. */
export async function nameOf(email: string): Promise<string> {
  const [r] = await q<{ name: string }>("SELECT name FROM staff WHERE email = $1", [email.toLowerCase()]);
  return r?.name || email;
}
