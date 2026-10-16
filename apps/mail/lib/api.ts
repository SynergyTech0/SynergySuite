import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";
import { type Account, UserError, getAccount } from "./accounts";
import { ensureMailbox } from "./provision";
import { q } from "./db";

export async function currentUser(): Promise<{ email: string; name: string } | null> {
  const who = identify(await headers(), optionsFromEnv());
  return who ? { email: who.email, name: who.name } : null;
}

type Ctx = { user: string; name: string };

/** Wraps a route: requires a signed-in user and turns errors into JSON responses. */
export function route<A extends unknown[]>(fn: (ctx: Ctx, req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      const who = await currentUser();
      if (!who) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      const out = await fn({ user: who.email, name: who.name }, req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[mail]", err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function accountFor(ctx: Ctx, id: string | null): Promise<Account> {
  const acct = id ? await getAccount(ctx.user, id, ctx.name) : null;
  if (!acct) throw new UserError("No such account", 404);
  if (acct.id === "suite") {
    await ensureMailbox(ctx.user, ctx.name);
    await noteSuiteUser(ctx.user);
  }
  return acct;
}

/** Remembers who uses a suite mailbox, so eDiscovery can find it without the mail server's admin API. */
const noted = new Set<string>();
async function noteSuiteUser(email: string): Promise<void> {
  if (noted.has(email)) return;
  await q("INSERT INTO mail_users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET last_seen = now()", [email.toLowerCase()])
    .then(() => noted.add(email), (err) => console.error("[mail] couldn't note mailbox user", err));
}

export function param(url: URL, name: string): string {
  const v = url.searchParams.get(name);
  if (!v) throw new UserError(`Missing ${name}`);
  return v;
}

export function uidParam(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new UserError("Bad message id");
  return n;
}
