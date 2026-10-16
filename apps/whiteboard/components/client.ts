"use client";
// Browser-side helpers shared by the Whiteboard screens.

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

export function person(email: string | null | undefined, me: string): string {
  if (!email) return "someone";
  if (email === me) return "You";
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "just now", "5 minutes ago", "Yesterday", "Oct 12". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return "Yesterday";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

/** A steady colour per person, for cursors and faces. */
export function colorFor(email: string): { background: string; stroke: string } {
  const palette = ["#1971c2", "#2f9e44", "#e8590c", "#c2255c", "#6741d9", "#0c8599", "#f08c00", "#5c940d"];
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const stroke = palette[h % palette.length];
  return { background: `${stroke}33`, stroke };
}
