"use client";
// Browser-side helpers shared by the Drive screens.

export type Role = "viewer" | "editor" | "owner";

export type Item = {
  id: string;
  name: string;
  kind: "file" | "folder";
  mime: string;
  size: number;
  version: number;
  owner: string;
  libraryId: string | null;
  parentId: string | null;
  modifiedAt: string;
  modifiedBy: string;
  createdAt: string;
  trashedAt: string | null;
  trashedBy: string | null;
  starred: boolean;
  shared: boolean;
  labelId: string | null;
  location?: string;
};

/** A sensitivity label from the Admin center (see /api/labels). */
export type Label = { id: string; name: string; color: string; description?: string; priority: number; protection: { blockExternal: boolean; marking?: string } };

export function findLabel(labels: Label[], id: string | null | undefined): Label | null {
  return id ? labels.find((l) => l.id.toLowerCase() === id.toLowerCase()) ?? null : null;
}

/** What a data loss prevention check found, as the server sends it with a 409 or 422. */
export type DlpDecision = {
  action: "allow" | "audit" | "warn" | "block";
  matches: { type: string; name: string; count: number; samples: string[] }[];
  rules: { id: string; name: string }[];
  external: boolean;
  outside: string[];
  tip?: string;
};

/** A failed request, with the status and whatever else the server said. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown>) {
    super(message);
  }
}

export type Crumb = { label: string; parent?: string; library?: string; view?: string };
export type Library = { id: string; name: string; description: string; role: Role; members: number };
export type Me = { email: string; name: string; used: number; quota: number; ai: boolean };

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Request failed (${res.status})`, res.status, data as Record<string, unknown>);
  return data as T;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const ago = (Date.now() - d.getTime()) / 1000;
  if (ago < 60) return "Just now";
  if (ago < 3600) return `${Math.floor(ago / 60)} min ago`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts);
}

export function person(email: string, me: string): string {
  if (!email) return "";
  if (email === me) return "You";
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | "none";

export function previewKind(mime: string): PreviewKind {
  if (mime === "application/pdf") return "pdf";
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm|ogg)$/.test(mime)) return "video";
  if (/^audio\//.test(mime) && mime !== "audio/aac") return "audio";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") return "text";
  return "none";
}

export const contentUrl = (id: string, opts: { inline?: boolean; v?: number } = {}) =>
  `/api/items/${id}/content${opts.inline || opts.v ? "?" : ""}${[opts.inline ? "inline=1" : "", opts.v ? `v=${opts.v}` : ""].filter(Boolean).join("&")}`;

/**
 * The suite app that opens a file, when there is one: Whiteboard for .excalidraw boards. Apps live
 * at <app>.<domain>, or on their own localhost port in development.
 */
export function openWith(item: { id: string; name: string }, loc: Pick<Location, "protocol" | "host" | "hostname"> = location): { label: string; href: string } | undefined {
  if (!/\.excalidraw$/i.test(item.name)) return undefined;
  const base = loc.hostname.startsWith("drive.") ? `${loc.protocol}//whiteboard.${loc.host.slice("drive.".length)}` : `${loc.protocol}//${loc.hostname}:3750`;
  return { label: "Open in Whiteboard", href: `${base}/open?drive=${encodeURIComponent(item.id)}` };
}
