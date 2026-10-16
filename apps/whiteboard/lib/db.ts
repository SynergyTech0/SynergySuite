import { createDb } from "@synergy/db";

/**
 * A board belongs to its owner and the people it is shared with. Its drawing is a Yjs document
 * (see lib/scene.mjs) that the collaboration server keeps in `ydoc`; `text` and `element_count`
 * are taken from it on every save, for search and the board list.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS boards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner         TEXT NOT NULL,
  title         TEXT NOT NULL,
  -- Anyone signed in to the suite who has the link: no access, can view, or can edit.
  link_access   TEXT NOT NULL DEFAULT 'none' CHECK (link_access IN ('none', 'view', 'edit')),
  -- The meeting or chat a board was opened from ('meet:<room>', 'chat:<channel>'), one board each.
  source        TEXT UNIQUE,
  -- A template the first editor to open the board lays out, then cleared.
  template      TEXT,
  ydoc          BYTEA,
  text          TEXT NOT NULL DEFAULT '',
  element_count INTEGER NOT NULL DEFAULT 0,
  thumbnail     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by   TEXT,
  -- Deleted while the owner was on legal hold: kept, hidden, still found by eDiscovery.
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS boards_owner_idx ON boards (owner);

CREATE TABLE IF NOT EXISTS board_members (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email    TEXT NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, email)
);
CREATE INDEX IF NOT EXISTS board_members_email_idx ON board_members (email);

-- Boards opened through a link, so they stay in that person's list.
CREATE TABLE IF NOT EXISTS board_visits (
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, email)
);
CREATE INDEX IF NOT EXISTS board_visits_email_idx ON board_visits (email, visited_at DESC);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __boardsDb?: Db; __boardsReady?: Promise<void> };

export function db(): Db {
  if (!g.__boardsDb) g.__boardsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/whiteboard", max: 10 });
  return g.__boardsDb;
}

/**
 * Suites installed before Whiteboard have no "whiteboard" database (postgres-init.sql only runs on
 * a fresh install), so the first start makes it, connecting to the server's "postgres" database.
 */
async function ensureDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) return;
  u.pathname = "/postgres";
  const admin = createDb({ connectionString: u.toString(), max: 1 });
  try {
    await admin.q(`CREATE DATABASE ${name}`);
    console.log(`[whiteboard] made the ${name} database`);
  } catch (e) {
    if ((e as { code?: string }).code !== "42P04") throw e; // made by another replica meanwhile
  } finally {
    await admin.close();
  }
}

async function migrate(): Promise<void> {
  try {
    await db().migrate(SCHEMA, "whiteboard");
  } catch (e) {
    if ((e as { code?: string }).code !== "3D000") throw e; // database does not exist
    await ensureDatabase();
    await db().migrate(SCHEMA, "whiteboard");
  }
}

export function ready(): Promise<void> {
  if (!g.__boardsReady) {
    g.__boardsReady = migrate().catch((e) => {
      g.__boardsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__boardsReady;
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
