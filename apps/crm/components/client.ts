"use client";
// Browser-side helpers shared by the CRM screens.
import { useCallback, useEffect, useState } from "react";

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

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? usd.format(n) : "—";
}

/** Big totals on the dashboard: $1.2M, $45K. */
export function compactMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // A bare YYYY-MM-DD is a calendar date, not midnight UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const date = formatDate(iso);
  // Midnight local means "the whole day"; don't show a time.
  return d.getHours() === 0 && d.getMinutes() === 0 ? date : `${date}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** "2026-10-16T14:30" for a datetime-local input, in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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

export type View = "dashboard" | "myday" | "leads" | "accounts" | "contacts" | "opportunities" | "pipeline" | "partners" | "referrals" | "team";
export const VIEWS: View[] = ["dashboard", "myday", "leads", "accounts", "contacts", "opportunities", "pipeline", "partners", "referrals", "team"];
export type Route = { view: View; id: string | null };

function parse(hash: string): Route {
  const [view, id] = hash.replace(/^#\/?/, "").split("/");
  return VIEWS.includes(view as View) ? { view: view as View, id: id || null } : { view: "dashboard", id: null };
}

/** Where you are lives in the address (#/leads/<id>), so reload and back work. */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>({ view: "dashboard", id: null });
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = `#/${r.view}${r.id ? `/${r.id}` : ""}`;
  }, []);
  return [route, go];
}
