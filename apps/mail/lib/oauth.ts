import { createHash, randomBytes } from "node:crypto";
import { open, seal } from "./secret";

/**
 * Microsoft 365 and Outlook.com accounts, signed in with Microsoft instead of a password.
 * Microsoft has turned off password sign-in to IMAP and SMTP for work accounts (including the
 * Microsoft 365 mail GoDaddy sells) and for Outlook.com, so Mail does what Thunderbird does: an
 * OAuth2 sign-in in the browser, then IMAP and SMTP with the access token (XOAUTH2). The refresh
 * token is kept encrypted like a password; access tokens live only in memory.
 *
 * Needs an app registration in Microsoft Entra: MAIL_MICROSOFT_CLIENT_ID and _CLIENT_SECRET, with
 * <MAIL_PUBLIC_URL>/api/oauth/microsoft/callback as its web redirect URI.
 */

type Env = Record<string, string | undefined>;

export const MICROSOFT_IMAP = { host: "outlook.office365.com", port: 993, secure: true };
export const MICROSOFT_SMTP = { host: "smtp.office365.com", port: 587, secure: false }; // STARTTLS

const MAIL_SCOPES = ["https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"];
const SCOPES = ["offline_access", "openid", "email", "profile", ...MAIL_SCOPES].join(" ");

export type MicrosoftConfig = { clientId: string; clientSecret: string; tenant: string; redirectUri: string };

export function microsoftConfig(env: Env = process.env): MicrosoftConfig | null {
  const clientId = env.MAIL_MICROSOFT_CLIENT_ID;
  const clientSecret = env.MAIL_MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, tenant: env.MAIL_MICROSOFT_TENANT || "common", redirectUri: `${publicUrl(env)}/api/oauth/microsoft/callback` };
}

/** Where people reach Mail, for the redirect URI registered with Microsoft. */
export function publicUrl(env: Env = process.env): string {
  const base = env.MAIL_PUBLIC_URL || (env.SUITE_DOMAIN ? `https://mail.${env.SUITE_DOMAIN}` : "http://localhost:3200");
  return base.replace(/\/+$/, "");
}

const authority = (c: MicrosoftConfig) => `https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0`;
const b64url = (b: Buffer) => b.toString("base64url");

// ---------- sign-in ----------

/** What the browser carries between start and callback, sealed in a short-lived cookie. */
type Pending = { state: string; verifier: string; user: string; exp: number };

export const PENDING_COOKIE = "mail_ms_oauth";
const PENDING_MS = 10 * 60 * 1000;

/** The Microsoft sign-in URL for this user, and the sealed cookie that must come back with it. */
export function startSignIn(c: MicrosoftConfig, user: string, loginHint?: string): { url: string; cookie: string } {
  const pending: Pending = { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(32)), user, exp: Date.now() + PENDING_MS };
  const u = new URL(`${authority(c)}/authorize`);
  u.search = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: c.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state: pending.state,
    code_challenge: b64url(createHash("sha256").update(pending.verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return { url: u.toString(), cookie: seal(JSON.stringify(pending)) };
}

/** The pending sign-in, if the cookie is ours, unexpired, for this user and this state. */
export function checkPending(cookie: string | undefined, user: string, state: string | null): Pending | null {
  if (!cookie || !state) return null;
  try {
    const p = JSON.parse(open(cookie)) as Pending;
    return p.user === user && p.state === state && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
export type SignedIn = Tokens & { address: string; name: string };

/** Trades the code from the callback for tokens, and reads who signed in from the ID token. */
export async function finishSignIn(c: MicrosoftConfig, code: string, verifier: string): Promise<SignedIn> {
  const t = await tokenRequest(c, { grant_type: "authorization_code", code, redirect_uri: c.redirectUri, code_verifier: verifier, scope: SCOPES });
  if (!t.refresh_token) throw new OAuthError("Microsoft didn't grant offline access");
  // The ID token came straight from Microsoft's token endpoint over TLS, so its claims are read
  // as is (OpenID Connect Core 3.1.3.7).
  const claims = idClaims(t.id_token);
  const address = String(claims.email || claims.preferred_username || "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw new OAuthError("Microsoft didn't say which mailbox you signed in to");
  return { address, name: String(claims.name || ""), ...tokens(t) };
}

export function idClaims(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== "string") return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

// ---------- access tokens ----------

/** Access tokens by account id, refreshed a few minutes before they run out. */
const cache = new Map<string, { token: string; expiresAt: number }>();
const inflight = new Map<string, Promise<Tokens>>();

/**
 * An access token for a connected account. Microsoft may hand back a new refresh token with
 * each refresh; onRotate saves it (sealed).
 */
export async function accessToken(
  id: string, sealedRefresh: string, onRotate: (sealed: string) => Promise<void>, c = microsoftConfig(),
): Promise<string> {
  const hit = cache.get(id);
  if (hit && hit.expiresAt - 5 * 60 * 1000 > Date.now()) return hit.token;
  if (!c) throw new OAuthError("Microsoft sign-in isn't set up on this server (MAIL_MICROSOFT_CLIENT_ID)");
  let run = inflight.get(id);
  if (!run) {
    run = refresh(c, open(sealedRefresh)).finally(() => inflight.delete(id));
    inflight.set(id, run);
  }
  const t = await run;
  cache.set(id, { token: t.accessToken, expiresAt: t.expiresAt });
  if (t.refreshToken) await onRotate(seal(t.refreshToken)).catch((err) => console.error("[mail] couldn't save a new Microsoft refresh token:", (err as Error).message));
  return t.accessToken;
}

export function forgetToken(id: string): void {
  cache.delete(id);
}

async function refresh(c: MicrosoftConfig, refreshToken: string): Promise<Tokens> {
  const t = await tokenRequest(c, { grant_type: "refresh_token", refresh_token: refreshToken, scope: ["offline_access", ...MAIL_SCOPES].join(" ") });
  return tokens(t);
}

type TokenResponse = { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string };

function tokens(t: TokenResponse): Tokens {
  return { accessToken: t.access_token!, refreshToken: t.refresh_token ?? "", expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
}

async function tokenRequest(c: MicrosoftConfig, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authority(c)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }).toString(),
  }).catch((err) => {
    throw new OAuthError(`Couldn't reach Microsoft: ${(err as Error).message}`);
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    // invalid_grant: the person revoked access, changed their password, or an admin did.
    const expired = body.error === "invalid_grant" || body.error === "interaction_required";
    throw new OAuthError(describe(body), expired);
  }
  return body;
}

/** Microsoft's error, first line only (the rest is trace and correlation ids). */
function describe(b: TokenResponse): string {
  const first = (b.error_description || "").split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, "").trim();
  return first || b.error || "Microsoft refused the sign-in";
}

/** expired: signing in with Microsoft again (Add account) fixes it. */
export class OAuthError extends Error {
  expired: boolean;
  constructor(message: string, expired = false) {
    super(message);
    this.expired = expired;
  }
}
