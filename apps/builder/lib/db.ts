/**
 * Builder's own Postgres: the apps (their draft and published definitions), who may open them,
 * and every published version. The records an app works with stay in Synergy Base.
 */
import { createDb, type Db } from "@synergy/db";

declare global {
  // eslint-disable-next-line no-var
  var __builderDb: Db | undefined;
  // eslint-disable-next-line no-var
  var __builderReady: Promise<void> | undefined;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS builder_apps (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  color             text NOT NULL DEFAULT '#a4373a',
  -- What the studio edits; people running the app see the published version.
  draft             jsonb NOT NULL,
  published         jsonb,
  published_version integer NOT NULL DEFAULT 0,
  published_at      timestamptz,
  published_by      text,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Deleted while its maker was on a legal hold: hidden from everyone, kept for eDiscovery.
  held_deleted_at   timestamptz
);
-- Who may open an app: owner (everything), editor (edit and publish, Power Apps' co-owner) or
-- user (run the published app). email '*' shares an app with everyone in the organization.
CREATE TABLE IF NOT EXISTS builder_members (
  app_id   text NOT NULL REFERENCES builder_apps(id) ON DELETE CASCADE,
  email    text NOT NULL,
  role     text NOT NULL CHECK (role IN ('owner', 'editor', 'user')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, email)
);
CREATE INDEX IF NOT EXISTS builder_members_email ON builder_members(email);
-- Every published version, so an earlier one can be restored.
CREATE TABLE IF NOT EXISTS builder_versions (
  app_id       text NOT NULL REFERENCES builder_apps(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  definition   jsonb NOT NULL,
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, version)
);
`;

export function db(): Db {
  global.__builderDb ??= createDb({ devUrl: "postgres://postgres:postgres@127.0.0.1:5432/builder", max: 10 });
  return global.__builderDb;
}

/** The tables, created on first use (idempotent, under the shared migration lock). */
export function ready(): Promise<void> {
  global.__builderReady ??= db()
    .migrate(SCHEMA, "synergy-builder")
    .catch((err) => {
      global.__builderReady = undefined;
      throw err;
    });
  return global.__builderReady;
}
