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

/** The signed-in person with their CRM role; their first visit makes them a member. */
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
  if (code === "23505") return NextResponse.json({ error: "Something with that name is already there" }, { status: 409 });
  if (code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (code === "23503") return NextResponse.json({ error: "That refers to something that no longer exists" }, { status: 409 });
  console.error("[crm]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wraps a route: requires a signed-in user and turns errors into JSON responses. */
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

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const v = await req.json();
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new UserError("Bad request body");
  }
}

export type Params<K extends string> = { params: Promise<Record<K, string>> };

/** The list filters every list route takes. */
export function filters(req: Request) {
  const u = new URL(req.url);
  const s = (k: string) => (u.searchParams.get(k) ?? "").trim().slice(0, 200);
  const n = (k: string) => Math.max(0, Math.floor(Number(u.searchParams.get(k)) || 0));
  return {
    q: s("q"), type: s("type"), status: s("status"), source: s("source"), stage: s("stage"), accountId: s("accountId"),
    partnerId: s("partnerId"), mine: s("mine") === "1", unpaid: s("unpaid") === "1",
    industry: s("industry"), state: s("state"), offset: n("offset"), limit: n("limit") || undefined,
  };
}
