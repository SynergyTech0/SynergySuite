import { createDb } from "@synergy/db";

/**
 * A group is owned by its owners and made of its members: people (emails) or other groups
 * ("group:<id>", so a distribution list can hold a team). What a group brings with it depends on
 * its kind:
 *   team            a Chat workspace with its channels, a Drive library, a group calendar and,
 *                   with an address, a shared mailbox in Mail (a Microsoft 365 group in Teams)
 *   shared_mailbox  one mailbox its members read and send from
 *   distribution    an address that forwards to every member, outside addresses allowed
 *   security        nothing of its own; other apps grant it access ("group:<id>")
 *
 * `resources` records what each app made for a group and whether the last sync reached it.
 * Deleting a group only marks it; it is removed from the other apps and can be restored.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('team', 'distribution', 'shared_mailbox', 'security')),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  email           TEXT,
  privacy         TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('private', 'public')),
  allow_external  BOOLEAN NOT NULL DEFAULT false,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      TEXT,
  synced_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS groups_email_uniq ON groups (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS members (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  added_by   TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member)
);
CREATE INDEX IF NOT EXISTS members_member_idx ON members (member);

CREATE TABLE IF NOT EXISTS channels (
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  topic       TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, key)
);

CREATE TABLE IF NOT EXISTS join_requests (
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, email)
);

CREATE TABLE IF NOT EXISTS resources (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  app        TEXT NOT NULL,
  ref        TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'off')),
  error      TEXT NOT NULL DEFAULT '',
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, app)
);

-- Who changed what, for owners and for eDiscovery.
CREATE TABLE IF NOT EXISTS audit (
  id        BIGSERIAL PRIMARY KEY,
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '',
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_group_idx ON audit (group_id, at);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __groupsDb?: Db; __groupsReady?: Promise<void> };

export function db(): Db {
  if (!g.__groupsDb) g.__groupsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/groups", max: 10 });
  return g.__groupsDb;
}

export function ready(): Promise<void> {
  if (!g.__groupsReady) {
    g.__groupsReady = db().migrate(SCHEMA, "groups").catch((e) => {
      g.__groupsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__groupsReady;
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
