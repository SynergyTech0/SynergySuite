import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";
import { complianceAuthorized } from "@synergy/compliance";
import { access, can, type Access } from "./access";
import type { Me } from "./types";
import { UserError } from "./util";

export type Who = { email: string; name: string };

export async function currentUser(): Promise<Who | null> {
  const who = identify(await headers(), optionsFromEnv());
  return who ? { email: who.email, name: who.name } : null;
}

/** The signed-in person and what they may do here. */
export async function currentAccess(): Promise<{ who: Who | null; access: Access }> {
  const who = await currentUser();
  if (!who) return { who: null, access: { kind: "none" } };
  return { who, access: await access(who.email) };
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

export function fail(err: unknown): Response {
  if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
  const code = (err as { code?: string })?.code;
  if (code === "23505") return NextResponse.json({ error: "Something with that name is already there" }, { status: 409 });
  if (code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (code === "23503") return NextResponse.json({ error: "That refers to something that no longer exists" }, { status: 409 });
  console.error("[admin]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export type Need = "people" | "apps" | "roles" | "audit" | "retention.edit" | "protection" | "compliance" | "migrate";

/** Wraps a route: requires a signed-in admin (or, for `compliance`, an eDiscovery manager) and turns errors into JSON. */
export function route<A extends unknown[]>(need: Need, fn: (me: Me, req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
      const { who, access: a } = await currentAccess();
      if (!who) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      if (a.kind === "setup") return NextResponse.json({ error: "The Admin center is not set up: set ADMIN_EMAILS" }, { status: 403 });
      if (a.kind !== "ok" || !can(a.role, need)) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
      const out = await fn({ ...who, role: a.role }, req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return fail(err);
    }
  };
}

/** For the internal feeds apps read: Bearer COMPLIANCE_TOKEN, no signed-in person. */
export function serviceRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (!complianceAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const out = await fn(req, ...rest);
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

export type Params<K extends string> = { params: Promise<Record<K, string>> };
