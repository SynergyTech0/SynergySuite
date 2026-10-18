import { createDb, type Db } from "@synergy/db";

/**
 * Monitors are web addresses checked on a schedule; every check is a row in `checks`. Incidents
 * are posted by hand, with updates as the situation changes. The first three tables keep the
 * columns of the earlier standalone Status tool, so its data loads straight in.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS monitors (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  expect_status INT NOT NULL DEFAULT 200,
  interval_sec  INT NOT NULL DEFAULT 300,
  active        BOOLEAN NOT NULL DEFAULT true,
  public        BOOLEAN NOT NULL DEFAULT true,
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS checks (
  id          BIGSERIAL PRIMARY KEY,
  monitor_id  BIGINT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  ok          BOOLEAN NOT NULL,
  status_code INT,
  latency_ms  INT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE checks ADD COLUMN IF NOT EXISTS error TEXT;
CREATE INDEX IF NOT EXISTS checks_monitor_idx ON checks (monitor_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS checks_checked_at_idx ON checks (checked_at);

CREATE TABLE IF NOT EXISTS incidents (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'investigating'
                CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS incidents_created_idx ON incidents (created_at DESC);

CREATE TABLE IF NOT EXISTS incident_updates (
  id          BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  body        TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_updates_idx ON incident_updates (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

const g = globalThis as unknown as { __statusDb?: Db; __statusReady?: Promise<void> };

export function db(): Db {
  if (!g.__statusDb) g.__statusDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/status", max: 10 });
  return g.__statusDb;
}

export function ready(): Promise<void> {
  if (!g.__statusReady) {
    g.__statusReady = db().migrate(SCHEMA, "status").catch((e) => {
      g.__statusReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__statusReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}
