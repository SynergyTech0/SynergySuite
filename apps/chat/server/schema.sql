-- SynergyChat schema (idempotent)
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#5b6af0',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS channels (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('public','private','dm')),
    name        TEXT,                -- null for DMs
    topic       TEXT NOT NULL DEFAULT '',
    dm_key      TEXT UNIQUE,         -- "minUserId:maxUserId" for DMs
    created_by  BIGINT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_name_uq ON channels (lower(name)) WHERE kind <> 'dm';

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_msg BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS channel_members_user_idx ON channel_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
    id          BIGSERIAL PRIMARY KEY,
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    parent_id   BIGINT REFERENCES messages(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_parent_idx ON messages (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reactions (
    message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- ===== Workspaces (multi-workspace, Slack-style) =====
CREATE TABLE IF NOT EXISTS workspaces (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    created_by  BIGINT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);

-- Channels belong to a workspace.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS channels_workspace_idx ON channels (workspace_id);

-- Channel-name uniqueness is now PER workspace (was global). Drop the old
-- global index and add a workspace-scoped one under a new name.
DROP INDEX IF EXISTS channels_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS channels_name_wsuq ON channels (workspace_id, lower(name)) WHERE kind <> 'dm';

-- DM uniqueness is now per workspace too (was a global column UNIQUE on dm_key).
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_dm_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS channels_dm_key_wsuq ON channels (workspace_id, dm_key) WHERE kind = 'dm';

-- Legal hold: a held sender's deleted message keeps its text here, never shown by the
-- normal API (MSG_COLS leaves it out) but still found by compliance search.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS held_body TEXT;

-- Legal hold: what a held sender's edit replaced. Never read by the normal API; returned
-- by compliance search and export as the message's previous versions.
CREATE TABLE IF NOT EXISTS message_held_versions (
    id          BIGSERIAL PRIMARY KEY,
    message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_held_versions_msg_idx ON message_held_versions (message_id, id);
