import { createDb, type Db } from "@synergy/db";

/**
 * A site is a website that loads the tracking script with its site key. Each page view or custom
 * event is a row in `events`. No address, cookie or personal data is kept: a visitor is a hash
 * of the site, the visitor's address and browser, and a salt that changes every day and is then
 * deleted, so a visitor can be counted once per day but never followed from one day to the next.
 * `sites` and `events` keep the columns of the earlier standalone tool, so its data loads in.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sites (
  id          BIGSERIAL PRIMARY KEY,
  site_key    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id       BIGSERIAL PRIMARY KEY,
  site_id  BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL DEFAULT 'pageview',
  name     TEXT NOT NULL DEFAULT 'pageview',
  path     TEXT NOT NULL DEFAULT '/',
  ref_host TEXT NOT NULL DEFAULT '',
  visitor  TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS device TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS events_site_at_idx ON events (site_id, at DESC);
CREATE INDEX IF NOT EXISTS events_site_visitor_idx ON events (site_id, visitor);

CREATE TABLE IF NOT EXISTS salts (
  day  DATE PRIMARY KEY,
  salt TEXT NOT NULL
);
`;

const g = globalThis as unknown as { __analyticsDb?: Db; __analyticsReady?: Promise<void> };

export function db(): Db {
  if (!g.__analyticsDb) g.__analyticsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/analytics", max: 10 });
  return g.__analyticsDb;
}

export function ready(): Promise<void> {
  if (!g.__analyticsReady) {
    g.__analyticsReady = db().migrate(SCHEMA, "analytics").catch((e) => {
      g.__analyticsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__analyticsReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}
