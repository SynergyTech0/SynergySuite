"use client";
// Browser-side helpers shared by the To Do screens.

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

/** Today in the browser's own time zone, as YYYY-MM-DD. */
export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysStr(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

/** "Today", "Tomorrow", "Mon, Oct 20" or "Oct 20, 2027". */
export function dueLabel(due: string, today: string): string {
  if (due === today) return "Today";
  if (due === addDaysStr(today, 1)) return "Tomorrow";
  if (due === addDaysStr(today, -1)) return "Yesterday";
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) {
    delete opts.weekday;
    opts.year = "numeric";
  }
  return date.toLocaleDateString([], opts);
}

export function longDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  const day = todayStr(d);
  const today = todayStr();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return day === today ? `Today at ${time}` : `${dueLabel(day, today)} at ${time}`;
}

/** For <input type="datetime-local">, which wants local time without a zone. */
export function localInput(iso: string): string {
  const d = new Date(iso);
  return `${todayStr(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function person(email: string, me: string): string {
  if (email === me) return "You";
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const REPEAT_LABELS: Record<string, string> = {
  daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly",
};

export const COLOR_HEX: Record<string, string> = {
  blue: "#0f6cbd", green: "#107c41", red: "#c4314b", orange: "#ca5010", purple: "#8764b8", teal: "#038387", pink: "#c239b3", gray: "#69797e",
};
