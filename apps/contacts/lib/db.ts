import { createDb } from "@synergy/db";

/**
 * `contacts` is each person's own address book. `profiles` is what people in the organization
 * say about themselves (title, phone, photo); the directory joins it with the suite's accounts.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner       TEXT NOT NULL,
  first_name  TEXT NOT NULL DEFAULT '',
  middle_name TEXT NOT NULL DEFAULT '',
  last_name   TEXT NOT NULL DEFAULT '',
  nickname    TEXT NOT NULL DEFAULT '',
  company     TEXT NOT NULL DEFAULT '',
  job_title   TEXT NOT NULL DEFAULT '',
  department  TEXT NOT NULL DEFAULT '',
  emails      JSONB NOT NULL DEFAULT '[]',
  phones      JSONB NOT NULL DEFAULT '[]',
  addresses   JSONB NOT NULL DEFAULT '[]',
  websites    JSONB NOT NULL DEFAULT '[]',
  birthday    DATE,
  notes       TEXT NOT NULL DEFAULT '',
  display     TEXT NOT NULL,
  sort_key    TEXT NOT NULL,
  search      TEXT NOT NULL DEFAULT '',
  favorite    BOOLEAN NOT NULL DEFAULT false,
  photo       BYTEA,
  photo_mime  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts (owner, sort_key);

CREATE TABLE IF NOT EXISTS groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS groups_name_uniq ON groups (owner, lower(name));

CREATE TABLE IF NOT EXISTS group_members (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, contact_id)
);
CREATE INDEX IF NOT EXISTS group_members_contact_idx ON group_members (contact_id);

CREATE TABLE IF NOT EXISTS profiles (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  job_title  TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  office     TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  mobile     TEXT NOT NULL DEFAULT '',
  manager    TEXT NOT NULL DEFAULT '',
  about      TEXT NOT NULL DEFAULT '',
  photo      BYTEA,
  photo_mime TEXT,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deleted while the owner was on legal hold: kept, hidden, still found by eDiscovery.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __contactsDb?: Db; __contactsReady?: Promise<void> };

export function db(): Db {
  if (!g.__contactsDb) g.__contactsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/contacts", max: 10 });
  return g.__contactsDb;
}

export function ready(): Promise<void> {
  if (!g.__contactsReady) {
    g.__contactsReady = db().migrate(SCHEMA, "contacts").catch((e) => {
      g.__contactsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__contactsReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
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
