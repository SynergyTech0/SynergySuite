"use client";
// Browser-side helpers shared by the Bookings screens.

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export const COLOR_HEX: Record<string, string> = {
  blue: "#0f6cbd", green: "#107c41", red: "#c4314b", orange: "#ca5010", purple: "#8764b8", teal: "#038387", pink: "#c239b3", gray: "#69797e",
};

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** YYYY-MM-DD of an instant in a zone. */
export function dayKey(t: number | string | Date, tz: string): string {
  const d = new Date(t);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Noon UTC on that day: safe to format as a date in any zone without slipping a day. */
function noon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function timeIn(t: string | number | Date, tz: string): string {
  return new Date(t).toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

export function longDay(day: string): string {
  return noon(day).toLocaleDateString([], { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function shortDay(day: string): { dow: string; num: string; mon: string } {
  const d = noon(day);
  return {
    dow: d.toLocaleDateString([], { timeZone: "UTC", weekday: "short" }),
    num: d.toLocaleDateString([], { timeZone: "UTC", day: "numeric" }),
    mon: d.toLocaleDateString([], { timeZone: "UTC", month: "short" }),
  };
}

export function whenIn(t: string, tz: string): string {
  return `${longDay(dayKey(t, tz))} at ${timeIn(t, tz)}`;
}

export function zoneLabel(tz: string): string {
  return tz === "UTC" ? "UTC" : tz.replace(/_/g, " ");
}

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}

/** For <input type="datetime-local">: local wall time, no zone. */
export function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type Slot = { start: string; staffIds: string[] };
