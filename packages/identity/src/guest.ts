import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed links for people outside the organization (meeting guests, signers, form
 * respondents). They never sign in; the link itself carries a short-lived, tamper-proof
 * claim such as { room: "abc", name: "Pat" }.
 */
export type GuestClaims = Record<string, string | number | boolean>;

const b64 = (b: Buffer) => b.toString("base64url");

function sign(body: string, secret: string): string {
  return b64(createHmac("sha256", secret).update(body).digest());
}

export function signGuestToken(claims: GuestClaims, secret: string, ttlSeconds = 86400): string {
  if (!secret) throw new Error("guest token secret is required");
  const body = b64(Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `${body}.${sign(body, secret)}`;
}

/** Returns the claims, or null if the token is malformed, forged or expired. */
export function verifyGuestToken(token: string, secret: string): (GuestClaims & { exp: number }) | null {
  if (!secret || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}
