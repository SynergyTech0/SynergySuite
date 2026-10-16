import { headers } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cameThroughGateway, identify, optionsFromEnv } from "@synergy/identity";

/**
 * Session seam. In production SynergyBoards runs behind oauth2-proxy → SynergyAuth (same pattern as
 * SynergyDrive): the proxy authenticates the user and forwards their identity in headers. We key the
 * Boards user row on the OIDC subject (X-Forwarded-User) and provision it on first sight. Every API
 * route resolves identity here and nowhere else, so this is the only seam.
 *
 * THE TRUST BOUNDARY. These headers are only meaningful because oauth2-proxy sets them and the app's
 * origin is not reachable without passing through it. Nothing in an HTTP header proves that, so:
 *
 *  - Set PROXY_SHARED_SECRET (and have the proxy send it as X-Proxy-Auth-Secret) and the identity
 *    headers are trusted ONLY on requests carrying the matching secret. This is the real fix for
 *    anyone who can reach the origin directly — another service on the same network, an SSRF, or a
 *    misconfigured load balancer — being able to claim any identity by setting one header.
 *  - Leave it unset and behaviour is unchanged, so this can ship before the proxy config does.
 *
 * The local-dev fallback identity is refused in production: a request that arrives with no identity
 * used to be silently authenticated as "dev-local", which fails open exactly when it matters.
 */
const DEV_SUB = "dev-local";

export type SessionUser = typeof users.$inferSelect;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** The caller, or null when this request carries no identity we are willing to trust. */
export async function getCurrentUserOrNull(): Promise<SessionUser | null> {
  let sub: string | null = null;
  let email = "dev@example.com";
  let name = "Dev User";

  try {
    const h = await headers();
    const opts = { ...optionsFromEnv(), devUser: "" };
    // When a shared secret is configured, an unsigned request is not merely anonymous — it is
    // someone talking to the origin directly, so refuse it rather than fall back to anything.
    if (!cameThroughGateway(h, opts.proxySecret)) return null;
    const who = identify(h, opts);
    if (who) {
      sub = who.subject;
      email = who.email;
      name = who.name;
    }
  } catch {
    // headers() unavailable (e.g. a non-request context such as a script or a test)
  }

  if (!sub) {
    if (isProduction()) return null;
    sub = DEV_SUB;
  }

  const existing = await db.query.users.findFirst({ where: eq(users.authSub, sub) });
  if (existing) return existing;
  // A first page load resolves identity from several requests at once, and every one of them can
  // miss the lookup above. Let the unique constraint pick a winner rather than throwing a 500 at a
  // new user's first visit; the losers read back the row the winner wrote.
  const [u] = await db
    .insert(users)
    .values({ authSub: sub, email, name })
    .onConflictDoNothing({ target: users.authSub })
    .returning();
  return u ?? (await db.query.users.findFirst({ where: eq(users.authSub, sub) }))!;
}

/**
 * The caller. Throws when there is no trusted identity — callers that must answer 404/401 instead
 * should use getCurrentUserOrNull(). Kept so existing call sites read unchanged.
 */
export async function getCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUserOrNull();
  if (!user) throw new Error("unauthenticated: no trusted identity on this request");
  return user;
}
