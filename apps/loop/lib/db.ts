import { createDb } from "@synergy/db";

/**
 * A workspace belongs to its owner and the people added to it; its pages belong to the workspace.
 * A component is a live block that can sit on any number of pages, chats and emails at once, so it
 * has access of its own: its owner, people added to it, the people in its home workspace, and
 * (by default) anyone in the organization who has the link. The shared content of pages and
 * components is a Yjs document, saved by the collaboration server (server/collab.mjs), which
 * also keeps `text` up to date for search.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner       TEXT NOT NULL,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  added_by     TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS workspace_members_email_idx ON workspace_members (email);

CREATE TABLE IF NOT EXISTS pages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES pages(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  emoji        TEXT NOT NULL DEFAULT '',
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ydoc         BYTEA,
  text         TEXT NOT NULL DEFAULT '',
  embeds       UUID[] NOT NULL DEFAULT '{}',
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by  TEXT,
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pages_workspace_idx ON pages (workspace_id, parent_id, position);

CREATE TABLE IF NOT EXISTS components (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  owner        TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  link_access  TEXT NOT NULL DEFAULT 'org-edit' CHECK (link_access IN ('org-edit', 'org-view', 'people')),
  ydoc         BYTEA,
  text         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by  TEXT,
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS components_owner_idx ON components (owner);
CREATE INDEX IF NOT EXISTS components_workspace_idx ON components (workspace_id);

CREATE TABLE IF NOT EXISTS component_members (
  component_id UUID NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  added_by     TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (component_id, email)
);
CREATE INDEX IF NOT EXISTS component_members_email_idx ON component_members (email);

-- What each person opened last, for Recent on the home screen and so suite search finds a
-- component someone reached through an organization-wide link.
CREATE TABLE IF NOT EXISTS visits (
  email     TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('page', 'component')),
  item_id   UUID NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, item_kind, item_id)
);
CREATE INDEX IF NOT EXISTS visits_recent_idx ON visits (email, at DESC);

-- Deleted while someone on it was on legal hold: kept, hidden, still found by eDiscovery.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
ALTER TABLE components ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __loopDb?: Db; __loopReady?: Promise<void> };

export function db(): Db {
  if (!g.__loopDb) g.__loopDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/loop", max: 10 });
  return g.__loopDb;
}

export function ready(): Promise<void> {
  if (!g.__loopReady) {
    g.__loopReady = db().migrate(SCHEMA, "loop").catch((e) => {
      g.__loopReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__loopReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}
