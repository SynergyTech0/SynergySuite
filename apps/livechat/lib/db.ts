import { createDb, type Db } from "@synergy/db";

/**
 * A widget is the chat bubble one website shows, found by its public key. A conversation is one
 * visitor's chat through a widget; the visitor holds a random token for it, of which only a hash
 * is kept. Messages come from the visitor, an agent (a signed-in suite user) or the system.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS widgets (
  id          BIGSERIAL PRIMARY KEY,
  widget_key  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL DEFAULT '',
  greeting    TEXT NOT NULL DEFAULT 'Hi! How can we help?',
  color       TEXT NOT NULL DEFAULT '#0f6cbd',
  ask_email   BOOLEAN NOT NULL DEFAULT true,
  owner_email TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id            BIGSERIAL PRIMARY KEY,
  widget_id     BIGINT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  visitor_name  TEXT NOT NULL DEFAULT '',
  visitor_email TEXT NOT NULL DEFAULT '',
  page          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to   TEXT NOT NULL DEFAULT '',
  ticket_number TEXT,
  agent_seen_id BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations (status, last_at DESC);
CREATE INDEX IF NOT EXISTS conversations_widget_idx ON conversations (widget_id, last_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  conv_id     BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL CHECK (sender IN ('visitor', 'agent', 'system')),
  body        TEXT NOT NULL,
  agent_email TEXT NOT NULL DEFAULT '',
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conv_id, id);
`;

const g = globalThis as unknown as { __livechatDb?: Db; __livechatReady?: Promise<void> };

export function db(): Db {
  if (!g.__livechatDb) g.__livechatDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/livechat", max: 10 });
  return g.__livechatDb;
}

export function ready(): Promise<void> {
  if (!g.__livechatReady) {
    g.__livechatReady = db().migrate(SCHEMA, "livechat").catch((e) => {
      g.__livechatReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__livechatReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}
