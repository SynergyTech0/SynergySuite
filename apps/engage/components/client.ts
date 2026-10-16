"use client";
// Browser-side helpers shared by the Engage screens.

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

/** "just now", "5m", "3h", "Mon", "Oct 20" or "Oct 20, 2025". */
export function ago(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 6 * 86400) return d.toLocaleDateString([], { weekday: "short" });
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const COLOR_HEX: Record<string, string> = {
  blue: "#0f6cbd", green: "#107c41", red: "#c4314b", orange: "#ca5010", purple: "#8764b8", teal: "#038387", pink: "#c239b3", gray: "#69797e",
};

/** A steady colour for a person's avatar. */
export function personColor(email: string): string {
  const keys = Object.keys(COLOR_HEX);
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLOR_HEX[keys[h % keys.length]];
}

export const REACTION_EMOJI: Record<string, { emoji: string; label: string }> = {
  like: { emoji: "👍", label: "Like" },
  love: { emoji: "❤️", label: "Love" },
  celebrate: { emoji: "🎉", label: "Celebrate" },
  insightful: { emoji: "💡", label: "Insightful" },
  laugh: { emoji: "😄", label: "Laugh" },
  sad: { emoji: "😢", label: "Sad" },
};

export const BADGE_EMOJI: Record<string, string> = {
  "thank-you": "🙏", "great-job": "⭐", "team-player": "🤝", "above-and-beyond": "🚀",
  "problem-solver": "🧩", creative: "🎨", leader: "🧭", welcome: "👋",
};

export const personHref = (email: string) => `/people/${encodeURIComponent(email)}`;
export const topicHref = (t: string) => `/topics/${encodeURIComponent(t)}`;
