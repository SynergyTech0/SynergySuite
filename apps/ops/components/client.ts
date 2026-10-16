"use client";
// Browser-side helpers shared by the Ops screens.

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

const qtyFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const moneyFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const qty = (n: number | null | undefined) => (n === null || n === undefined ? "" : qtyFmt.format(n));
export const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : moneyFmt.format(n));

/** "Oct 3" this year, "Oct 3, 2025" otherwise, from yyyy-mm-dd or an ISO timestamp. */
export function date(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts);
}

export function stamp(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "in_progress" → "In progress". */
export function label(s: string): string {
  const t = s.replace(/_/g, " ");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Today in the viewer's time zone, yyyy-mm-dd. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Puts ?key=id in the address bar so the open record survives a reload and can be shared. */
export function setLink(key: string | null, id?: number | null) {
  const url = new URL(location.href);
  for (const k of ["item", "bom", "wo", "asset", "mo"]) url.searchParams.delete(k);
  if (key && id) url.searchParams.set(key, String(id));
  history.replaceState(null, "", url);
}
