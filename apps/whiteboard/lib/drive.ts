import { appUrl } from "@synergy/config";
import type { Me } from "./api";
import { UserError } from "./util";

/**
 * Whiteboard's link to Drive: copies of boards are saved into the person's own Drive, and
 * .excalidraw files in Drive open as boards. Calls go server to server, as the signed-in person
 * (the gateway's identity headers plus PROXY_SHARED_SECRET, like suite search), so Drive applies
 * its own sharing rules and storage limits to every call.
 */

/** Saved copies go into this folder in My files. */
export const FOLDER = "Whiteboards";
/** The largest file opened from Drive as a board. */
export const MAX_OPEN_BYTES = 50 * 1024 * 1024;

type Env = NodeJS.ProcessEnv;

/** Where Drive is from this server: DRIVE_INTERNAL_URL, else the compose host in production, else localhost. */
export function driveInternalUrl(env: Env = process.env): string {
  const u = env.DRIVE_INTERNAL_URL || (env.NODE_ENV === "production" ? "http://drive:3180" : "http://localhost:3180");
  return u.replace(/\/+$/, "");
}

export function driveHeaders(me: Me, env: Env = process.env): Record<string, string> {
  const h: Record<string, string> = {
    "x-auth-request-email": me.email,
    "x-auth-request-preferred-username": me.name,
    "x-auth-request-user": me.email,
  };
  if (env.PROXY_SHARED_SECRET) h["x-proxy-auth-secret"] = env.PROXY_SHARED_SECRET;
  return h;
}

/** A board title as a file name Drive accepts. */
export function fileName(title: string, ext: string): string {
  const stem = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120) || "Whiteboard";
  return `${stem}.${ext}`;
}

export type DriveItem = { id: string; name: string; parentId: string | null; size: number; mime: string };

async function errorOf(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* not JSON */
  }
  return `Drive answered ${res.status}`;
}

async function call(path: string, init: RequestInit & { me: Me; timeoutMs?: number }, f: typeof fetch = fetch): Promise<Response> {
  const { me, timeoutMs = 30_000, ...rest } = init;
  try {
    return await f(`${driveInternalUrl()}${path}`, {
      ...rest,
      headers: { ...driveHeaders(me), ...(rest.headers as Record<string, string> | undefined) },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new UserError("Couldn't reach Drive. Try again in a moment.", 502);
  }
}

/** Saves `bytes` as Whiteboards/<name> in the person's Drive; saving again adds a version. */
export async function saveToDrive(me: Me, name: string, bytes: Uint8Array, contentType: string, f: typeof fetch = fetch): Promise<DriveItem & { url: string }> {
  const path = encodeURIComponent(`${FOLDER}/${name}`);
  const res = await call(`/api/upload?path=${path}`, { me, method: "PUT", body: bytes as BodyInit, headers: { "content-type": contentType, "content-length": String(bytes.byteLength) } }, f);
  if (!res.ok) throw new UserError(await errorOf(res), res.status === 413 ? 413 : 502);
  const item = (await res.json()) as DriveItem;
  const where = item.parentId ? `parent=${item.parentId}&` : "";
  return { ...item, url: `${appUrl("drive")}/?${where}preview=${item.id}` };
}

/** A file from the person's Drive (one they can open there), with its name. */
export async function readFromDrive(me: Me, itemId: string, f: typeof fetch = fetch): Promise<{ name: string; text: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new UserError("Not found", 404);
  const info = await call(`/api/items/${itemId}`, { me }, f);
  if (info.status === 404 || info.status === 403) throw new UserError("That file isn't in your Drive, or isn't shared with you", 404);
  if (!info.ok) throw new UserError(await errorOf(info), 502);
  const item = (await info.json()) as DriveItem;
  if (item.size > MAX_OPEN_BYTES) throw new UserError("That file is too big to open as a board", 413);
  const res = await call(`/api/items/${itemId}/content`, { me, timeoutMs: 60_000 }, f);
  if (!res.ok) throw new UserError(await errorOf(res), 502);
  return { name: item.name, text: await res.text() };
}
