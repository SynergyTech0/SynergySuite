import { createDb } from "@synergy/db";

/**
 * A diagram belongs to its owner and the people it is shared with, who can edit or only view it.
 * The diagram itself is draw.io XML (one <mxfile> with a <diagram> per page); `text_content` holds
 * its labels as plain text for search. Earlier saves are kept in `diagram_versions`.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS diagrams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner        TEXT NOT NULL,
  name         TEXT NOT NULL,
  xml          TEXT NOT NULL,
  text_content TEXT NOT NULL DEFAULT '',
  pages        INTEGER NOT NULL DEFAULT 1,
  thumbnail    BYTEA,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by  TEXT NOT NULL,
  -- Deleted while someone on it was on legal hold: kept, hidden, still found by eDiscovery.
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS diagrams_owner_idx ON diagrams (owner, modified_at DESC);

CREATE TABLE IF NOT EXISTS diagram_members (
  diagram_id UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'edit' CHECK (role IN ('edit', 'view')),
  added_by   TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, email)
);
CREATE INDEX IF NOT EXISTS diagram_members_email_idx ON diagram_members (email);

CREATE TABLE IF NOT EXISTS diagram_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  xml        TEXT NOT NULL,
  saved_by   TEXT NOT NULL,
  saved_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS diagram_versions_idx ON diagram_versions (diagram_id, saved_at DESC);

-- When each person last opened a diagram, for Recent.
CREATE TABLE IF NOT EXISTS opened (
  email      TEXT NOT NULL,
  diagram_id UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, diagram_id)
);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __diagramsDb?: Db; __diagramsReady?: Promise<void> };

export function db(): Db {
  if (!g.__diagramsDb) g.__diagramsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/diagrams", max: 10 });
  return g.__diagramsDb;
}

/**
 * A suite installed before Diagrams joined it has no diagrams database (deploy/postgres-init.sql
 * only runs on a fresh Postgres), so the first start makes it, as the same Postgres user.
 */
async function createDatabase(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5499/diagrams");
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/postgres";
  const admin = createDb({ connectionString: url.toString(), max: 1 });
  try {
    await admin.q(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } catch (e) {
    if ((e as { code?: string }).code !== "42P04") throw e; // another replica made it first
  } finally {
    await admin.close();
  }
}

async function migrate(): Promise<void> {
  try {
    await db().migrate(SCHEMA, "diagrams");
  } catch (e) {
    if ((e as { code?: string }).code !== "3D000") throw e; // database does not exist
    await createDatabase();
    await db().migrate(SCHEMA, "diagrams");
  }
}

export function ready(): Promise<void> {
  if (!g.__diagramsReady) {
    g.__diagramsReady = migrate().catch((e) => {
      g.__diagramsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__diagramsReady;
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
