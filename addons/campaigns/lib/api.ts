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

/** The signed-in person with their Campaigns role; their first visit makes them a member. */
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
  if (code === "23505") return NextResponse.json({ error: "That is already there" }, { status: 409 });
  if (code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (code === "23503") return NextResponse.json({ error: "That refers to something that no longer exists" }, { status: 409 });
  console.error("[campaigns]", err);
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

/** A public page's HTML response (signup form, unsubscribe and confirmation pages). */
export function htmlPage(title: string, inner: string, status = 200): Response {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#f4f5f7;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2328}
main{max-width:460px;margin:64px auto;background:#fff;border:1px solid #e3e5e9;border-radius:10px;padding:28px}
h1{font-size:20px;margin:0 0 10px}p{margin:0 0 14px}.muted{color:#6b7280;font-size:13px}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}input[type=text],input[type=email]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d0d4da;border-radius:6px;font:inherit}
button{margin-top:16px;background:#0f6cbd;color:#fff;border:0;border-radius:6px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:#fff;color:#1f2328;border:1px solid #d0d4da;margin-left:6px}.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}
.hp{position:absolute;left:-9999px}</style></head><body><main>${inner}</main></body></html>`;
  return new Response(doc, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
