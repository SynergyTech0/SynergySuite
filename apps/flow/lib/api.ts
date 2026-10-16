import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv, type Identity } from "@synergy/identity";
import { EngineError } from "./engine";
import { UserError } from "./util";

export type Viewer = Identity;

/** The signed-in person, for server components. */
export async function currentUser(): Promise<Viewer | null> {
  return identify(await headers(), optionsFromEnv());
}

/**
 * A request sent from another site is refused. The suite's session cookie is shared across its
 * subdomains, so this also stops a page on another suite app from acting as the person.
 */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") || req.headers.get("host"));
  } catch {
    return false;
  }
}

export function fail(err: unknown): Response {
  if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof EngineError) {
    console.error("[flow] engine:", err.status, err.message);
    return NextResponse.json({ error: err.status >= 500 ? "The flow engine isn't available right now" : err.message }, { status: err.status >= 500 ? 503 : 400 });
  }
  console.error("[flow]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wraps a route: requires a signed-in person (from the gateway headers) and turns errors into JSON. */
export function route<C = unknown>(fn: (me: Viewer, req: Request, ctx: C) => Promise<Response | unknown>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
      const me = identify(req.headers, optionsFromEnv());
      if (!me) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      const out = await fn(me, req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return fail(err);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const v = await req.json();
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new UserError("Bad request body");
  }
}

/** The designer's public address. */
export function studioUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FLOW_STUDIO_URL) return env.FLOW_STUDIO_URL.replace(/\/+$/, "");
  return env.SUITE_DOMAIN ? `https://flow-studio.${env.SUITE_DOMAIN}` : "http://localhost:8080";
}

/** A link that signs the person in to the designer, then opens `next` (a path in the designer). */
export function studioLink(next = "/", env: NodeJS.ProcessEnv = process.env): string {
  return `${studioUrl(env)}/synergy/sso?next=${encodeURIComponent(next)}`;
}

/** Only paths inside the designer; anything else opens its home page. */
export function safeNext(v: string | null): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\u0000-\u001F\s]/.test(v)) return "/";
  return v.slice(0, 500);
}
