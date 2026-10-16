import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";
import { join } from "./members";
import type { Ctx } from "./types";
import { UserError } from "./util";

export type Me = { email: string; name: string };

export async function currentUser(): Promise<Me | null> {
  const who = identify(await headers(), optionsFromEnv());
  return who ? { email: who.email, name: who.name } : null;
}

/** The signed-in person with their Commerce role; their first visit makes them a member. */
export async function currentCtx(): Promise<Ctx | null> {
  const me = await currentUser();
  return me ? join(me.email, me.name) : null;
}

/**
 * A change sent from another site is refused. The suite's session cookie is shared across
 * its subdomains, so this also stops a page on another suite app from changing records here.
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
  const code = (err as { code?: string })?.code;
  if (code === "23505") return NextResponse.json({ error: "Something with that name or code is already there" }, { status: 409 });
  if (code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
  console.error("[commerce]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wraps a route: requires a signed-in member and turns errors into JSON responses. */
export function route<A extends unknown[]>(fn: (ctx: Ctx, req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
      const ctx = await currentCtx();
      if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      const out = await fn(ctx, req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return fail(err);
    }
  };
}

/** For the online store: shoppers are not signed in. Changes must still come from this site. */
export function publicRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
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
