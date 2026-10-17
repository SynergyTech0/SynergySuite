"use client";
// Browser-side helpers shared by the Campaigns screens.
import { useCallback, useEffect, useState } from "react";
import type { Ctx, Member, Settings } from "@/lib/types";

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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${formatDate(iso)}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** "2026-10-16T14:30" for a datetime-local input, in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(part / whole >= 0.1 ? 0 : 1)}%`;
}

export const num = (n: number) => n.toLocaleString();

export type View = "dashboard" | "campaigns" | "audiences" | "templates" | "automations" | "settings";
export const VIEWS: View[] = ["dashboard", "campaigns", "audiences", "templates", "automations", "settings"];
export type Route = { view: View; id: string | null; tab: string | null };

function parse(hash: string): Route {
  const [view, id, tab] = hash.replace(/^#\/?/, "").split("/");
  return VIEWS.includes(view as View) ? { view: view as View, id: id || null, tab: tab || null } : { view: "dashboard", id: null, tab: null };
}

/** Where you are lives in the address (#/campaigns/<id>/report), so reload and back work. */
export function useRoute(): [Route, (r: Partial<Route> & { view: View }) => void] {
  const [route, setRoute] = useState<Route>({ view: "dashboard", id: null, tab: null });
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Partial<Route> & { view: View }) => {
    location.hash = `#/${r.view}${r.id ? `/${r.id}` : ""}${r.id && r.tab ? `/${r.tab}` : ""}`;
  }, []);
  return [route, go];
}

/** What every screen gets from the app: who you are, what you may do, and a way to say things. */
export type AppCtx = {
  me: Ctx;
  canEdit: boolean;
  members: Member[];
  ai: boolean;
  settings: Settings;
  say: (text: string) => void;
  go: (r: Partial<Route> & { view: View }) => void;
  refreshMe: () => void;
};
