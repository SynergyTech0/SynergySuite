import { Pool, type QueryResultRow } from 'pg';

/*
 * SynergyDB (Postgres-wire) data layer.
 *
 * SynergyDB 0.1.0 quirks that this layer works around (verified via probes):
 *   - INT/int4 columns corrupt on parameterized writes  -> use BIGINT everywhere
 *   - TIMESTAMPTZ params + DEFAULT now() return NULL     -> store epoch-ms as BIGINT, set in app
 *   - Native TEXT[] arrays don't round-trip             -> store lists as JSONB
 *   - GROUP BY aggregates return NULL                   -> use separate scalar COUNT queries
 *   - LIMIT $n::bigint fails to parse                    -> use a bare "LIMIT $n" (no cast)
 *   - SELECT DISTINCT breaks the pg wire response        -> select rows, dedupe app-side
 *   - Every parameter must be cast to its column type in SQL ($n::bigint / ::jsonb / ...)
 *     EXCEPT the LIMIT parameter, which must NOT be cast.
 * BIGINT, BIGSERIAL, JSONB, BOOLEAN, TEXT, ON CONFLICT upsert, and FK cascade all work.
 */

declare global {
  // eslint-disable-next-line no-var
  var __smPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __smSchema: Promise<void> | undefined;
}

export function pool(): Pool {
  if (!global.__smPool) {
    global.__smPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb',
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return global.__smPool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const r = await pool().query<T>(text, params as never[]);
  return r.rows;
}

/** Same as q() but skips the schema guard — used inside ensureSchema itself. */
async function raw(text: string, params: unknown[] = []): Promise<void> {
  await pool().query(text, params as never[]);
}

export const now = () => Date.now();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audiences (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_ms  BIGINT
);
CREATE TABLE IF NOT EXISTS contacts (
  id          BIGSERIAL PRIMARY KEY,
  audience_id BIGINT,
  email       TEXT NOT NULL,
  first_name  TEXT,
  last_name   TEXT,
  company     TEXT,
  fields      JSONB,
  status      TEXT,          -- subscribed | unsubscribed | cleaned
  token       TEXT,          -- per-contact tracking/unsub token
  created_ms  BIGINT
);
CREATE INDEX IF NOT EXISTS contacts_aud_idx ON contacts(audience_id);
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email);
CREATE INDEX IF NOT EXISTS contacts_token_idx ON contacts(token);
CREATE TABLE IF NOT EXISTS templates (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  subject     TEXT,
  blocks      JSONB,         -- ordered list of content blocks
  html        TEXT,          -- rendered html cache
  updated_ms  BIGINT
);
CREATE TABLE IF NOT EXISTS campaigns (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  audience_id  BIGINT,
  template_id  BIGINT,
  subject      TEXT,
  html         TEXT,
  status       TEXT,         -- draft | scheduled | sending | sent | failed
  scheduled_ms BIGINT,
  sent_ms      BIGINT,
  total        BIGINT DEFAULT 0,
  sent_count   BIGINT DEFAULT 0,
  created_ms   BIGINT
);
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT,
  contact_id  BIGINT,
  email       TEXT,
  kind        TEXT,          -- send | open | click | unsub | bounce
  url         TEXT,
  ts_ms       BIGINT
);
CREATE INDEX IF NOT EXISTS events_camp_idx ON events(campaign_id);
CREATE TABLE IF NOT EXISTS automations (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  trigger     TEXT,          -- contact_added
  audience_id BIGINT,
  template_id BIGINT,
  delay_min   BIGINT DEFAULT 0,
  active      BOOLEAN DEFAULT true,
  created_ms  BIGINT
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id            BIGSERIAL PRIMARY KEY,
  automation_id BIGINT,
  contact_id    BIGINT,
  due_ms        BIGINT,
  done_ms       BIGINT
);
`;

export function ensureSchema(): Promise<void> {
  if (!global.__smSchema) {
    global.__smSchema = (async () => {
      // SynergyDB is happiest running statements one at a time
      for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
        await raw(stmt);
      }
    })();
  }
  return global.__smSchema;
}
