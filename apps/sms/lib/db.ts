import { createDb } from "@synergy/db";

/**
 * Contacts are keyed by phone number in E.164 (+15551234567). Every text in or out is one row in
 * messages; a campaign's texts are written as 'pending' rows up front and sent one by one, so a
 * restart picks up where sending stopped. A contact who texts STOP is opted out and never sent to.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  tags       TEXT[] NOT NULL DEFAULT '{}',
  opted_out  BOOLEAN NOT NULL DEFAULT false,
  opted_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_tags_idx ON contacts USING gin (tags);

CREATE TABLE IF NOT EXISTS campaigns (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  tag        TEXT NOT NULL DEFAULT '',
  recipients INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'done')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body        TEXT NOT NULL,
  provider_id TEXT,
  status      TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  sent_by     TEXT NOT NULL DEFAULT '',
  read        BOOLEAN NOT NULL DEFAULT true,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages (phone, id DESC);
CREATE INDEX IF NOT EXISTS messages_pending_idx ON messages (campaign_id, id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_idx ON messages (provider_id) WHERE provider_id IS NOT NULL;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __smsDb?: Db; __smsReady?: Promise<void> };

export function db(): Db {
  if (!g.__smsDb) g.__smsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/sms", max: 10 });
  return g.__smsDb;
}

export function ready(): Promise<void> {
  if (!g.__smsReady) {
    g.__smsReady = db().migrate(SCHEMA, "sms").catch((e) => {
      g.__smsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__smsReady;
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
