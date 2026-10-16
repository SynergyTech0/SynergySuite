"use client";
// Browser-side helpers shared by the Devices screens.
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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(iso)}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** "just now", "5 min ago", "3 h ago", "4 days ago", then the date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`;
  return formatDate(iso);
}

export function formatSize(n: number | string | null | undefined): string {
  const v0 = Number(n);
  if (!n || !Number.isFinite(v0)) return "—";
  const units = ["KB", "MB", "GB", "TB"];
  let v = v0 / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type View =
  | "overview" | "devices" | "compliance" | "alerts" | "vulnerabilities" | "hunting" | "indicators" | "enroll" | "my" | "audit" | "about";
export const VIEWS: View[] = ["overview", "devices", "compliance", "alerts", "vulnerabilities", "hunting", "indicators", "enroll", "my", "audit", "about"];
export type Route = { view: View; id: string | null; tab: string | null };

function parse(hash: string, fallback: View): Route {
  const [view, id, tab] = hash.replace(/^#\/?/, "").split("/").map((p) => decodeURIComponent(p));
  return VIEWS.includes(view as View) ? { view: view as View, id: id || null, tab: tab || null } : { view: fallback, id: null, tab: null };
}

/** Where you are lives in the address (#/devices/<id>/software), so reload and back work. */
export function useRoute(fallback: View): [Route, (r: Partial<Route> & { view: View }) => void] {
  const [route, setRoute] = useState<Route>({ view: fallback, id: null, tab: null });
  useEffect(() => {
    const on = () => setRoute(parse(location.hash, fallback));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [fallback]);
  const go = useCallback((r: Partial<Route> & { view: View }) => {
    location.hash = `#/${r.view}${r.id ? `/${encodeURIComponent(r.id)}` : ""}${r.id && r.tab ? `/${r.tab}` : ""}`;
  }, []);
  return [route, go];
}

/** Loads `path`, again whenever `deps` change; `reload` fetches it again. */
export function useData<T>(path: string | null, say: (t: string) => void): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then((d) => live && setData(d)).catch((e) => live && say(e.message));
    return () => {
      live = false;
    };
  }, [path, n, say]);
  return [data, useCallback(() => setN((x) => x + 1), [])];
}
