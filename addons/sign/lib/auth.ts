import { headers } from "next/headers";
import { identify, optionsFromEnv, type HeaderSource } from "@synergy/identity";
import type { SubscriptionStatus, SubscriptionTier, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publicBase } from "@/lib/urls";

export { publicBase };

/**
 * Who is signed in to Sign.
 *
 * Sign has two kinds of people and keeps them apart:
 *   - SENDERS work here. They sign in to the suite; the gateway checks their session and passes
 *     who they are in headers (see @synergy/identity). Sign runs no login of its own.
 *   - SIGNERS are often outside the organization. They open a /sign/<token> link from their email
 *     and never sign in; the gateway lets those paths through without a session (deploy/Caddyfile)
 *     and the token is their only key (lib/access.ts).
 *
 * A suite person is matched to a Sign user by email, so accounts made before Sign joined the
 * suite keep their documents and templates. Someone new gets a user the first time they open Sign.
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  verified: boolean;
  enterpriseId: string | null;
  isEnterpriseAdmin: boolean;
  subscription?: { tier: SubscriptionTier; status: SubscriptionStatus; currentPeriodEnd: Date | null };
};

export type Session = { user: SessionUser };

/**
 * Kept so the many routes written as `getServerSession(authOptions)` read the same as before;
 * there is nothing to configure any more.
 */
export const authOptions = Object.freeze({ provider: "suite-gateway" as const });

/** SIGN_ADMIN_EMAILS: comma-separated suite accounts that get Sign's admin pages. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.SIGN_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The person the gateway vouches for on this request, or null. */
export function gatewayIdentity(h: HeaderSource) {
  return identify(h, optionsFromEnv());
}

const userInclude = {
  subscription: true,
  enterprise: { select: { id: true, subscription: true, administratorId: true } },
} as const;

/** Finds the Sign user for a suite email (any letter case), creating one on first visit. */
export async function userForEmail(email: string, name: string) {
  const lower = email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({
    where: { email: { equals: lower, mode: "insensitive" } },
    include: userInclude,
    orderBy: { createdAt: "asc" },
  });
  const admin = adminEmails().has(lower);
  if (existing) {
    const patch: { emailVerified?: Date; name?: string; role?: UserRole } = {};
    if (!existing.emailVerified) patch.emailVerified = new Date();
    if (!existing.name && name) patch.name = name;
    if (admin && existing.role !== "ADMIN") patch.role = "ADMIN";
    if (!Object.keys(patch).length) return existing;
    return prisma.user.update({ where: { id: existing.id }, data: patch, include: userInclude });
  }
  try {
    return await prisma.user.create({
      data: { email: lower, name: name || null, emailVerified: new Date(), role: admin ? "ADMIN" : "SENDER" },
      include: userInclude,
    });
  } catch (err) {
    // Two first requests at once: the other one made the user.
    if ((err as { code?: string }).code === "P2002") {
      return prisma.user.findUniqueOrThrow({ where: { email: lower }, include: userInclude });
    }
    throw err;
  }
}

/** The signed-in suite person as a Sign session, or null when nobody is signed in (e.g. a signer). */
export async function sessionFrom(h: HeaderSource): Promise<Session | null> {
  const who = gatewayIdentity(h);
  if (!who) return null;
  const user = await userForEmail(who.email, who.name);
  const sub = user.enterprise?.subscription ?? user.subscription;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name || who.name,
      role: user.role,
      verified: true,
      enterpriseId: user.enterpriseId ?? null,
      isEnterpriseAdmin: Boolean(user.enterprise && user.enterprise.administratorId === user.id),
      ...(sub ? { subscription: { tier: sub.tier, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd ?? null } } : {}),
    },
  };
}

/** Same call shape as next-auth's, so existing routes and pages keep working. */
export async function getServerSession(_options?: unknown): Promise<Session | null> {
  return sessionFrom(headers());
}

/** Where the suite's sign-in lives: https://sso.<SUITE_DOMAIN>. Empty when running without the gateway. */
export function ssoBase(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SSO_URL) return env.SSO_URL.replace(/\/$/, "");
  return env.SUITE_DOMAIN ? `https://sso.${env.SUITE_DOMAIN}` : "";
}


/** Only same-site paths, so a crafted link can't bounce someone elsewhere after sign-in. */
export function safePath(p: string | null | undefined): string {
  return p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : "/dashboard";
}

/** The suite sign-in, returning to `path` on Sign afterwards. */
export function signInUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const back = `${publicBase(env)}${safePath(path)}`;
  const sso = ssoBase(env);
  return sso ? `${sso}/oauth2/start?rd=${encodeURIComponent(back)}` : back;
}

/** Signs out of the whole suite, then lands on the suite home. */
export function signOutUrl(env: NodeJS.ProcessEnv = process.env): string {
  const sso = ssoBase(env);
  if (!sso) return "/";
  const home = env.SUITE_DOMAIN ? `https://${env.SUITE_DOMAIN}` : publicBase(env);
  return `${sso}/oauth2/sign_out?rd=${encodeURIComponent(home)}`;
}
