"use client";
// Browser-side helpers and the shapes the API returns.

export type AccountSummary = { id: string; label: string; address: string; kind: "suite" | "shared" | "imap" };
export type Folder = { path: string; name: string; role: string | null; unread: number; total: number; depth: number };
export type Person = { name: string; address: string };
export type MessageSummary = {
  uid: number; subject: string; from: Person | null; to: Person[]; date: string | null;
  seen: boolean; flagged: boolean; answered: boolean; hasAttachments: boolean; size: number;
};
export type Attachment = { index: number; filename: string; contentType: string; size: number; inline: boolean };
export type Label = {
  id: string; name: string; color: string; description?: string; priority: number;
  protection: { blockExternal: boolean; marking?: string };
};
export type MessageDetail = MessageSummary & {
  cc: Person[]; replyTo: Person[]; html: string | null; text: string; remoteImages: boolean;
  attachments: Attachment[]; messageId: string | null; references: string[];
  label: Label | null;
};
/** What /api/send answers when data loss prevention stops a message (422 block, 409 warn). */
export type DlpStop = {
  action: "warn" | "block"; tip: string;
  matches: { type: string; name: string; count: number; samples: string[] }[];
  outside: string[];
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export const postJson = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const displayName = (p: Person | null | undefined) => (p ? p.name || p.address : "");
export const fullAddress = (p: Person) => (p.name ? `${p.name} <${p.address}>` : p.address);

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 7) return d.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plain-text version of composed HTML, for the text/plain part. */
export function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|blockquote)>/gi, "\n");
  return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Another suite app's address: app.<domain> when deployed, its localhost port in development. */
export function suiteUrl(app: string, port: number, path = "/"): string {
  const host = location.hostname;
  const dot = host.indexOf(".");
  if (host === "localhost" || host === "127.0.0.1" || dot < 0) return `http://localhost:${port}${path}`;
  return `${location.protocol}//${app}.${host.slice(dot + 1)}${path}`;
}
