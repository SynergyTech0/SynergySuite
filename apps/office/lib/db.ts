import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __docsPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __docsSchema: Promise<void> | undefined;
}

export function pool(): Pool {
  if (!global.__docsPool) {
    global.__docsPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/synergydocs",
      max: 8,
    });
  }
  return global.__docsPool;
}

// One documents table for all three kinds (doc | sheet | slide).
//  - doc/slide: collaborative state (Yjs) lives in `ydoc` as bytea, written by
//    the Hocuspocus server — real-time co-editing + zero-loss persistence.
//  - sheet: the Univer workbook is saved as a JSON `snapshot` (its model is
//    command-based, not a CRDT), autosaved from the editor and reloaded on open.
// `title`/`snippet` are cheap denormalized fields the list view reads without
// decoding the CRDT or the snapshot.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  org         TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'doc',
  title       TEXT NOT NULL DEFAULT 'Untitled document',
  snippet     TEXT NOT NULL DEFAULT '',
  ydoc        BYTEA,
  snapshot    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'doc';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS snapshot JSONB;
-- scope: 'private' (owner only) | 'company' (shared with the whole org).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'private';
-- company_role: the role the whole org gets when scope='company' (viewer|commenter|editor).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_role TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
UPDATE documents SET company_role = 'editor' WHERE scope = 'company' AND company_role IS NULL;
CREATE INDEX IF NOT EXISTS documents_org_idx ON documents(org, updated_at DESC);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents(org, owner_email, updated_at DESC);
CREATE INDEX IF NOT EXISTS documents_scope_idx ON documents(org, scope, updated_at DESC);

-- Per-person sharing: (doc, email) -> role (viewer|commenter|editor).
CREATE TABLE IF NOT EXISTS doc_grants (
  doc_id     TEXT NOT NULL,
  org        TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,
  granted_by TEXT,
  created_ms BIGINT NOT NULL,
  PRIMARY KEY (doc_id, email)
);
CREATE INDEX IF NOT EXISTS doc_grants_email_idx ON doc_grants(org, email);

-- Comment threads anchor to a mark in the doc (matching thread id); messages are
-- the replies within a thread. Bodies live here (not in the CRDT) so the list
-- view and resolve/reopen work without decoding the doc.
CREATE TABLE IF NOT EXISTS comment_threads (
  id         TEXT PRIMARY KEY,
  doc_id     TEXT NOT NULL,
  org        TEXT NOT NULL,
  quote      TEXT NOT NULL DEFAULT '',
  resolved   BOOLEAN NOT NULL DEFAULT false,
  created_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_threads_doc_idx ON comment_threads(doc_id, resolved, created_ms);
-- Where a thread sits in a spreadsheet: {"sheetId": "...", "ref": "B3"} as JSON; '' for Docs.
ALTER TABLE comment_threads ADD COLUMN IF NOT EXISTS anchor TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL,
  doc_id       TEXT NOT NULL,
  org          TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_ms   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_thread_idx ON comments(thread_id, created_ms);

-- Point-in-time snapshots of a document's HTML for version history / restore.
CREATE TABLE IF NOT EXISTS doc_versions (
  id           TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL,
  org          TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  html         TEXT NOT NULL,
  label        TEXT,
  created_ms   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS doc_versions_doc_idx ON doc_versions(doc_id, created_ms DESC);
-- the full editor state of a Word document (content JSON, styles, sections, settings), so a restore keeps them
ALTER TABLE doc_versions ADD COLUMN IF NOT EXISTS state TEXT;
`;

export function ensureSchema(): Promise<void> {
  if (!global.__docsSchema) {
    global.__docsSchema = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((e) => {
        global.__docsSchema = undefined;
        throw e;
      });
  }
  return global.__docsSchema;
}

export async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const r = await pool().query(text, params as never[]);
  return r.rows as T[];
}
