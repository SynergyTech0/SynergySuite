import { appUrl, getApp } from "@synergy/config";
import { UserError } from "./util";

/**
 * The other suite apps Field Service works with, each over its service API with a shared token:
 * - Commerce (COMMERCE_SVC_TOKEN) owns stock: parts are looked up there and
 *   every part used on a job is sent back so it comes off the shelf.
 * - Books (BOOKS_SVC_TOKEN) gets a draft invoice for each finished job.
 * - Desk (DESK_API_TOKEN) is where support cases live: a case can become a work
 *   order, and the case hears when a technician is booked and when the job is done.
 * - Ops (OPS_API_TOKEN) keeps the asset register equipment can be imported from.
 * A link is on when its token is set. Each app is found at its compose service name (or localhost
 * in development); FIELD_COMMERCE_URL, BOOKS_INTERNAL_URL, FIELD_DESK_URL and FIELD_OPS_URL
 * point elsewhere. Without a token that part of Field Service is off or kept locally.
 */
export type Link = "commerce" | "books" | "desk" | "ops";

type Conf = { url: string; token: string };

/** The app on the internal network: the compose service in production, localhost otherwise. */
function internal(id: Link, override: string | undefined, env: NodeJS.ProcessEnv): string {
  if (override) return override.replace(/\/+$/, "");
  const port = getApp(id).port;
  return env.NODE_ENV === "production" ? `http://${id}:${port}` : `http://localhost:${port}`;
}

export function linkConf(link: Link, env: NodeJS.ProcessEnv = process.env): Conf {
  switch (link) {
    case "commerce":
      return { url: internal("commerce", env.FIELD_COMMERCE_URL, env), token: env.COMMERCE_SVC_TOKEN || "" };
    case "books":
      return { url: internal("books", env.BOOKS_INTERNAL_URL, env), token: env.FIELD_BOOKS_TOKEN || env.BOOKS_SVC_TOKEN || "" };
    case "desk":
      return { url: internal("desk", env.FIELD_DESK_URL, env), token: env.DESK_API_TOKEN || "" };
    case "ops":
      return { url: internal("ops", env.FIELD_OPS_URL, env), token: env.OPS_API_TOKEN || "" };
  }
}

/** A link is on when its token is set. */
export function linked(link: Link, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!linkConf(link, env).token;
}

const NAMES: Record<Link, string> = { commerce: "Commerce", books: "Books", desk: "Desk", ops: "Ops" };

const g = globalThis as unknown as { __fieldFetch?: typeof fetch };

/** Swaps the HTTP client used for every link, for tests. */
export function setLinkFetch(f: typeof fetch | undefined): void {
  g.__fieldFetch = f;
}

/** Calls another app's service API. Failures become a UserError naming the app. */
export async function call<T>(link: Link, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = linkConf(link);
  if (!c.token) throw new UserError(`${NAMES[link]} isn't linked`, 400);
  const doFetch = g.__fieldFetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${c.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${c.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UserError(`${NAMES[link]} didn't answer. Try again in a moment.`, 502);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string | string[] };
  if (!res.ok) {
    if (res.status === 401) throw new UserError(`${NAMES[link]} refused the request: check the token matches on both apps`, 502);
    if (res.status === 404) throw new UserError(`${NAMES[link]}: ${String(data.error || data.message || "not found")}`, 404);
    const why = Array.isArray(data.message) ? data.message.join("; ") : data.error || data.message;
    throw new UserError(`${NAMES[link]} refused it${why ? `: ${why}` : ` (${res.status})`}`, res.status === 409 ? 409 : 502);
  }
  return data as T;
}

/** Where a person opens each linked app, for links on the screens. */
export function openUrls(env: NodeJS.ProcessEnv = process.env) {
  return {
    books: `${appUrl("books", env)}/invoices`,
    desk: appUrl("desk", env),
    commerce: appUrl("commerce", env),
    ops: appUrl("ops", env),
  };
}
