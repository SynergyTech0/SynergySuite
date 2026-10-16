import { createDb } from "@synergy/db";

/**
 * A video belongs to its owner. Who else can watch it: the people it is shared with, everyone in
 * the organization (visibility 'org'), and anyone holding its link (share_token). Only the owner
 * changes it. Comments can be pinned to a moment in the video.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner           TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  source_name     TEXT NOT NULL,
  source_ext      TEXT NOT NULL,
  origin          TEXT NOT NULL DEFAULT 'upload' CHECK (origin IN ('upload', 'recording', 'editor')),
  size            BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  progress        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  duration        DOUBLE PRECISION,
  width           INTEGER,
  height          INTEGER,
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'org')),
  share_token     TEXT UNIQUE,
  allow_comments  BOOLEAN NOT NULL DEFAULT true,
  chapters        JSONB NOT NULL DEFAULT '[]',
  captions        TEXT,
  captions_source TEXT CHECK (captions_source IN ('upload', 'ai')),
  captions_status TEXT NOT NULL DEFAULT 'none' CHECK (captions_status IN ('none', 'working', 'ready', 'failed')),
  captions_error  TEXT,
  transcript      TEXT NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',
  anon_views      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Deleted while the owner was on legal hold: kept, hidden, still found by eDiscovery.
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS videos_owner_idx ON videos (owner, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_org_idx ON videos (created_at DESC) WHERE visibility = 'org';

CREATE TABLE IF NOT EXISTS video_members (
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  email    TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, email)
);
CREATE INDEX IF NOT EXISTS video_members_email_idx ON video_members (email);

CREATE TABLE IF NOT EXISTS comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author          TEXT NOT NULL,
  body            TEXT NOT NULL,
  at_seconds      DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comments_video_idx ON comments (video_id, created_at);
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (author);

-- One row per signed-in viewer; people watching through a link count in videos.anon_views.
CREATE TABLE IF NOT EXISTS video_views (
  video_id  UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewer    TEXT NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, viewer)
);

-- Video editor projects (.fcproj), with the library videos they were cut from so reopening one
-- brings its media back.
CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner       TEXT NOT NULL,
  name        TEXT NOT NULL,
  size        BIGINT NOT NULL DEFAULT 0,
  video_ids   UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner, modified_at DESC);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __streamDb?: Db; __streamReady?: Promise<void> };

export function db(): Db {
  if (!g.__streamDb) g.__streamDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/stream", max: 10 });
  return g.__streamDb;
}

export function ready(): Promise<void> {
  if (!g.__streamReady) {
    g.__streamReady = db().migrate(SCHEMA, "stream").catch((e) => {
      g.__streamReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__streamReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}
