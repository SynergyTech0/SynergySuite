"use client";
// Browser-side helpers shared by the Admin center screens.
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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(iso)}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function formatSize(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

export function initials(name: string): string {
  const words = name.replace(/@.*/, "").replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

const HUES = [210, 160, 25, 280, 340, 190, 45, 120];
export function hue(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export type View = "home" | "people" | "apps" | "matters" | "holds" | "search" | "retention" | "labels" | "dlp" | "audit" | "roles";
export const VIEWS: View[] = ["home", "people", "apps", "matters", "holds", "search", "retention", "labels", "dlp", "audit", "roles"];
export type Route = { view: View; id: string | null; tab: string | null };

function parse(hash: string, fallback: View): Route {
  const [view, id, tab] = hash.replace(/^#\/?/, "").split("/");
  return VIEWS.includes(view as View) ? { view: view as View, id: id || null, tab: tab || null } : { view: fallback, id: null, tab: null };
}

/** Where you are lives in the address (#/matters/<id>/holds), so reload and back work. */
export function useRoute(fallback: View): [Route, (r: Partial<Route> & { view: View }) => void] {
  const [route, setRoute] = useState<Route>({ view: fallback, id: null, tab: null });
  useEffect(() => {
    const on = () => setRoute(parse(location.hash, fallback));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [fallback]);
  const go = useCallback((r: Partial<Route> & { view: View }) => {
    location.hash = `#/${r.view}${r.id ? `/${r.id}` : ""}${r.id && r.tab ? `/${r.tab}` : ""}`;
  }, []);
  return [route, go];
}

/** Saves a base64 attachment from an item as a file. */
export function saveBase64(name: string, type: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: type || "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "attachment";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
