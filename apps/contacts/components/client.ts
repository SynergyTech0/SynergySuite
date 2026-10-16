"use client";
// Browser-side helpers shared by the Contacts screens.

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
  const words = name.replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

const HUES = [210, 160, 25, 280, 340, 190, 45, 120];
export function hue(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** The letter a contact files under in the A–Z index; "#" for digits and symbols. */
export function letterOf(name: string): string {
  const c = name.normalize("NFD").replace(/[̀-ͯ]/g, "")[0]?.toUpperCase() ?? "#";
  return c >= "A" && c <= "Z" ? c : "#";
}

export function formatBirthday(d: string): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, day));
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", timeZone: "UTC" };
  if (y !== 1604) opts.year = "numeric";
  return date.toLocaleDateString([], opts);
}

export const LABELS = {
  email: ["work", "home", "other"],
  phone: ["mobile", "work", "home", "main", "work fax", "home fax", "pager", "other"],
  address: ["work", "home", "other"],
  website: ["work", "home", "blog", "other"],
};

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
