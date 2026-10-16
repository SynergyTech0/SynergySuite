import { createDb } from "@synergy/db";

/**
 * Mail keeps very little of its own: the outside accounts people connect. Messages stay on the
 * mail server (IMAP is the source of truth), so there is nothing to sync or migrate per message.
 * The one exception is legal hold: a copy of every message of a person on hold (preserved.ts),
 * since desktop and phone clients can delete straight from the mail server.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id           BIGSERIAL PRIMARY KEY,
  owner_email  TEXT NOT NULL,
  label        TEXT NOT NULL,
  address      TEXT NOT NULL,
  imap_host    TEXT NOT NULL,
  imap_port    INTEGER NOT NULL,
  imap_secure  BOOLEAN NOT NULL,
  smtp_host    TEXT NOT NULL,
  smtp_port    INTEGER NOT NULL,
  smtp_secure  BOOLEAN NOT NULL,
  username     TEXT NOT NULL,
  secret       TEXT NOT NULL,            -- password, encrypted with MAIL_ENCRYPTION_KEY
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts (owner_email);

-- Suite users who have opened Mail, so eDiscovery can find mailboxes without the admin API.
CREATE TABLE IF NOT EXISTS mail_users (
  email        TEXT PRIMARY KEY,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw copies of the mail of people on legal hold, one per distinct message per mailbox.
CREATE TABLE IF NOT EXISTS preserved_messages (
  id           BIGSERIAL PRIMARY KEY,
  mailbox      TEXT NOT NULL,            -- the owner's address
  hash         TEXT NOT NULL,            -- sha256 of raw
  message_id   TEXT,
  folders      TEXT[] NOT NULL DEFAULT '{}',
  folder       TEXT NOT NULL,            -- where it was last seen: folder, UIDVALIDITY, UID
  uidvalidity  TEXT,
  uid          BIGINT,
  subject      TEXT NOT NULL DEFAULT '',
  from_addrs   TEXT[] NOT NULL DEFAULT '{}',
  to_addrs     TEXT[] NOT NULL DEFAULT '{}',
  cc_addrs     TEXT[] NOT NULL DEFAULT '{}',
  bcc_addrs    TEXT[] NOT NULL DEFAULT '{}',
  sent_at      TIMESTAMPTZ,
  size         INTEGER NOT NULL,
  search_text  TEXT NOT NULL,
  raw          BYTEA NOT NULL,
  preserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,              -- deleted for good through Mail while on hold
  UNIQUE (mailbox, hash)
);
CREATE INDEX IF NOT EXISTS preserved_mailbox_idx ON preserved_messages (mailbox, id);

-- Mailboxes the hold sweep copies, and how far it has got in each folder.
CREATE TABLE IF NOT EXISTS preserve_mailboxes (
  mailbox      TEXT PRIMARY KEY,
  held_since   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ,              -- the Admin center said the hold ended
  swept_at     TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS preserve_folders (
  mailbox      TEXT NOT NULL,
  folder       TEXT NOT NULL,
  uidvalidity  TEXT NOT NULL,
  last_uid     BIGINT NOT NULL,
  PRIMARY KEY (mailbox, folder)
);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __mailDb?: Db; __mailReady?: Promise<void> };

export function db(): Db {
  if (!g.__mailDb) g.__mailDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/mail", max: 5 });
  return g.__mailDb;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!g.__mailReady) {
    g.__mailReady = db().migrate(SCHEMA, "mail").catch((e) => {
      g.__mailReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  await g.__mailReady;
  return (await db().q(text, params)).rows as T[];
}
