import type { Interval } from "./time";

/**
 * Bookings' calls to the rest of the suite, all best-effort: a booking still goes through when
 * Calendar, Contacts or Meet is not running, and the staff member just loses that convenience.
 */

function internal(envName: string, service: string, port: number): string {
  const v = process.env[envName];
  if (v) return v.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? `http://${service}:${port}` : `http://localhost:${port}`;
}

const calendarUrl = () => internal("CALENDAR_INTERNAL_URL", "calendar", 3130);
const contactsUrl = () => internal("CONTACTS_INTERNAL_URL", "contacts", 3190);

/** Calendar's service API needs CAL_SVC_TOKEN; without it, Bookings keeps to its own appointments. */
export function calendarConfigured(): boolean {
  return Boolean(process.env.CAL_SVC_TOKEN);
}

async function cal(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${calendarUrl()}/api/svc${path}`, {
    ...init,
    headers: { authorization: `Bearer ${process.env.CAL_SVC_TOKEN}`, "content-type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}

/** Busy times on someone's suite calendar. An unreachable calendar counts as free, with a log line. */
export async function calendarBusy(email: string, from: number, to: number): Promise<Interval[]> {
  if (!calendarConfigured()) return [];
  try {
    const res = await cal(`/freebusy?${new URLSearchParams({ email, from: new Date(from).toISOString(), to: new Date(to).toISOString() })}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { busy } = (await res.json()) as { busy: { start: string; end: string }[] };
    return busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })).filter((b) => b.start < b.end);
  } catch (e) {
    console.warn(`[bookings] calendar free/busy for ${email} failed:`, (e as Error).message);
    return [];
  }
}

export type CalendarEvent = {
  ownerEmail: string; title: string; description: string; location: string; startAt: string; endAt: string; attendees: string[];
};

/** Puts the appointment on the staff member's calendar; returns its event id. */
export async function addCalendarEvent(ev: CalendarEvent): Promise<string | null> {
  if (!calendarConfigured()) return null;
  try {
    const res = await cal("/events", { method: "POST", body: JSON.stringify({ ...ev, source: "booking" }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return String(((await res.json()) as { id: unknown }).id);
  } catch (e) {
    console.warn(`[bookings] adding the calendar event for ${ev.ownerEmail} failed:`, (e as Error).message);
    return null;
  }
}

export async function moveCalendarEvent(id: string, ownerEmail: string, startAt: string, endAt: string, description?: string): Promise<boolean> {
  if (!calendarConfigured()) return false;
  try {
    const res = await cal(`/events/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ownerEmail, startAt, endAt, ...(description !== undefined ? { description } : {}), source: "booking" }),
    });
    return res.ok;
  } catch (e) {
    console.warn(`[bookings] moving calendar event ${id} failed:`, (e as Error).message);
    return false;
  }
}

export async function removeCalendarEvent(id: string, ownerEmail: string): Promise<boolean> {
  if (!calendarConfigured()) return false;
  try {
    const res = await cal(`/events/${encodeURIComponent(id)}?${new URLSearchParams({ ownerEmail, source: "booking" })}`, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch (e) {
    console.warn(`[bookings] removing calendar event ${id} failed:`, (e as Error).message);
    return false;
  }
}

/** Calls Contacts as the staff member, the way the gateway would. */
async function asPerson(email: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { "x-auth-request-email": email, "content-type": "application/json" };
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  return fetch(`${contactsUrl()}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(4000) });
}

/** Adds the customer to the staff member's contacts, unless someone with that email is already there. */
export async function rememberCustomer(staffEmail: string, c: { name: string; email: string; phone: string }): Promise<boolean> {
  try {
    const found = await asPerson(staffEmail, `/api/contacts?${new URLSearchParams({ q: c.email })}`);
    if (!found.ok) return false;
    const list = (await found.json()) as { emails?: { value: string }[] }[];
    if (Array.isArray(list) && list.some((x) => x.emails?.some((e) => e.value.toLowerCase() === c.email))) return false;
    const [firstName, ...rest] = c.name.split(/\s+/);
    const res = await asPerson(staffEmail, "/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        firstName, lastName: rest.join(" "),
        emails: [{ label: "work", value: c.email }],
        phones: c.phone ? [{ label: "mobile", value: c.phone }] : [],
        notes: "Added by Bookings",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A fresh Meet room for one appointment. Rooms come into being when the staff member joins. */
export function meetRoom(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "b-" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function meetUrl(room: string): string {
  const base = process.env.MEET_PUBLIC_URL || (process.env.SUITE_DOMAIN ? `https://meet.${process.env.SUITE_DOMAIN}` : "http://localhost:3420");
  return `${base.replace(/\/$/, "")}/room/${room}`;
}

/** Where customers open their booking pages and manage links. */
export function publicBase(): string {
  const base = process.env.BOOKINGS_PUBLIC_URL || (process.env.SUITE_DOMAIN ? `https://bookings.${process.env.SUITE_DOMAIN}` : "http://localhost:3150");
  return base.replace(/\/$/, "");
}
