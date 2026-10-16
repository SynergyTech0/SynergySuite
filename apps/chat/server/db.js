const fs = require('fs');
const path = require('path');
const { createDb } = require('@synergy/db');

const db = createDb({ devUrl: 'postgres://chat:chat@127.0.0.1:5470/synergychat' });
const q = db.q;

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.migrate(sql, 'chat');

  // ---- workspace bootstrap + one-time backfill of the pre-workspace data ----
  const wsName = process.env.DEFAULT_WORKSPACE_NAME || 'Synergytech';
  let def = (await q('SELECT id FROM workspaces ORDER BY id LIMIT 1')).rows[0];
  if (!def) {
    def = (await q('INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id', [wsName, slugify(wsName)])).rows[0];
  }
  const defId = def.id;
  // Any channel that predates workspaces joins the default workspace.
  await q('UPDATE channels SET workspace_id = $1 WHERE workspace_id IS NULL', [defId]);
  // Everyone is a member of the default (company) workspace.
  await q('INSERT INTO workspace_members (workspace_id, user_id) SELECT $1, id FROM users ON CONFLICT DO NOTHING', [defId]);
  // Ensure the default workspace has a #general.
  await q(
    `INSERT INTO channels (kind, name, topic, workspace_id)
     SELECT 'public', 'general', 'Company-wide announcements and chatter', $1
     WHERE NOT EXISTS (SELECT 1 FROM channels WHERE workspace_id = $1 AND kind <> 'dm' AND lower(name) = 'general')`,
    [defId]);
}

async function defaultWorkspaceId() {
  const { rows } = await q('SELECT id FROM workspaces ORDER BY id LIMIT 1');
  return rows[0]?.id ?? null;
}

async function userWorkspaces(userId) {
  const { rows } = await q(
    `SELECT w.id, w.name, w.slug FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
     ORDER BY w.id`, [userId]);
  return rows;
}

async function isWorkspaceMember(wsId, userId) {
  const { rows } = await q('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wsId, userId]);
  return rows.length > 0;
}

async function workspaceMemberIds(wsId) {
  const { rows } = await q('SELECT user_id FROM workspace_members WHERE workspace_id = $1', [wsId]);
  return rows.map(r => Number(r.user_id));
}

// Create a brand-new workspace, add the creator, and seed a #general channel.
async function createWorkspace(name, userId) {
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 60; i++) {
    if (!(await q('SELECT 1 FROM workspaces WHERE slug = $1', [slug])).rows[0]) break;
    slug = `${base}-${i + 2}`;
  }
  const ws = (await q(
    'INSERT INTO workspaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id, name, slug',
    [String(name).trim().slice(0, 60), slug, userId])).rows[0];
  await q('INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ws.id, userId]);
  const gen = (await q(
    `INSERT INTO channels (kind, name, topic, workspace_id, created_by)
     VALUES ('public', 'general', 'Company-wide announcements and chatter', $1, $2) RETURNING id`,
    [ws.id, userId])).rows[0];
  await q('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gen.id, userId]);
  return ws;
}

const COLORS = ['#5b6af0', '#0e9f6e', '#d9480f', '#9333ea', '#0284c7', '#be185d', '#b45309', '#4d7c0f'];
function colorFor(email) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const userCache = new Map(); // email -> user row (refreshed on restart)

async function upsertUser(email, name) {
  const cached = userCache.get(email);
  if (cached) return cached;
  const { rows } = await q(
    `INSERT INTO users (email, name, color) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
     RETURNING *`,
    [email, name, colorFor(email)]
  );
  const user = rows[0];
  // Every signed-in user lands in the default (company) workspace and its #general.
  const defId = await defaultWorkspaceId();
  if (defId) {
    await q('INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [defId, user.id]);
    await q(
      `INSERT INTO channel_members (channel_id, user_id)
       SELECT id, $1 FROM channels WHERE workspace_id = $2 AND kind <> 'dm' AND lower(name) = 'general'
       ON CONFLICT DO NOTHING`,
      [user.id, defId]);
  }
  userCache.set(email, user);
  return user;
}

async function memberIds(channelId) {
  const { rows } = await q('SELECT user_id FROM channel_members WHERE channel_id = $1', [channelId]);
  return rows.map(r => Number(r.user_id));
}

async function isMember(channelId, userId) {
  const { rows } = await q(
    'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, userId]);
  return rows.length > 0;
}

module.exports = {
  pool: db.pool, q, migrate, upsertUser, memberIds, isMember,
  defaultWorkspaceId, userWorkspaces, isWorkspaceMember, workspaceMemberIds, createWorkspace,
};
