import { createDb } from "@synergy/db";

/**
 * Every file and folder is one row in `items`. A row lives in a space: someone's own files
 * ("u:<email>") or a shared library ("l:<id>"). File bytes live in the blob store (lib/blobs.ts),
 * named by their SHA-256, so versions and copies of the same content are stored once.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS libraries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_members (
  library_id UUID NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (library_id, email)
);
CREATE INDEX IF NOT EXISTS library_members_email_idx ON library_members (email);

CREATE TABLE IF NOT EXISTS items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space       TEXT NOT NULL,
  library_id  UUID REFERENCES libraries(id) ON DELETE CASCADE,
  owner       TEXT NOT NULL,
  parent_id   UUID REFERENCES items(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT '',
  size        BIGINT NOT NULL DEFAULT 0,
  sha256      TEXT,
  version     INTEGER NOT NULL DEFAULT 0,
  text        TEXT,
  summary     TEXT,
  summary_sha TEXT,
  created_by  TEXT NOT NULL,
  modified_by TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trashed_at  TIMESTAMPTZ,
  trashed_by  TEXT,
  trash_root  UUID
);
CREATE INDEX IF NOT EXISTS items_parent_idx ON items (parent_id);
CREATE INDEX IF NOT EXISTS items_space_idx ON items (space, parent_id);
CREATE INDEX IF NOT EXISTS items_modified_idx ON items (modified_at DESC);
CREATE INDEX IF NOT EXISTS items_trash_idx ON items (trash_root) WHERE trash_root IS NOT NULL;
-- One live item per name in a folder, whatever the case.
CREATE UNIQUE INDEX IF NOT EXISTS items_name_uniq ON items
  (space, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE trash_root IS NULL;
CREATE INDEX IF NOT EXISTS items_search_idx ON items
  USING gin (to_tsvector('simple', name || ' ' || COALESCE(text, '')));

CREATE TABLE IF NOT EXISTS versions (
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL,
  size       BIGINT NOT NULL,
  sha256     TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, n)
);
CREATE INDEX IF NOT EXISTS versions_sha_idx ON versions (sha256);

CREATE TABLE IF NOT EXISTS shares (
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  shared_by  TEXT NOT NULL,
  shared_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, email)
);
CREATE INDEX IF NOT EXISTS shares_email_idx ON shares (email);

CREATE TABLE IF NOT EXISTS links (
  token      TEXT PRIMARY KEY,
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS links_item_idx ON links (item_id);

CREATE TABLE IF NOT EXISTS stars (
  email   TEXT NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (email, item_id)
);

CREATE TABLE IF NOT EXISTS activity (
  id      BIGSERIAL PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT '',
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_item_idx ON activity (item_id, at DESC);

-- Deleted for good while the owner was on legal hold: kept, hidden, still found by eDiscovery.
ALTER TABLE items ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS items_held_idx ON items (held_deleted_at) WHERE held_deleted_at IS NOT NULL;

-- A team's library: "groups:<group id>". Its name and members come from Groups (lib/svc.ts).
ALTER TABLE libraries ADD COLUMN IF NOT EXISTS source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS libraries_source_uniq ON libraries (source) WHERE source IS NOT NULL;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __driveDb?: Db; __driveReady?: Promise<void> };

export function db(): Db {
  if (!g.__driveDb) g.__driveDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/drive", max: 10 });
  return g.__driveDb;
}

export function ready(): Promise<void> {
  if (!g.__driveReady) {
    g.__driveReady = db().migrate(SCHEMA, "drive").catch((e) => {
      g.__driveReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__driveReady;
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
