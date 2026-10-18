import { createHash, randomBytes } from "node:crypto";
import { q } from "./db";

/** What the tracking script sends: site key, kind, event name, page address, referrer, screen width. */
export type Beacon = { k?: unknown; kind?: unknown; name?: unknown; u?: unknown; r?: unknown; w?: unknown };

const BOTS = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|go-http-client|httpclient|facebookexternalhit|embedly/i;

export function isBot(ua: string): boolean {
  return !ua || BOTS.test(ua);
}

/** The host a visit came from, without "www."; blank for direct visits or bad input. */
export function refHost(ref: unknown): string {
  try {
    return new URL(String(ref ?? "")).hostname.replace(/^www\./, "").slice(0, 200);
  } catch {
    return "";
  }
}

/** The path of a page address, without its query string or fragment (which can carry personal data). */
export function cleanPath(u: unknown): string {
  try {
    return new URL(String(u ?? "")).pathname.slice(0, 300) || "/";
  } catch {
    return String(u ?? "/").split(/[?#]/)[0].slice(0, 300) || "/";
  }
}

export function deviceFor(width: unknown): string {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return "";
  return w < 768 ? "mobile" : w < 1200 ? "tablet" : "desktop";
}

/** The host a site was entered with: "https://www.example.com/x" becomes "www.example.com". */
export function cleanDomain(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .slice(0, 200);
}

/**
 * True when a beacon from `origin` may count for a site on `domain`: the domain itself, "www."
 * in front of it, or a subdomain. A site with no domain takes beacons from anywhere.
 */
export function originMatches(origin: string | null, domain: string): boolean {
  const want = cleanDomain(domain).replace(/^www\./, "");
  if (!want) return true;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === want || host.endsWith(`.${want}`);
}

const g = globalThis as unknown as { __analyticsSalt?: { day: string; salt: string } };

/**
 * Today's salt (UTC day). It is kept in the database so every replica counts the same visitor
 * once, and yesterday's is deleted as soon as today's exists.
 */
export async function dailySalt(now = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  if (g.__analyticsSalt?.day === day) return g.__analyticsSalt.salt;
  await q(`INSERT INTO salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING`, [day, randomBytes(16).toString("hex")]);
  const [row] = await q<{ salt: string }>(`SELECT salt FROM salts WHERE day = $1`, [day]);
  await q(`DELETE FROM salts WHERE day < $1`, [day]);
  g.__analyticsSalt = { day, salt: row.salt };
  return row.salt;
}

export function visitorHash(salt: string, siteId: string, ip: string, ua: string): string {
  return createHash("sha256").update(`${salt}|${siteId}|${ip}|${ua}`).digest("hex").slice(0, 24);
}

/**
 * Records one beacon. Returns what happened, for tests; the collector answers 204 either way so
 * a page never learns whether its key, origin or browser was accepted.
 */
export async function record(
  b: Beacon,
  ctx: { ip: string; ua: string; origin: string | null; now?: Date },
): Promise<"ok" | "bot" | "unknown-site" | "wrong-origin"> {
  if (isBot(ctx.ua)) return "bot";
  const key = String(b.k ?? "").slice(0, 64);
  if (!key) return "unknown-site";
  const [site] = await q<{ id: string; domain: string }>(`SELECT id::text, domain FROM sites WHERE site_key = $1`, [key]);
  if (!site) return "unknown-site";
  if (!originMatches(ctx.origin, site.domain)) return "wrong-origin";
  const kind = b.kind === "event" ? "event" : "pageview";
  const name = kind === "event" ? String(b.name ?? "").trim().slice(0, 120) || "event" : "pageview";
  const salt = await dailySalt(ctx.now);
  await q(
    `INSERT INTO events (site_id, kind, name, path, ref_host, visitor, device, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [site.id, kind, name, cleanPath(b.u), refHost(b.r), visitorHash(salt, site.id, ctx.ip, ctx.ua), deviceFor(b.w), ctx.now ?? new Date()],
  );
  return "ok";
}
