import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";
import { UserError } from "./util";

export type Me = { email: string; name: string; subject: string };

export async function currentUser(): Promise<Me | null> {
  const who = identify(await headers(), optionsFromEnv());
  return who ? { email: who.email, name: who.name, subject: who.subject } : null;
}

/**
 * A change sent from another site is refused. The suite's session cookie is shared across
 * its subdomains, so this also stops a page on another suite app from changing anything here.
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

function fail(err: unknown): Response {
  if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
  const code = (err as { code?: string })?.code;
  if (code === "23505") return NextResponse.json({ error: "Something with that name is already there" }, { status: 409 });
  if (code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
  console.error("[livechat]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wraps a route: requires a signed-in user and turns errors into JSON responses. */
export function route<A extends unknown[]>(fn: (me: Me, req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
      const me = await currentUser();
      if (!me) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      const out = await fn(me, req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return fail(err);
    }
  };
}

/** For share-link routes: nobody needs to be signed in. */
export function publicRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      const out = await fn(req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return fail(err);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new UserError("Bad request body");
  }
}

export type Params<K extends string> = { params: Promise<Record<K, string>> };

/** People who set up chat widgets: LIVECHAT_ADMIN_EMAILS (default ADMIN_EMAILS). Anyone signed in can answer chats. */
export function isAdmin(email: string): boolean {
  const list = (process.env.LIVECHAT_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** The visitor's address as the gateway saw it. Used only for rate limits. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") || "local").trim();
}

export function requireAdmin(me: Me): void {
  if (!isAdmin(me.email)) throw new UserError("Only LiveChat admins can change widgets", 403);
}
