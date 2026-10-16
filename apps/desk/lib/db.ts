import { createDb } from "@synergy/db";

/**
 * Tickets and their conversations, plus the two libraries staff keep: canned replies and
 * knowledge-base articles. `ticket_counters` hands out ticket numbers, one row per year, so
 * two tickets arriving at the same moment can never get the same number.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id               BIGSERIAL PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  subject          TEXT NOT NULL,
  requester_email  TEXT NOT NULL,
  requester_name   TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','solved','closed')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assignee         TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','email','api')),
  email_message_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  solved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_requester_idx ON tickets (lower(requester_email));
CREATE INDEX IF NOT EXISTS tickets_msgid_idx ON tickets (email_message_id) WHERE email_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id               BIGSERIAL PRIMARY KEY,
  ticket_id        BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound','note')),
  author           TEXT NOT NULL,
  body             TEXT NOT NULL,
  emailed          BOOLEAN NOT NULL DEFAULT false,
  email_message_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id, id);
CREATE INDEX IF NOT EXISTS ticket_messages_msgid_idx ON ticket_messages (email_message_id) WHERE email_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_counters (
  year INT PRIMARY KEY,
  last INT NOT NULL
);

CREATE TABLE IF NOT EXISTS canned_replies (
  id         BIGSERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  published  BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who works the desk (lib/agents.ts). Anyone else only sees the tickets they asked for.
CREATE TABLE IF NOT EXISTS agents (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  scope      TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','assigned')),
  added_by   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS desk_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Once, when agents arrive on an existing desk: everyone who already worked as staff becomes an agent.
INSERT INTO agents (email, added_by)
  SELECT DISTINCT lower(e), 'existing staff' FROM (
    SELECT assignee AS e FROM tickets
    UNION SELECT author FROM ticket_messages WHERE direction IN ('outbound','note')
    UNION SELECT created_by FROM canned_replies
    UNION SELECT updated_by FROM kb_articles
  ) staff
  WHERE e LIKE '%_@_%' AND NOT EXISTS (SELECT 1 FROM desk_meta WHERE key = 'agents_seeded')
ON CONFLICT DO NOTHING;
INSERT INTO desk_meta (key, value) VALUES ('agents_seeded', now()::text) ON CONFLICT DO NOTHING;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __deskDb?: Db; __deskReady?: Promise<void> };

export function db(): Db {
  // DESK_DATABASE_URL wins; otherwise DATABASE_URL, otherwise the local development database.
  if (!g.__deskDb) {
    g.__deskDb = createDb({
      connectionString: process.env.DESK_DATABASE_URL || undefined,
      devUrl: "postgres://postgres@127.0.0.1:5499/desk",
      max: 10,
    });
  }
  return g.__deskDb;
}

export function ready(): Promise<void> {
  if (!g.__deskReady) {
    g.__deskReady = db().migrate(SCHEMA, "desk").catch((e) => {
      g.__deskReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__deskReady;
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
