import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";

/**
 * SynergyMeet's two identities:
 *   - STAFF are signed in to the suite. The gateway checks their session and passes who they are
 *     (see @synergy/identity); Meet never runs its own login.
 *   - EXTERNAL ATTENDEES never sign in. The gateway lets them through with no identity, and they
 *     join an existing room as a named guest (see /api/token).
 */
export type Session = { user: { email: string; name: string } };

/** The signed-in staff member, or null for a guest. */
export async function getServerSession(): Promise<Session | null> {
  const who = identify(await headers(), optionsFromEnv());
  return who ? { user: { email: who.email, name: who.name } } : null;
}

/** Where the suite's sign-in lives: https://sso.<SUITE_DOMAIN>. Empty when running without the gateway. */
export function ssoBase(): string {
  const domain = process.env.SUITE_DOMAIN;
  return domain ? `https://sso.${domain}` : "";
}
