import { timingSafeEqual } from "node:crypto";

export type Identity = {
  email: string;
  name: string;
  /** Stable OIDC subject from the gateway (X-Auth-Request-User); the email when none was sent. */
  subject: string;
};

/** Node's IncomingHttpHeaders, or a Fetch/Next.js `Headers` object. */
export type HeaderSource =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

export type IdentifyOptions = {
  /** Fallback user for local development (DEV_USER_EMAIL or DEV_EMAIL). Ignored in production. */
  devUser?: string;
  /** Per-request dev override, e.g. a `?as=` query param. Only honoured when a devUser is set. */
  devOverride?: string | null;
  /**
   * When set, requests must carry `x-proxy-auth-secret` with this value or they are refused,
   * so a request that reaches the app without passing through the auth proxy cannot claim
   * an identity by setting the headers itself.
   */
  proxySecret?: string;
  production?: boolean;
};

function header(h: HeaderSource, name: string): string {
  if (typeof (h as { get?: unknown }).get === "function") {
    return (h as { get(name: string): string | null }).get(name) ?? "";
  }
  const v = (h as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * True when no proxy secret is configured, or the request carries the matching
 * X-Proxy-Auth-Secret. False means the request did not come through the gateway.
 */
export function cameThroughGateway(h: HeaderSource, proxySecret: string | undefined): boolean {
  return !proxySecret || safeEqual(header(h, "x-proxy-auth-secret"), proxySecret);
}

/** "jane.doe@x.com" -> "Jane Doe" */
export function displayNameFromEmail(email: string): string {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): IdentifyOptions {
  return {
    devUser: env.DEV_USER_EMAIL || env.DEV_EMAIL || "",
    proxySecret: env.PROXY_SHARED_SECRET || "",
    production: env.NODE_ENV === "production",
  };
}

/**
 * Who is making this request. Every suite app sits behind oauth2-proxy (OIDC against
 * SynergyAuth), which sets X-Auth-Request-* / X-Forwarded-* headers on each request.
 * Returns null when nobody is signed in.
 */
export function identify(h: HeaderSource, opts: IdentifyOptions = optionsFromEnv()): Identity | null {
  if (!cameThroughGateway(h, opts.proxySecret)) return null;

  let email = header(h, "x-auth-request-email") || header(h, "x-forwarded-email");
  const subject = header(h, "x-auth-request-user") || header(h, "x-forwarded-user");
  let name =
    header(h, "x-auth-request-preferred-username") ||
    header(h, "x-forwarded-preferred-username") ||
    subject;

  if (!email && opts.devUser && !opts.production) {
    email = header(h, "x-dev-user") || opts.devOverride || opts.devUser;
  }

  email = email.toLowerCase().trim();
  if (!email.includes("@")) return null;
  if (!name || name.includes("@")) name = displayNameFromEmail(email);
  return { email, name, subject: subject || email };
}
