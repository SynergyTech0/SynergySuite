// Checking a phone's Basic sign-in. Phones can't do the suite's browser sign-in, so people make
// app passwords on their Account page; the account service (apps/auth) keeps them hashed and
// answers "is this right?" over the internal network, proven by PROXY_SHARED_SECRET. Answers are
// cached briefly (a revoked password stops working within `cacheMs`), and an address that keeps
// getting it wrong is turned away here before it reaches the account service, which has its own
// per-person and per-address lockout.
import { createHash } from "node:crypto";

export type VerifierOptions = {
  /** The app asking, for the account page's "last used" column (e.g. "calendar"). */
  app: string;
  /** Default AUTH_INTERNAL_URL, then http://auth:3500. */
  authUrl?: string;
  /** Default PROXY_SHARED_SECRET. */
  secret?: string;
  cacheMs?: number;
  /** Failures from one address before it is turned away for `blockMs`. */
  maxFailures?: number;
  blockMs?: number;
};

type Failures = { n: number; first: number; blockedUntil: number };

export function appPasswordVerifier(opts: VerifierOptions) {
  const cacheMs = opts.cacheMs ?? 60_000;
  const maxFailures = opts.maxFailures ?? 20;
  const blockMs = opts.blockMs ?? 10 * 60_000;
  const good = new Map<string, { email: string; until: number }>();
  const bad = new Map<string, Failures>();
  let warned = false;

  function fail(ip: string) {
    const now = Date.now();
    const f = bad.get(ip);
    if (!f || now - f.first > blockMs) {
      bad.set(ip, { n: 1, first: now, blockedUntil: 0 });
      return;
    }
    f.n++;
    if (f.n >= maxFailures) f.blockedUntil = now + blockMs;
  }

  return async function verify(username: string, password: string, ip: string): Promise<string | null> {
    const now = Date.now();
    if (good.size > 5000) for (const [k, v] of good) if (v.until < now) good.delete(k);
    if (bad.size > 5000) for (const [k, v] of bad) if (v.blockedUntil < now && now - v.first > blockMs) bad.delete(k);

    const key = createHash("sha256").update(`${username}\0${password}`).digest("hex");
    const hit = good.get(key);
    if (hit && hit.until > now) return hit.email;
    const f = bad.get(ip);
    if (f && f.blockedUntil > now) return null;

    const secret = opts.secret ?? process.env.PROXY_SHARED_SECRET ?? "";
    if (!secret) {
      if (!warned) console.error(`[${opts.app}] PROXY_SHARED_SECRET is not set: app passwords can't be checked, so phone sync is off`);
      warned = true;
      return null;
    }
    const base = (opts.authUrl ?? process.env.AUTH_INTERNAL_URL ?? "http://auth:3500").replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/internal/app-passwords/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-proxy-auth-secret": secret },
        body: JSON.stringify({ email: username, password, app: opts.app, ip }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as { email?: string };
        if (body.email) {
          good.set(key, { email: body.email.toLowerCase(), until: now + cacheMs });
          bad.delete(ip);
          return body.email.toLowerCase();
        }
      }
      if (res.status >= 500) {
        console.error(`[${opts.app}] app password check failed: ${res.status}`);
        return null;
      }
    } catch (e) {
      console.error(`[${opts.app}] app password check failed:`, (e as Error).message);
      return null;
    }
    fail(ip);
    return null;
  };
}
