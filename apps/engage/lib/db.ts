import { createDb } from "@synergy/db";

/**
 * Communities, posts and the company home page. A post with no community is posted to the whole
 * company (the author's storyline); a community post is seen by whoever can see the community.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  about      TEXT NOT NULL DEFAULT '',
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  privacy      TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private')),
  color        TEXT NOT NULL DEFAULT 'blue',
  official     BOOLEAN NOT NULL DEFAULT false,
  chat_url     TEXT NOT NULL DEFAULT '',
  chat_name    TEXT NOT NULL DEFAULT '',
  site_url     TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS members (
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, email)
);
CREATE INDEX IF NOT EXISTS members_email_idx ON members (email);

CREATE TABLE IF NOT EXISTS posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
  author       TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'discussion' CHECK (kind IN ('discussion', 'question', 'praise', 'poll', 'article')),
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  topics       TEXT[] NOT NULL DEFAULT '{}',
  mentions     TEXT[] NOT NULL DEFAULT '{}',
  praised      TEXT[] NOT NULL DEFAULT '{}',
  badge        TEXT,
  announcement BOOLEAN NOT NULL DEFAULT false,
  pinned       BOOLEAN NOT NULL DEFAULT false,
  best_answer  UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at    TIMESTAMPTZ,
  activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS posts_community_idx ON posts (community_id, activity_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author, activity_at DESC);
CREATE INDEX IF NOT EXISTS posts_activity_idx ON posts (activity_at DESC, id);
CREATE INDEX IF NOT EXISTS posts_topics_idx ON posts USING gin (topics);

CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES comments(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  mentions   TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at  TIMESTAMPTZ,
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at);

-- One reaction per person on a post or a comment.
CREATE TABLE IF NOT EXISTS reactions (
  target_id UUID NOT NULL,
  email     TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('like', 'love', 'celebrate', 'insightful', 'laugh', 'sad')),
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, email)
);

CREATE TABLE IF NOT EXISTS poll_options (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id  UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS poll_options_post_idx ON poll_options (post_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id   UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  email     TEXT NOT NULL,
  PRIMARY KEY (post_id, email)
);

CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL,
  followee TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower, followee)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee);

CREATE TABLE IF NOT EXISTS saved (
  email   TEXT NOT NULL,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, post_id)
);

-- The company home page: links company admins put there for everyone.
CREATE TABLE IF NOT EXISTS quick_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __engageDb?: Db; __engageReady?: Promise<void> };

export function db(): Db {
  if (!g.__engageDb) g.__engageDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/engage", max: 10 });
  return g.__engageDb;
}

export function ready(): Promise<void> {
  if (!g.__engageReady) {
    g.__engageReady = db().migrate(SCHEMA, "engage").catch((e) => {
      g.__engageReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__engageReady;
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
