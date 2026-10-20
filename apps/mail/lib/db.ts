import { createDb } from "@synergy/db";

/**
 * Mail keeps very little of its own: the outside accounts people connect. Messages stay on the
 * mail server (IMAP is the source of truth), so there is nothing to sync or migrate per message.
 * The one exception is legal hold: a copy of every message of a person on hold (preserved.ts), in
 * the suite mailbox and their outside accounts, since desktop and phone clients can delete
 * straight from the mail server. It also remembers who it made a member of each shared mailbox on
 * the mail server (groups.ts).
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
  secret       TEXT NOT NULL,            -- password (or Microsoft refresh token), encrypted with MAIL_ENCRYPTION_KEY
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts (owner_email);

-- Suite users who have opened Mail, so eDiscovery can find mailboxes without the admin API.
CREATE TABLE IF NOT EXISTS mail_users (
  email        TEXT PRIMARY KEY,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw copies of the mail of people on legal hold, one per distinct message per account of a mailbox.
CREATE TABLE IF NOT EXISTS preserved_messages (
  id           BIGSERIAL PRIMARY KEY,
  mailbox      TEXT NOT NULL,            -- the owner's address
  account      TEXT NOT NULL DEFAULT 'suite', -- "suite", or the id of an outside account in accounts
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
  deleted_at   TIMESTAMPTZ               -- deleted for good through Mail while on hold
);
CREATE INDEX IF NOT EXISTS preserved_mailbox_idx ON preserved_messages (mailbox, id);

-- Mailboxes the hold sweep copies, and how far it has got in each folder of each account.
CREATE TABLE IF NOT EXISTS preserve_mailboxes (
  mailbox      TEXT PRIMARY KEY,
  held_since   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ,              -- the Admin center said the hold ended
  swept_at     TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS preserve_folders (
  mailbox      TEXT NOT NULL,
  account      TEXT NOT NULL DEFAULT 'suite',
  folder       TEXT NOT NULL,
  uidvalidity  TEXT NOT NULL,
  last_uid     BIGINT NOT NULL
);

-- Who Mail made a member of each shared mailbox (Stalwart keeps group membership on each user),
-- so a new member list from Groups takes away exactly what was given before.
CREATE TABLE IF NOT EXISTS shared_mailbox_grants (
  address      TEXT NOT NULL,            -- the shared mailbox
  member       TEXT NOT NULL,
  user_id      TEXT NOT NULL,            -- the member's account id on the mail server
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (address, member)
);

-- Outside accounts whose mail was preserved, so it can still be named after the account is removed.
CREATE TABLE IF NOT EXISTS preserve_accounts (
  mailbox      TEXT NOT NULL,
  account      TEXT NOT NULL,
  address      TEXT NOT NULL,
  label        TEXT NOT NULL,
  removed_at   TIMESTAMPTZ,              -- the person removed the account from Mail
  PRIMARY KEY (mailbox, account)
);

-- Outside accounts came after the first release, when everything preserved was the suite
-- mailbox: add the account to the keys. Safe to run on every start.
ALTER TABLE preserved_messages ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'suite';
ALTER TABLE preserved_messages DROP CONSTRAINT IF EXISTS preserved_messages_mailbox_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS preserved_messages_key ON preserved_messages (mailbox, account, hash);
CREATE INDEX IF NOT EXISTS preserved_account_idx ON preserved_messages (mailbox, account, id);
ALTER TABLE preserve_folders ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'suite';
ALTER TABLE preserve_folders DROP CONSTRAINT IF EXISTS preserve_folders_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS preserve_folders_key ON preserve_folders (mailbox, account, folder);

-- password: IMAP/SMTP with the saved password. microsoft: Sign in with Microsoft (XOAUTH2), secret
-- holds the refresh token.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_kind TEXT NOT NULL DEFAULT 'password';
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
