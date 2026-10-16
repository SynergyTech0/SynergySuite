import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";
import { UserError } from "./util";

export type Me = { email: string; name: string };

export async function currentUser(): Promise<Me | null> {
  const who = identify(await headers(), optionsFromEnv());
  return who ? { email: who.email, name: who.name } : null;
}

/**
 * A change sent from another site is refused. The suite's session cookie is shared across
 * its subdomains, so this also stops a page on another suite app from placing calls as you.
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
  console.error("[phone]", err);
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

/** Phone admins (trunks and numbers): PHONE_ADMIN_EMAILS, else the suite's ADMIN_EMAILS. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PHONE_ADMIN_EMAILS || env.ADMIN_EMAILS || "";
  const list = raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
  // A development install with nobody listed lets its one dev user set things up.
  if (!list.length && env.NODE_ENV !== "production" && env.DEV_USER_EMAIL) return [env.DEV_USER_EMAIL.toLowerCase()];
  return list;
}

export function isAdmin(me: Me, env: NodeJS.ProcessEnv = process.env): boolean {
  return adminEmails(env).includes(me.email.toLowerCase());
}

/** Like route(), for the admin pages. */
export function adminRoute<A extends unknown[]>(fn: (me: Me, req: Request, ...rest: A) => Promise<Response | unknown>) {
  return route<A>(async (me, req, ...rest) => {
    if (!isAdmin(me)) throw new UserError("Only phone admins can do this", 403);
    return fn(me, req, ...rest);
  });
}
