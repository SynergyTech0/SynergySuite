import { NextResponse } from "next/server";
import { clientIp } from "./api";
import { allow } from "./ratelimit";
import { UserError } from "./util";
import { originAllowed } from "./widgets";

/**
 * The widget's API is called from other websites. Each answer allows only the page's own origin
 * to read it, and only when that origin is on the widget's domain.
 */
export function cors(origin: string | null): Record<string, string> {
  return origin
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "Origin" }
    : {};
}

export function wcJson(req: Request, data: unknown, status = 200): Response {
  return NextResponse.json(data, { status, headers: cors(req.headers.get("origin")) });
}

export function checkOrigin(req: Request, domain: string): void {
  if (!originAllowed(req.headers.get("origin"), domain)) throw new UserError("This chat isn't available on this site", 403);
}

export function limitIp(req: Request, what: string, max: number, windowMs: number): void {
  if (!allow(`${what}:${clientIp(req)}`, max, windowMs)) throw new UserError("Too many messages. Please wait a moment.", 429);
}

/** Wraps a widget route: JSON errors with the CORS headers, so the widget can show them. */
export function wcRoute(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      return wcJson(req, await fn(req));
    } catch (err) {
      if (err instanceof UserError) return wcJson(req, { error: err.message }, err.status);
      console.error("[livechat] widget:", (err as Error).message);
      return wcJson(req, { error: "Something went wrong" }, 500);
    }
  };
}

export const preflight = async (req: Request) => new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
