import type { Viewer } from "../api";
import { appName, internalUrl, viewerHeaders } from "../fanout";

/**
 * Calls a suite app's own API as the signed-in person, the way the gateway would: the person's
 * identity headers plus PROXY_SHARED_SECRET. Each app then applies its normal checks (membership,
 * sharing, roles), so Copilot can only do what the person could do in that app themselves.
 */

export interface AppDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class AppCallError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export async function callApp<T = unknown>(
  app: string,
  viewer: Viewer,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  deps: AppDeps = {},
): Promise<T> {
  const env = deps.env ?? process.env;
  const f = deps.fetch ?? fetch;
  const ms = deps.timeoutMs ?? 8000;
  const name = appName(app);
  let res: Response;
  try {
    res = await f(`${internalUrl(app, env)}${path}`, {
      method,
      headers: viewerHeaders(viewer, env),
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: AbortSignal.timeout(ms),
      redirect: "manual",
    });
  } catch {
    throw new AppCallError(`${name} didn't answer. Try again in a moment.`);
  }
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const said = typeof (data as { error?: unknown })?.error === "string" ? String((data as { error: string }).error).slice(0, 200) : "";
    if (res.status === 401) throw new AppCallError(`${name} didn't accept your sign-in (check PROXY_SHARED_SECRET).`, 502);
    if (res.status === 403) throw new AppCallError(`${name} says you can't do that there${said ? `: ${said}` : "."}`, 403);
    if (res.status === 404) throw new AppCallError(`${name} couldn't find that${said ? `: ${said}` : "."}`, 404);
    if (res.status >= 400 && res.status < 500) throw new AppCallError(`${name} refused it${said ? `: ${said}` : "."}`, 400);
    throw new AppCallError(`${name} had a problem (${res.status}).`);
  }
  return data as T;
}
