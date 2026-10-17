import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived links to stored files. A signer has no account, so the PDF viewer on their signing
 * page loads the document through a link that carries its own proof: the path and an expiry,
 * signed with SIGN_LINK_SECRET. Anyone holding the link can fetch that one file until it expires,
 * the same way a pre-signed S3 URL works.
 */

let fallback: string | undefined;

function secret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.SIGN_LINK_SECRET || env.PROXY_SHARED_SECRET;
  if (s) return s;
  // Without a configured secret, links stay valid only while this process runs.
  return (fallback ??= randomBytes(32).toString("hex"));
}

function mac(path: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${path}\n${exp}`).digest("base64url");
}

/** `?exp=…&sig=…` for `path`, valid for `seconds`. */
export function signFileQuery(path: string, seconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + Math.max(1, Math.floor(seconds));
  return `exp=${exp}&sig=${mac(path, exp)}`;
}

/** True when `sig` was made for `path` and `exp` hasn't passed. */
export function verifyFileQuery(path: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const e = Number(exp);
  if (e * 1000 < now) return false;
  const want = Buffer.from(mac(path, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
