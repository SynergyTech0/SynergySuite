"use client";
// Browser-side helpers shared by the Loop screens.
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { itemsOf } from "@/lib/ydoc.mjs";

export type Me = { email: string; name: string };
export type Role = "owner" | "editor" | "viewer";

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

const COLORS = ["#2b4fe0", "#7b3bea", "#0f8a7e", "#c2410c", "#be185d", "#4d7c0f", "#0369a1", "#a16207"];

/** A steady color per person, for their cursor and avatar. */
export function colorFor(email: string): string {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0].replace(/[._-]+/g, " ") : nameOrEmail;
  const parts = base.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export type Collab = {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  synced: boolean;
  /** Set when the live server refused us or can't be reached. */
  problem: string;
  /** Other people here now. */
  people: { email: string; name: string; color: string }[];
};

/**
 * One live connection to a page or component ("page:<id>" / "component:<id>"), closed again when
 * the screen goes away. Nothing is shown until the first sync, so an editor never starts from an
 * empty document and adds a stray line to the shared one.
 */
export function useCollab(name: string | null, url: string, me: Me): Collab | null {
  const [state, setState] = useState<Collab | null>(null);
  useEffect(() => {
    if (!name) return;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url, name, document: doc });
    let current: Collab = { provider, doc, synced: false, problem: "", people: [] };
    const push = (patch: Partial<Collab>) => {
      current = { ...current, ...patch };
      setState(current);
    };
    push({});
    provider.setAwarenessField("user", { email: me.email, name: me.name || me.email, color: colorFor(me.email) });
    provider.on("synced", () => push({ synced: true, problem: "" }));
    provider.on("authenticationFailed", () => push({ problem: "You don't have access to this any more." }));
    provider.on("close", ({ event }: { event: CloseEvent }) => {
      if (event?.code === 4403 || event?.reason === "forbidden") push({ problem: "You don't have access to this any more." });
      else if (!current.synced) push({ problem: "Can't reach the live server. Trying again…" });
    });
    provider.on("connect", () => current.problem && push({ problem: "" }));
    provider.on("awarenessChange", ({ states }: { states: { clientId: number; user?: Collab["people"][number] }[] }) => {
      const seen = new Map<string, Collab["people"][number]>();
      for (const s of states) if (s.user?.email && s.user.email !== me.email) seen.set(s.user.email, s.user);
      push({ people: [...seen.values()] });
    });
    return () => {
      provider.destroy();
      doc.destroy();
      setState(null);
    };
  }, [name, url, me.email, me.name]);
  return state;
}

/** The rows of a structured component, re-read whenever anyone changes them. */
export function useItems(doc: Y.Doc | undefined): Record<string, any>[] {
  const [items, setItems] = useState<Record<string, any>[]>(() => (doc ? itemsOf(doc) : []));
  useEffect(() => {
    if (!doc) return;
    const arr = doc.getArray("items");
    const on = () => setItems(itemsOf(doc));
    on();
    arr.observeDeep(on);
    return () => arr.unobserveDeep(on);
  }, [doc]);
  return items;
}

/** The live row with this id. */
export function rowOf(doc: Y.Doc, id: string): Y.Map<any> | null {
  for (const m of doc.getArray("items").toArray()) if (m instanceof Y.Map && m.get("id") === id) return m;
  return null;
}

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: s > 300 * 86400 ? "numeric" : undefined });
}

/** The address of a component that opens it anywhere in the suite. */
export function componentLink(id: string): string {
  return `${window.location.origin}/c/${id}`;
}
