import { Pool } from "pg";

/**
 * SynergyMeet's own small Postgres — holds scheduled meetings + invitees. The rest of the app is
 * stateless (SSO + LiveKit), so this is the only persistence. Schema is created on first use
 * (idempotent) so there's no separate migration step to run on deploy.
 */
let _pool: Pool | null = null;
let _ready: Promise<void> | null = null;

export function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return _pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meetings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room          text NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  host_email    text NOT NULL,
  host_name     text NOT NULL DEFAULT '',
  start_at      timestamptz NOT NULL,
  duration_min  integer NOT NULL DEFAULT 30,
  timezone      text NOT NULL DEFAULT 'UTC',
  rrule         text,                      -- RFC5545 RRULE for recurring; NULL = one-off
  sequence      integer NOT NULL DEFAULT 0, -- bumped on each edit so calendars update the event
  canceled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_host_idx ON meetings (host_email, start_at DESC);

CREATE TABLE IF NOT EXISTS meeting_invitees (
  meeting_id    uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  email         text NOT NULL,
  name          text NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, email)
);
`;

/** Ensure the schema exists exactly once per process. */
export async function ensureSchema(): Promise<void> {
  if (!_ready) {
    _ready = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((e) => {
        _ready = null; // allow retry on next call if it failed
        throw e;
      });
  }
  return _ready;
}
