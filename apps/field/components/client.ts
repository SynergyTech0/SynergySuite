"use client";
// Browser-side helpers and types shared by the Field Service screens.
import type { Board, BoardBooking, Suggestion } from "@/lib/schedule";
import type { Staff, Settings, Role } from "@/lib/staff";
import type { WorkOrder, WorkOrderDetail } from "@/lib/workorders";
import type { Asset, Customer } from "@/lib/customers";
import type { Invoice } from "@/lib/billing";
import type { CatalogPart } from "@/lib/parts";

export type { Asset, Board, BoardBooking, CatalogPart, Customer, Invoice, Role, Settings, Staff, Suggestion, WorkOrder, WorkOrderDetail };

export type Status = {
  ai: boolean;
  links: { books: boolean; commerce: boolean; desk: boolean; ops: boolean };
  urls: { books: string; desk: string; commerce: string; ops: string };
  parts: { linked: boolean; pending: number; failed: number; lastError: string };
  settings: Settings;
};

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Request failed (${res.status})`), { status: res.status });
  return data as T;
}

/** YYYY-MM-DD for a date in the browser's own time zone. */
export function dayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight of a YYYY-MM-DD day, `n` days on. */
export function dayStart(day: string, n = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + n);
}

export function longDay(day: string): string {
  return dayStart(day).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export function time(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return d.toLocaleString([], opts);
}

export function shortDate(day: string | null): string {
  if (!day) return "";
  return dayStart(day).toLocaleDateString([], { month: "short", day: "numeric", year: dayStart(day).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** A datetime-local input's value for an ISO instant, and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${dayStr(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function hrs(min: number | null | undefined): string {
  if (!min) return "0";
  return String(Math.round((min / 60) * 100) / 100);
}

export function money(cents: number | null | undefined, currency = "USD"): string {
  const v = (cents ?? 0) / 100;
  try {
    return v.toLocaleString([], { style: "currency", currency });
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

export function person(email: string, staff?: Staff[], me?: string): string {
  if (me && email === me) return "You";
  const s = staff?.find((x) => x.email === email);
  if (s?.name) return s.name;
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const STATUS_LABEL: Record<string, string> = {
  new: "New", scheduled: "Scheduled", in_progress: "In progress", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled",
  traveling: "On the way", on_site: "On site", done: "Done",
};

export const KIND_LABEL: Record<string, string> = { repair: "Repair", install: "Install", maintenance: "Maintenance", inspection: "Inspection" };

/** A map search for an address. */
export function mapsUrl(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
}
