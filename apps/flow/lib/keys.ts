import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Everything Flow needs to keep secret is derived from FLOW_SECRET, so Flow itself stores
 * nothing: the password of each person's account in the flow engine, the engine's service
 * account, and each person's Synergy key (what the Synergy piece sends back to act as them).
 * Rotating FLOW_SECRET revokes every key at once; see deploy/README.md for what else it resets.
 */

const KEY_PREFIX = "sfk1";

export function flowSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.FLOW_SECRET || "";
  if (s.length < 16) throw new Error("FLOW_SECRET must be set (at least 16 characters)");
  return s;
}

function mac(purpose: string, value: string, env?: NodeJS.ProcessEnv): Buffer {
  return createHmac("sha256", flowSecret(env)).update(`${purpose}\u0000${value}`).digest();
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** The password of a person's account in the engine. Never shown to anyone. */
export function enginePassword(email: string, env?: NodeJS.ProcessEnv): string {
  // Long and mixed, so it passes any password rule the engine applies.
  return `Sf1-${mac("engine-password", email.toLowerCase(), env).toString("base64url")}`;
}

/** The engine's service account, which installs the Synergy piece. */
export function serviceAccount(env: NodeJS.ProcessEnv = process.env) {
  const domain = (env.SUITE_DOMAIN || "synergy.local").toLowerCase();
  return { email: `flow-service@${domain}`, password: enginePassword(`service@${domain}`, env) };
}

export interface KeyOwner {
  email: string;
  /** The sign-in subject the gateway passes as X-Auth-Request-User; some apps key people on it. */
  subject: string;
  name: string;
}

/**
 * The Synergy key the piece uses to act as this person. It carries who they are (the email,
 * sign-in subject and name the gateway gave when they last opened the designer) and a MAC over it.
 */
export function personKey(who: KeyOwner, env?: NodeJS.ProcessEnv): string {
  const body = b64url(JSON.stringify({ e: who.email.toLowerCase(), s: who.subject || who.email.toLowerCase(), n: who.name || "" }));
  return `${KEY_PREFIX}.${body}.${mac("person-key", body, env).toString("base64url")}`;
}

/** The person a Synergy key belongs to, or null for anything that isn't a valid key. */
export function keyOwner(key: string, env?: NodeJS.ProcessEnv): KeyOwner | null {
  const parts = key.split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX || !parts[1] || parts[1].length > 2000) return null;
  const want = mac("person-key", parts[1], env);
  const got = Buffer.from(parts[2], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof v?.e !== "string" || !v.e.includes("@")) return null;
    return { email: v.e, subject: typeof v.s === "string" && v.s ? v.s : v.e, name: typeof v.n === "string" ? v.n : "" };
  } catch {
    return null;
  }
}
