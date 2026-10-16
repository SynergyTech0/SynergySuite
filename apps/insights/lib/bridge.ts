import { createHmac, timingSafeEqual } from "node:crypto";
import { type InsightsConfig, derive, embeddingKey } from "./config";

/**
 * The sign-in bridge. The report designer (Metabase's own interface) is served at
 * INSIGHTS_STUDIO_PATH on Insights' host, behind the suite gateway like every app, so only
 * signed-in people reach it. Metabase's open source edition can't take the suite's sign-in
 * itself, so Insights signs each person in to Metabase for them and sets Metabase's session
 * cookie.
 *
 * The gateway checks one more thing on every request to the designer (Caddy forward_auth to
 * /api/studio/check): the Metabase session in the browser must be the one Insights opened for
 * the person the gateway says is signed in. Insights proves that with its own cookie, an HMAC
 * of the email and the Metabase session id. So after someone signs out of the suite and
 * someone else signs in on the same browser, the old Metabase session is never used: the
 * check fails and the bridge signs the new person in.
 */

export const MB_SESSION_COOKIE = "metabase.SESSION";
export const BRIDGE_COOKIE = "synergy_insights";

function key(c: InsightsConfig): string {
  return derive(c.secret, "bridge-cookie");
}

export function bridgeValue(c: InsightsConfig, email: string, sessionId: string): string {
  return createHmac("sha256", key(c)).update(`${email.toLowerCase()}\n${sessionId}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** True when the browser's Metabase session belongs to this person. */
export function bridgeMatches(c: InsightsConfig, email: string, cookieHeader: string | null): boolean {
  const session = readCookie(cookieHeader, MB_SESSION_COOKIE);
  const proof = readCookie(cookieHeader, BRIDGE_COOKIE);
  if (!session || !proof) return false;
  return safeEqual(proof, bridgeValue(c, email, session));
}

/**
 * Where to send someone after signing them in: a path inside the designer, or the designer's
 * home. Never another site, and never a path outside the designer.
 */
export function safeReturn(c: InsightsConfig, rd: string | null | undefined): string {
  const home = c.studioPath + "/";
  if (!rd) return home;
  let path = rd;
  try {
    const u = new URL(rd, "https://insights.invalid");
    // A full URL is only accepted for its path; the host is always this app's own.
    path = u.pathname + u.search + u.hash;
  } catch {
    return home;
  }
  if (path.startsWith("//") || path.includes("\\")) return home;
  if (path !== c.studioPath && !path.startsWith(c.studioPath + "/")) return home;
  return path;
}

/** The cookies the bridge sets: Metabase's own session cookie, and Insights' proof beside it. */
export function bridgeCookies(c: InsightsConfig, email: string, sessionId: string, secure: boolean): string[] {
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return [
    `${MB_SESSION_COOKIE}=${sessionId}; ${attrs}`,
    `${BRIDGE_COOKIE}=${bridgeValue(c, email, sessionId)}; ${attrs}`,
    // Metabase's interface reads this to know the session is alive.
    `metabase.TIMEOUT=alive; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`,
  ];
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** An HS256 JWT, as Metabase's static embedding expects. */
export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/**
 * How long a signed dashboard address works. Every filter change and refresh inside the embed
 * uses it, so it covers a working day; the page reloads the dashboard with a new one after that.
 */
export const EMBED_SECONDS = 8 * 3600;

/**
 * The address of a dashboard drawn by Metabase's static embedding, signed with the key
 * Insights gave Metabase. Only signed for someone Metabase has already let open the dashboard.
 * The "Powered by Metabase" credit in the embed stays: removing it is a paid Metabase feature.
 */
export function embedUrl(c: InsightsConfig, dashboardId: number, now = Date.now()): { url: string; expires: number } {
  const exp = Math.floor(now / 1000) + EMBED_SECONDS;
  const token = signJwt({ resource: { dashboard: dashboardId }, params: {}, exp }, embeddingKey(c));
  return { url: `${c.studioPath}/embed/dashboard/${token}#bordered=false&titled=false`, expires: exp * 1000 };
}
