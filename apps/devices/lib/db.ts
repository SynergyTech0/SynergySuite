import { createDb } from "@synergy/db";

/**
 * Devices keeps what osquery reports about each enrolled computer, the compliance policies it is
 * measured against, and the security alerts raised from what it saw. Secrets (enroll secrets and
 * node keys) are stored only as SHA-256 hashes: a database dump can't be used to impersonate a device.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS enroll_secrets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  secret_hash  TEXT NOT NULL UNIQUE,
  -- Set for a personal enrollment: devices enrolled with it belong to this person.
  owner        TEXT,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_identifier  TEXT NOT NULL UNIQUE,
  node_key_hash    TEXT UNIQUE,
  enroll_secret_id UUID REFERENCES enroll_secrets(id) ON DELETE SET NULL,
  owner            TEXT,
  hostname         TEXT NOT NULL DEFAULT '',
  platform         TEXT NOT NULL DEFAULT '',
  os_name          TEXT NOT NULL DEFAULT '',
  os_version       TEXT NOT NULL DEFAULT '',
  hardware_vendor  TEXT NOT NULL DEFAULT '',
  hardware_model   TEXT NOT NULL DEFAULT '',
  hardware_serial  TEXT NOT NULL DEFAULT '',
  cpu              TEXT NOT NULL DEFAULT '',
  memory_bytes     BIGINT,
  osquery_version  TEXT NOT NULL DEFAULT '',
  -- Posture and other facts, one key per check (see lib/facts.ts).
  facts            JSONB NOT NULL DEFAULT '{}',
  facts_at         TIMESTAMPTZ,
  compliance       TEXT NOT NULL DEFAULT 'unknown' CHECK (compliance IN ('compliant', 'noncompliant', 'unknown')),
  compliance_detail JSONB NOT NULL DEFAULT '[]',
  compliance_at    TIMESTAMPTZ,
  notes            TEXT NOT NULL DEFAULT '',
  last_ip          TEXT,
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  vulns_checked_at TIMESTAMPTZ,
  retired_at       TIMESTAMPTZ,
  retired_by       TEXT
);
CREATE INDEX IF NOT EXISTS devices_owner_idx ON devices (owner) WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS software (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  version   TEXT NOT NULL DEFAULT '',
  source    TEXT NOT NULL DEFAULT '',
  -- The package the distribution files security advisories under (Debian source package).
  package   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (device_id, source, name, version)
);
CREATE INDEX IF NOT EXISTS software_name_idx ON software (lower(name));

-- The first result of a differential query lists everything already there. It is the baseline,
-- not news, so detections only fire for rows added after it.
CREATE TABLE IF NOT EXISTS baselines (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  query     TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, query)
);

CREATE TABLE IF NOT EXISTS policies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  platforms   TEXT[] NOT NULL DEFAULT '{}',
  rules       JSONB NOT NULL DEFAULT '[]',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  detection   TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title       TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  -- Same detection and evidence on the same device while open is one alert, seen again.
  fingerprint TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'resolved', 'dismissed')),
  assigned_to TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  closed_by   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_uniq ON alerts (device_id, fingerprint) WHERE status IN ('new', 'investigating');
CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_events (
  id       BIGSERIAL PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_events_alert_idx ON alert_events (alert_id, at);

-- Known-bad file hashes (custom indicators): a running program with one raises a critical alert.
CREATE TABLE IF NOT EXISTS indicators (
  sha256     TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  title      TEXT NOT NULL,
  added_by   TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  device_id     UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  vuln_id       TEXT NOT NULL,
  package       TEXT NOT NULL,
  version       TEXT NOT NULL,
  ecosystem     TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('unknown', 'low', 'medium', 'high', 'critical')),
  score         REAL,
  summary       TEXT NOT NULL DEFAULT '',
  fixed_version TEXT NOT NULL DEFAULT '',
  found_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, vuln_id, package)
);
CREATE INDEX IF NOT EXISTS vulnerabilities_vuln_idx ON vulnerabilities (vuln_id);

-- Advisory details from OSV, so a fleet of identical machines asks about each advisory once.
CREATE TABLE IF NOT EXISTS advisories (
  id         TEXT PRIMARY KEY,
  severity   TEXT NOT NULL,
  score      REAL,
  summary    TEXT NOT NULL DEFAULT '',
  fixed      JSONB NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_queries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sql        TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS live_targets (
  query_id  UUID NOT NULL REFERENCES live_queries(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  -- 'refresh' asks for the inventory and posture queries now instead of a person's query.
  purpose   TEXT NOT NULL DEFAULT 'live' CHECK (purpose IN ('live', 'refresh')),
  status    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'done', 'error')),
  rows      JSONB,
  error     TEXT,
  sent_at   TIMESTAMPTZ,
  done_at   TIMESTAMPTZ,
  PRIMARY KEY (query_id, device_id)
);
CREATE INDEX IF NOT EXISTS live_targets_pending_idx ON live_targets (device_id) WHERE status IN ('pending', 'sent');

CREATE TABLE IF NOT EXISTS audit (
  id     BIGSERIAL PRIMARY KEY,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}',
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __devicesDb?: Db; __devicesReady?: Promise<void> };

export function db(): Db {
  if (!g.__devicesDb) g.__devicesDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/devices", max: 10 });
  return g.__devicesDb;
}

export function ready(): Promise<void> {
  if (!g.__devicesReady) {
    g.__devicesReady = db().migrate(SCHEMA, "devices").catch((e) => {
      g.__devicesReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__devicesReady;
}

export type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

export const q: Q = async (text, params = []) => {
  await ready();
  return (await db().q(text, params)).rows as never;
};

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: Q) => Promise<T>): Promise<T> {
  await ready();
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => (await client.query(text, params as unknown[])).rows as never);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function audit(actor: string, action: string, target = "", detail: Record<string, unknown> = {}): Promise<void> {
  await q(`INSERT INTO audit (actor, action, target, detail) VALUES ($1, $2, $3, $4)`, [actor, action, target, JSON.stringify(detail)]);
}
