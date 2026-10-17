"use client";
// Browser-side helpers shared by the Law screens.

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

export function shortDate(day: string | null): string {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return new Date(y, m - 1, d).toLocaleDateString([], opts);
}

export function money(cents: number | null | undefined, currency = "USD"): string {
  const v = (cents ?? 0) / 100;
  try {
    return v.toLocaleString([], { style: "currency", currency });
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

/** Cents as the number someone would type: 15000 → "150". */
export function amount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return String(cents / 100);
}

export function person(email: string, me?: string): string {
  if (me && email === me) return "You";
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "in 12 days", "today", "3 days ago". */
export function relDays(n: number | null): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function when(at: string | Date): string {
  return new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const STATUS_LABELS: Record<string, string> = { open: "Open", pending: "Pending", closed: "Closed" };
export const FEE_LABELS: Record<string, string> = { hourly: "Hourly", flat: "Flat fee", contingency: "Contingency", pro_bono: "Pro bono" };
export const ROLE_LABELS: Record<string, string> = {
  adverse: "Adverse party", co_party: "Co-party", opposing_counsel: "Opposing counsel", witness: "Witness", related: "Related party",
};
export const TRUST_LABELS: Record<string, string> = { deposit: "Deposit", disbursement: "Disbursement", fee_transfer: "Earned fees" };

/** Minutes as hours: 90 → "1.5". */
export function hours(min: number | null | undefined): string {
  if (!min) return "0";
  return String(Math.round((min / 60) * 100) / 100);
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
