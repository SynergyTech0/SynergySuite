"use client";
// Browser-side helpers shared by the Desk screens.

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

export function initials(name: string): string {
  const words = name.replace(/@.*$/, "").replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

const HUES = [210, 160, 25, 280, 340, 190, 45, 120];
export function hue(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** Today: "3:42 PM"; this year: "Oct 3"; older: "Oct 3, 2025". */
export function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts);
}

export function stamp(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function mailUrl(email: string): string {
  // Mail is a sibling app: mail.<domain> when deployed, port 3200 in development.
  const host = typeof location !== "undefined" ? location.hostname : "";
  const q = `/?compose=${encodeURIComponent(email)}`;
  if (host === "localhost" || host === "127.0.0.1") return `http://localhost:3200${q}`;
  const dot = host.indexOf(".");
  return dot > 0 ? `${location.protocol}//mail.${host.slice(dot + 1)}${q}` : `mailto:${email}`;
}
