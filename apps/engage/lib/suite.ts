import apps from "@synergy/config/apps.json";
import type { Me } from "./api";

/**
 * Engage reads Sites and Chat on the viewer's behalf, the way suite search does: with the gateway
 * headers that app already trusts (X-Auth-Request-Email plus X-Proxy-Auth-Secret), so each app
 * answers with only what that person could see there themselves.
 */

function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const v = JSON.parse(env.ENGAGE_APP_URLS || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Where Engage reaches an app: ENGAGE_APP_URLS, else http://<id>:<port> in production, localhost otherwise. */
export function internalUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = overrides(env)[id];
  if (typeof o === "string" && o) return o.replace(/\/+$/, "");
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.NODE_ENV === "production" ? `http://${app.id}:${app.port}` : `http://localhost:${app.port}`;
}

/** The address people open an app at. */
export function publicUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.SUITE_DOMAIN ? `https://${id}.${env.SUITE_DOMAIN}` : `http://localhost:${app.port}`;
}

type Fetch = typeof fetch;

async function asViewer<T>(me: Me, id: string, path: string, init: RequestInit = {}, f: Fetch = fetch): Promise<T> {
  const res = await f(`${internalUrl(id)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-auth-request-email": me.email,
      "x-auth-request-preferred-username": me.name,
      "x-proxy-auth-secret": process.env.PROXY_SHARED_SECRET || "",
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(4000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `${id} answered ${res.status}`);
  return data as T;
}

export type SiteLink = { name: string; description: string; url: string };

/** Published sites from Sites, for the home page. Empty when Sites can't be reached. */
export async function companySites(me: Me, f: Fetch = fetch): Promise<{ sites: SiteLink[]; available: boolean }> {
  try {
    const rows = await asViewer<{ slug: string; name: string; description: string; published: boolean }[]>(me, "sites", "/api/sites", {}, f);
    const base = publicUrl("sites");
    return {
      available: true,
      sites: rows.filter((s) => s.published).slice(0, 12).map((s) => ({ name: s.name, description: s.description, url: `${base}/s/${encodeURIComponent(s.slug)}` })),
    };
  } catch {
    return { sites: [], available: false };
  }
}

export type ChatChannel = { id: number; name: string; workspaceId: number; url: string };

/** The Chat channels the viewer is in (not direct messages), to share a post into or link a community to. */
export async function chatChannels(me: Me, f: Fetch = fetch): Promise<{ channels: ChatChannel[]; available: boolean }> {
  try {
    const r = await asViewer<{ activeWorkspace: number | null; channels: { id: number; kind: string; name: string }[] }>(me, "chat", "/api/me", {}, f);
    const base = publicUrl("chat");
    const ws = Number(r.activeWorkspace);
    return {
      available: true,
      channels: (r.channels ?? [])
        .filter((c) => c.kind !== "dm")
        .map((c) => ({ id: Number(c.id), name: c.name, workspaceId: ws, url: `${base}/?ws=${ws}&channel=${Number(c.id)}` })),
    };
  } catch {
    return { channels: [], available: false };
  }
}

/** Posts a message into a Chat channel as the viewer. Chat checks they are in it. */
export async function postToChat(me: Me, channelId: number, body: string, f: Fetch = fetch): Promise<void> {
  if (!Number.isInteger(channelId) || channelId <= 0) throw new Error("Pick a channel");
  await asViewer(me, "chat", `/api/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ body }) }, f);
}
