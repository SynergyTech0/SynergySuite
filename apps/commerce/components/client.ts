"use client";
// Browser-side helpers shared by the Commerce screens.
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

/** Loads `path`, again whenever `deps` change; `reload` fetches on demand. */
export function useData<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((d) => live && (setData(d), setError("")))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { data, error, reload: useCallback(() => setN((x) => x + 1), []) };
}

let currency = "USD";
export function setCurrency(c: string) {
  currency = c || "USD";
}

export function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n) : "—";
}

export function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${formatDate(iso)}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export type View = "overview" | "orders" | "products" | "stock" | "purchasing" | "reorder" | "vendors" | "accounting" | "settings";
export const VIEWS: View[] = ["overview", "orders", "products", "stock", "purchasing", "reorder", "vendors", "accounting", "settings"];
export type Route = { view: View; id: string | null };

function parse(hash: string): Route {
  const [view, id] = hash.replace(/^#\/?/, "").split("/");
  return VIEWS.includes(view as View) ? { view: view as View, id: id || null } : { view: "overview", id: null };
}

/** Where you are lives in the address (#/orders/<id>), so reload and back work. */
export function useRoute(): [Route, (view: View, id?: string | null) => void] {
  const [route, setRoute] = useState<Route>({ view: "overview", id: null });
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((view: View, id?: string | null) => {
    location.hash = `#/${view}${id ? `/${id}` : ""}`;
  }, []);
  return [route, go];
}

/** Reads a form into a plain object of strings, with checkboxes as booleans. */
export function formData(form: HTMLFormElement): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}

/** Parses CSV text (quotes, commas and newlines inside quotes) into rows keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
