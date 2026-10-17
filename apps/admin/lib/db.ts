import { createDb } from "@synergy/db";

/**
 * The Admin center's own records. `matters` are eDiscovery cases; each has legal `holds`, saved
 * `searches` and `exports`. `retention_rules` say how long apps may keep content. `roles` holds
 * the people admins made eDiscovery managers. `audit` is append-only: a trigger refuses changes.
 * `policy_state` notes when holds or retention last changed, for the policy feed apps read.
 * `labels` are the suite's sensitivity labels and `dlp_rules`/`dlp_types` its data loss
 * prevention rules, both handed to apps in the same feed; apps report matches as `dlp_incidents`.
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

CREATE TABLE IF NOT EXISTS labels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  color          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  priority       INTEGER NOT NULL,
  block_external BOOLEAN NOT NULL DEFAULT false,
  marking        TEXT NOT NULL DEFAULT '',
  updated_by     TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS labels_name_uniq ON labels (lower(name));

-- One row; its first insert seeds the usual four labels (same ids Synergy Sheets has always written).
CREATE TABLE IF NOT EXISTS label_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_label_id UUID,
  seeded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO labels (id, name, color, description, priority, block_external, marking, updated_by)
SELECT v.* FROM (VALUES
  ('a8b6f1c2-0d3e-4f5a-9b6c-1d2e3f4a5b60'::uuid, 'Public', '#15803d', 'Meant for anyone, inside or outside the company.', 0, false, '', 'setup'),
  ('b9c7a2d3-1e4f-4a6b-8c7d-2e3f4a5b6c71'::uuid, 'General', '#2563eb', 'Everyday business content that isn''t meant for the public.', 1, false, '', 'setup'),
  ('c0d8b3e4-2f5a-4b7c-9d8e-3f4a5b6c7d82'::uuid, 'Confidential', '#d97706', 'Sensitive business content: customers, finances, plans.', 2, false, 'CONFIDENTIAL', 'setup'),
  ('d1e9c4f5-3a6b-4c8d-8e9f-4a5b6c7d8e93'::uuid, 'Highly Confidential', '#b91c1c', 'The most sensitive content. Can''t be shared outside the company.', 3, true, 'HIGHLY CONFIDENTIAL', 'setup')
) v WHERE NOT EXISTS (SELECT 1 FROM label_settings) ON CONFLICT DO NOTHING;
INSERT INTO label_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dlp_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  keywords    JSONB NOT NULL DEFAULT '[]',
  pattern     TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dlp_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  mode       TEXT NOT NULL DEFAULT 'test',
  apps       JSONB NOT NULL DEFAULT '[]',
  types      JSONB NOT NULL DEFAULT '[]',
  labels     JSONB NOT NULL DEFAULT '[]',
  scope      TEXT NOT NULL DEFAULT 'external',
  action     TEXT NOT NULL DEFAULT 'warn',
  tip        TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dlp_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  internal_domains JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO dlp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dlp_incidents (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  app           TEXT NOT NULL,
  actor         TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  target        TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  overridden    BOOLEAN NOT NULL DEFAULT false,
  justification TEXT NOT NULL DEFAULT '',
  rules         JSONB NOT NULL DEFAULT '[]',
  matches       JSONB NOT NULL DEFAULT '[]',
  recipients    JSONB NOT NULL DEFAULT '[]',
  label_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  note          TEXT NOT NULL DEFAULT '',
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dlp_incidents_at_idx ON dlp_incidents (at DESC);
CREATE INDEX IF NOT EXISTS dlp_incidents_status_idx ON dlp_incidents (status, at DESC);

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

-- Moving in from Microsoft 365 or another IMAP server (lib/migrate). A source holds the
-- connection (its secret sealed with MIGRATION_ENCRYPTION_KEY); users and sites are what
-- discovery found there, each mapped to a suite account or library; jobs copy one user or site;
-- cursors keep each delta link so a re-run copies only what changed; items remember every
-- copied item and where it went, so nothing is copied twice.
CREATE TABLE IF NOT EXISTS migration_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('m365', 'imap')),
  name            TEXT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}',
  secret          TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  discovered_at   TIMESTAMPTZ,
  discovery_error TEXT,
  notes           JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS migration_users (
  source_id   UUID NOT NULL REFERENCES migration_sources(id) ON DELETE CASCADE,
  ext_id      TEXT NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  mail_bytes  BIGINT,
  mail_items  INTEGER,
  drive_bytes BIGINT,
  has_mailbox BOOLEAN,
  has_drive   BOOLEAN,
  target      TEXT,
  secret      TEXT NOT NULL DEFAULT '',
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, ext_id)
);

CREATE TABLE IF NOT EXISTS migration_sites (
  source_id   UUID NOT NULL REFERENCES migration_sources(id) ON DELETE CASCADE,
  site_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  drive_bytes BIGINT,
  libraries   INTEGER,
  members     JSONB NOT NULL DEFAULT '[]',
  include     BOOLEAN NOT NULL DEFAULT false,
  library     TEXT NOT NULL DEFAULT '',
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, site_id)
);

CREATE TABLE IF NOT EXISTS migration_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES migration_sources(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'site')),
  subject_id   TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  target       TEXT NOT NULL,
  workloads    TEXT[] NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  progress     JSONB NOT NULL DEFAULT '{}',
  report       JSONB NOT NULL DEFAULT '{}',
  error        TEXT,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  not_before   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS migration_jobs_queue_idx ON migration_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS migration_jobs_subject_idx ON migration_jobs (source_id, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS migration_cursors (
  source_id  UUID NOT NULL REFERENCES migration_sources(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  workload   TEXT NOT NULL,
  scope      TEXT NOT NULL,
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, subject_id, workload, scope)
);

CREATE TABLE IF NOT EXISTS migration_items (
  source_id  UUID NOT NULL REFERENCES migration_sources(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  workload   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  target_id  TEXT NOT NULL DEFAULT '',
  version    TEXT NOT NULL DEFAULT '',
  info       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, subject_id, workload, item_id)
);

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
