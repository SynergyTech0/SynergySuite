import { createDb } from "@synergy/db";

/**
 * The Admin center's own records. `matters` are eDiscovery cases; each has legal `holds`, saved
 * `searches` and `exports`. `retention_rules` say how long apps may keep content. `roles` holds
 * the people admins made eDiscovery managers. `audit` is append-only: a trigger refuses changes.
 * `policy_state` notes when holds or retention last changed, for the policy feed apps read.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  owner       TEXT NOT NULL,
  members     JSONB NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by   TEXT,
  closed_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id),
  name        TEXT NOT NULL,
  custodians  JSONB NOT NULL DEFAULT '[]',
  apps        JSONB NOT NULL DEFAULT '[]',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by TEXT,
  released_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holds_matter_idx ON holds (matter_id, created_at);

CREATE TABLE IF NOT EXISTS searches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id  UUID NOT NULL REFERENCES matters(id),
  name       TEXT NOT NULL,
  query      TEXT NOT NULL DEFAULT '',
  custodians JSONB NOT NULL DEFAULT '[]',
  apps       JSONB NOT NULL DEFAULT '[]',
  from_date  DATE,
  to_date    DATE,
  counts     JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS searches_matter_idx ON searches (matter_id, created_at);

CREATE TABLE IF NOT EXISTS exports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id    UUID NOT NULL REFERENCES matters(id),
  search_id    UUID REFERENCES searches(id),
  search       JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  file_name    TEXT,
  size         BIGINT,
  sha256       TEXT,
  counts       JSONB NOT NULL DEFAULT '{}',
  error        TEXT
);
CREATE INDEX IF NOT EXISTS exports_matter_idx ON exports (matter_id, created_at);

CREATE TABLE IF NOT EXISTS retention_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app        TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT '',
  days       INTEGER NOT NULL CHECK (days >= 1),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS retention_rules_uniq ON retention_rules (app, kind);

CREATE TABLE IF NOT EXISTS policy_state (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO policy_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit (action, at DESC);

CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_append_only ON audit;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION audit_append_only();
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __adminDb?: Db; __adminReady?: Promise<void> };

export function db(): Db {
  if (!g.__adminDb) {
    g.__adminDb = createDb({
      // ADMIN_DATABASE_URL lets the Admin center share a host with apps that read DATABASE_URL.
      connectionString: process.env.ADMIN_DATABASE_URL || undefined,
      devUrl: "postgres://postgres@127.0.0.1:5499/admin",
      max: 10,
    });
  }
  return g.__adminDb;
}

export function ready(): Promise<void> {
  if (!g.__adminReady) {
    g.__adminReady = db().migrate(SCHEMA, "admin").catch((e) => {
      g.__adminReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__adminReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

export type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: Tq) => Promise<T>): Promise<T> {
  await ready();
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => (await client.query(text, params as unknown[])).rows);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
