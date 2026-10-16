import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv, type Identity } from "@synergy/identity";
import { UserError } from "./util";

export type Viewer = Identity;

/** The signed-in person, for server components. */
export async function currentUser(): Promise<Viewer | null> {
  return identify(await headers(), optionsFromEnv());
}

/**
 * A request sent from another site is refused. The suite's session cookie is shared across its
 * subdomains, so this also stops a page on another suite app from searching as the person.
 */
function sameOrigin(req: Request): boolean {
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
  console.error("[search]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wraps a route: requires a signed-in person (from the gateway headers) and turns errors into JSON. */
export function route(fn: (me: Viewer, req: Request) => Promise<Response | unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
      const me = identify(req.headers, optionsFromEnv());
      if (!me) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      const out = await fn(me, req);
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
