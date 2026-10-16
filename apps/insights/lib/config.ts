import { createHmac } from "node:crypto";

/**
 * Synergy Insights runs Metabase (the AGPL open source edition) as its engine and keeps no
 * database of its own. Everything it needs to remember is either in Metabase or derived from
 * INSIGHTS_SECRET: each person's Metabase password, the service account's password, the
 * read-only database role's password and the signing key for embedded dashboards.
 */

export interface InsightsConfig {
  /** Where this app reaches Metabase on the compose network, e.g. http://metabase:3000. */
  metabaseUrl: string;
  /** The path Metabase is served at on this app's own host, e.g. /studio. */
  studioPath: string;
  secret: string;
  /** Metabase's own admin account, used by this app to set things up. */
  serviceEmail: string;
  admins: string[];
  /** People who may write their own queries. "*" means everyone. Admins always may. */
  analysts: string[] | "*";
  /** Suite databases offered as read-only data sources. */
  sources: string[];
  /** Postgres as a superuser, without a database name: postgres://postgres:pw@postgres:5432 */
  pgUrl: string;
  /** How Metabase reaches that Postgres (host and port as Metabase sees them). */
  pgHost: string;
  pgPort: number;
  readerRole: string;
  syncMinutes: number;
}

/** Business data a report is normally about. Mail, chat, notes and the sign-in database stay out. */
export const DEFAULT_SOURCES = ["books", "crm", "desk", "base", "planner", "forms", "trust"];

/** What each suite database is called in Metabase. */
export const SOURCE_NAMES: Record<string, string> = {
  books: "Books",
  crm: "CRM",
  desk: "Desk",
  base: "Base",
  planner: "Planner",
  forms: "Forms",
  trust: "Trust",
  todo: "To Do",
  contacts: "Contacts",
  calendar: "Calendar",
  drive: "Drive",
  office: "Office",
  sites: "Sites",
  people: "People",
  portal: "Portal",
};

export function emails(v: string | undefined): string[] {
  return (v ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

export function config(env: Record<string, string | undefined> = process.env): InsightsConfig {
  const domain = env.SUITE_DOMAIN || "example.com";
  const pg = env.INSIGHTS_PG_URL || "";
  let pgHost = "postgres";
  let pgPort = 5432;
  try {
    if (pg) {
      const u = new URL(pg);
      pgHost = u.hostname;
      pgPort = Number(u.port) || 5432;
    }
  } catch {
    /* reported when the sources are synced */
  }
  const analystsRaw = (env.INSIGHTS_ANALYST_EMAILS ?? "").trim();
  const sources = (env.INSIGHTS_SOURCES ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    metabaseUrl: (env.METABASE_INTERNAL_URL || "http://localhost:3000").replace(/\/+$/, ""),
    studioPath: "/" + (env.INSIGHTS_STUDIO_PATH || "studio").replace(/^\/+|\/+$/g, ""),
    secret: env.INSIGHTS_SECRET || "",
    serviceEmail: (env.INSIGHTS_SERVICE_EMAIL || `insights-service@${domain}`).toLowerCase(),
    admins: emails(env.INSIGHTS_ADMIN_EMAILS || env.ADMIN_EMAILS || env.SEED_ADMIN_EMAIL || env.DEV_USER_EMAIL),
    analysts: analystsRaw === "*" ? "*" : emails(analystsRaw),
    sources: (sources.length ? sources : DEFAULT_SOURCES).filter((s) => /^[a-z][a-z0-9_]*$/.test(s)),
    pgUrl: pg.replace(/\/[^/@]*$/, "").replace(/\/+$/, ""),
    pgHost: env.INSIGHTS_PG_HOST || pgHost,
    pgPort: Number(env.INSIGHTS_PG_PORT) || pgPort,
    readerRole: env.INSIGHTS_READER_ROLE || "insights_reader",
    syncMinutes: Number(env.INSIGHTS_SYNC_MINUTES) >= 0 && env.INSIGHTS_SYNC_MINUTES ? Number(env.INSIGHTS_SYNC_MINUTES) : 60,
  };
}

/** A value only this deployment can work out, from INSIGHTS_SECRET and a purpose. */
export function derive(secret: string, purpose: string): string {
  if (!secret) throw new Error("INSIGHTS_SECRET is not set");
  return createHmac("sha256", secret).update(purpose).digest("base64url");
}

/**
 * The Metabase password for one person. Nobody types it: the sign-in bridge uses it to open a
 * Metabase session for whoever the suite gateway says is signed in. The prefix meets any
 * password-strength rule Metabase is set to.
 */
export function personPassword(c: InsightsConfig, email: string): string {
  return "Sy1!" + derive(c.secret, `metabase-user:${email.toLowerCase()}`);
}

/** The read-only Postgres role's password. Hex, so it never needs quoting. */
export function readerPassword(c: InsightsConfig): string {
  return createHmac("sha256", c.secret).update("reader-role").digest("hex");
}

/** Metabase's static embedding key: 64 hex characters, as Metabase expects. */
export function embeddingKey(c: InsightsConfig): string {
  if (!c.secret) throw new Error("INSIGHTS_SECRET is not set");
  return createHmac("sha256", c.secret).update("embedding-key").digest("hex");
}

export function isAdmin(c: InsightsConfig, email: string): boolean {
  return c.admins.includes(email.toLowerCase());
}

export function isAnalyst(c: InsightsConfig, email: string): boolean {
  return isAdmin(c, email) || c.analysts === "*" || c.analysts.includes(email.toLowerCase());
}
