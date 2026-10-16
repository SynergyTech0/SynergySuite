/**
 * The app's Postgres. The catalog (databases, members, tables, fields) lives in the public
 * schema; each database's own tables live in a schema of their own (`db_<id>`), as real tables
 * with real columns, so anything that speaks SQL can read them.
 */
import { createDb, type Db } from "@synergy/db";
import { types } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __baseDb: Db | undefined;
  // eslint-disable-next-line no-var
  var __baseReady: Promise<void> | undefined;
}

// Dates come back as written ("2026-10-16"), date-times as ISO strings, and numeric/bigint as
// strings so currency keeps its cents exactly. The browser formats them.
const parsers = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === 1082) return (v: string) => v; // date
    if (oid === 1184) {
      const toDate = types.getTypeParser(1184, "text") as (v: string) => Date | number;
      return (v: string) => {
        const d = toDate(v);
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : v;
      };
    }
    if (oid === 1700 || oid === 20) return (v: string) => v; // numeric, bigint
    return types.getTypeParser(oid, format as "text");
  },
};

export const CATALOG = `
CREATE TABLE IF NOT EXISTS base_databases (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  schema_name text NOT NULL UNIQUE,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Who may open a database: owner (everything), editor (data and design), viewer (read only).
CREATE TABLE IF NOT EXISTS base_members (
  database_id text NOT NULL REFERENCES base_databases(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (database_id, email)
);
CREATE INDEX IF NOT EXISTS base_members_email ON base_members(email);
CREATE TABLE IF NOT EXISTS base_tables (
  id          text PRIMARY KEY,
  database_id text NOT NULL REFERENCES base_databases(id) ON DELETE CASCADE,
  name        text NOT NULL,
  pg_name     text NOT NULL,
  description text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS base_tables_name ON base_tables(database_id, lower(name));
CREATE TABLE IF NOT EXISTS base_fields (
  id          text PRIMARY KEY,
  table_id    text NOT NULL REFERENCES base_tables(id) ON DELETE CASCADE,
  name        text NOT NULL,
  pg_name     text NOT NULL,
  type        text NOT NULL,
  options     jsonb NOT NULL DEFAULT '{}',
  required    boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS base_fields_name ON base_fields(table_id, lower(name));
-- Saved queries: a designer definition (kind 'design') or SQL written by hand ('sql'). sql is
-- what runs either way; for a design query it is regenerated from the definition on save.
CREATE TABLE IF NOT EXISTS base_queries (
  id          text PRIMARY KEY,
  database_id text NOT NULL REFERENCES base_databases(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('design', 'sql')),
  definition  jsonb,
  sql         text NOT NULL,
  description text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS base_queries_name ON base_queries(database_id, lower(name));
-- Forms: one table's records shown one at a time, laid out as its layout says (lib/formLayout.ts).
-- online links the form to Synergy Forms when it is published there (lib/forms.ts).
CREATE TABLE IF NOT EXISTS base_forms (
  id          text PRIMARY KEY,
  database_id text NOT NULL REFERENCES base_databases(id) ON DELETE CASCADE,
  table_id    text NOT NULL REFERENCES base_tables(id) ON DELETE CASCADE,
  name        text NOT NULL,
  layout      jsonb NOT NULL DEFAULT '{}',
  online      jsonb,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS base_forms_name ON base_forms(database_id, lower(name));
-- Reports: a table or saved query laid out for reading and printing (lib/reportLayout.ts).
CREATE TABLE IF NOT EXISTS base_reports (
  id          text PRIMARY KEY,
  database_id text NOT NULL REFERENCES base_databases(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('table', 'query')),
  source_id   text NOT NULL,
  layout      jsonb NOT NULL DEFAULT '{}',
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS base_reports_name ON base_reports(database_id, lower(name));
-- Lists views: how a table shows as gallery cards, a board and a calendar (lib/listViews.ts).
CREATE TABLE IF NOT EXISTS base_list_views (
  table_id    text PRIMARY KEY REFERENCES base_tables(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Comments on records (lib/comments.ts); row_id is the record's ID in the table.
CREATE TABLE IF NOT EXISTS base_comments (
  id          text PRIMARY KEY,
  table_id    text NOT NULL REFERENCES base_tables(id) ON DELETE CASCADE,
  row_id      bigint NOT NULL,
  author      text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS base_comments_row ON base_comments(table_id, row_id, created_at);
-- Data links: a secret address that reads a table or query as CSV, for Sheets (lib/dataLinks.ts).
CREATE TABLE IF NOT EXISTS base_links (
  token       text PRIMARY KEY,
  database_id text NOT NULL REFERENCES base_databases(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('table', 'query')),
  source_id   text NOT NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);
`;

export function db(): Db {
  global.__baseDb ??= createDb({
    devUrl: "postgres://postgres:postgres@127.0.0.1:5432/base",
    max: 10,
    types: parsers,
  });
  return global.__baseDb;
}

/** The catalog, created on first use (idempotent, under the shared migration lock). */
export function ready(): Promise<void> {
  global.__baseReady ??= db()
    .migrate(CATALOG, "synergy-base")
    .catch((err) => {
      global.__baseReady = undefined;
      throw err;
    });
  return global.__baseReady;
}
