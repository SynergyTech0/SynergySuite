// Team workspaces for the Groups app (see the Groups contract). A Microsoft 365-style team is a
// Chat workspace keyed by its group ("groups:<uuid>"), with one public channel per team channel
// key. Groups pushes "make it exactly this" over the internal network whenever the group changes
// and re-sends it periodically, so every call here is idempotent. Messages are never deleted:
// people leave, history stays for compliance.
const express = require('express');
const db = require('./db');
const hub = require('./ws');
const { messageRow } = require('./api');
const { cameThroughGateway, displayNameFromEmail } = require('@synergy/identity');
const { appUrl } = require('@synergy/config');

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

const SOURCE_RE = /^groups:[0-9a-f-]{36}$/;

// Suite servers hold PROXY_SHARED_SECRET; the gateway never forwards /api/svc/. With no secret
// configured (local dev) the routes are open, but never in production.
function fromSuiteServer(req) {
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return cameThroughGateway(req.headers, secret);
}

router.use((req, res, next) => fromSuiteServer(req) ? next() : res.status(404).json({ error: 'Not found' }));

router.param('source', (req, res, next, source) =>
  SOURCE_RE.test(source) ? next() : res.status(400).json({ error: 'bad source' }));

const chatUrl = () => appUrl('chat');
const wsUrl = wsId => `${chatUrl()}/?ws=${wsId}`;
const channelUrl = (wsId, chId) => `${wsUrl(wsId)}&channel=${chId}`;

// Same rule as the normal create route.
function channelSlug(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

const normEmail = e => String(e || '').trim().toLowerCase();

// Validate and normalise the PUT body. Throws a 400-shaped error.
function parseTeam(b) {
  const bad = message => Object.assign(new Error(message), { status: 400 });
  if (!b || typeof b !== 'object') throw bad('body must be a JSON object');
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw bad('name required');
  if (!Array.isArray(b.members)) throw bad('members must be an array');
  if (!Array.isArray(b.channels)) throw bad('channels must be an array');
  const members = new Map(); // email -> display name
  for (const m of b.members) {
    const email = normEmail(m && m.email);
    if (!email.includes('@')) throw bad('every member needs an email');
    if (!members.has(email)) members.set(email, String(m.name || '').trim().slice(0, 120) || displayNameFromEmail(email));
  }
  const channels = [];
  const keys = new Set();
  for (const c of b.channels) {
    const key = String((c && c.key) || '').trim().slice(0, 120);
    const slug = channelSlug(c && c.name);
    if (!key || !slug) throw bad('every channel needs a key and a name');
    if (keys.has(key)) continue;
    keys.add(key);
    channels.push({ key, name: slug, topic: c.topic == null ? null : String(c.topic).slice(0, 250) });
  }
  return { name, members, channels };
}

async function teamWorkspace(source) {
  return (await db.q('SELECT id, name FROM workspaces WHERE source = $1', [source])).rows[0] || null;
}

// First free channel name in the workspace: name, name-2, name-3, ... (ignoring channel `selfId`).
async function freeChannelName(client, wsId, name, selfId) {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? name : `${name.slice(0, 76)}-${i}`;
    const taken = (await client.query(
      `SELECT 1 FROM channels WHERE workspace_id = $1 AND kind <> 'dm' AND lower(name) = $2 AND id <> $3`,
      [wsId, candidate, selfId || 0])).rows[0];
    if (!taken) return candidate;
  }
  throw new Error('could not find a free channel name');
}

// ---- make the team workspace exactly this ----
router.put('/teams/:source', wrap(async (req, res) => {
  let team;
  try { team = parseTeam(req.body); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const source = req.params.source;
  const emails = [...team.members.keys()];

  const client = await db.pool.connect();
  let wsId; let out; let invited; let removed;
  try {
    await client.query('BEGIN');
    // One writer per team at a time (Groups may push and repair concurrently).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chat-team:${source}`]);

    // Workspace: create or rename.
    let ws = (await client.query('SELECT id, name FROM workspaces WHERE source = $1', [source])).rows[0];
    if (!ws) {
      const base = db.slugify(team.name);
      let slug = base;
      for (let i = 0; i < 60; i++) {
        if (!(await client.query('SELECT 1 FROM workspaces WHERE slug = $1', [slug])).rows[0]) break;
        slug = `${base}-${i + 2}`;
      }
      ws = (await client.query(
        'INSERT INTO workspaces (name, slug, source) VALUES ($1, $2, $3) RETURNING id, name', [team.name, slug, source])).rows[0];
    } else if (ws.name !== team.name) {
      await client.query('UPDATE workspaces SET name = $2 WHERE id = $1', [ws.id, team.name]);
    }
    wsId = Number(ws.id);

    // People: upsert unknown users by email (existing users keep the name they signed in with).
    for (const [email, name] of team.members) {
      await client.query(
        'INSERT INTO users (email, name, color) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
        [email, name, db.colorFor(email)]);
    }
    const ids = (await client.query('SELECT id FROM users WHERE email = ANY($1)', [emails])).rows.map(r => Number(r.id));

    // Workspace members: exactly the team.
    removed = (await client.query(
      'DELETE FROM workspace_members WHERE workspace_id = $1 AND NOT (user_id = ANY($2)) RETURNING user_id',
      [wsId, ids])).rows.map(r => Number(r.user_id));
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
      [wsId, ids]);
    // Nobody outside the team stays in any of its channels (DMs aside).
    await client.query(
      `DELETE FROM channel_members cm USING channels c
        WHERE c.id = cm.channel_id AND c.workspace_id = $1 AND c.kind <> 'dm' AND NOT (cm.user_id = ANY($2))`,
      [wsId, ids]);

    // Channels: one per key, members exactly the team. Unlisted keys are left as they are.
    out = [];
    invited = new Map(); // userId -> [channel rows]
    for (const want of team.channels) {
      let ch = (await client.query(
        'SELECT * FROM channels WHERE workspace_id = $1 AND source_key = $2', [wsId, want.key])).rows[0];
      if (!ch) {
        const name = await freeChannelName(client, wsId, want.name);
        ch = (await client.query(
          `INSERT INTO channels (kind, name, topic, workspace_id, source_key)
           VALUES ('public', $1, $2, $3, $4) RETURNING *`,
          [name, want.topic || '', wsId, want.key])).rows[0];
      } else {
        const name = ch.name === want.name ? ch.name : await freeChannelName(client, wsId, want.name, ch.id);
        const topic = want.topic == null ? ch.topic : want.topic;
        if (name !== ch.name || topic !== ch.topic) {
          ch = (await client.query(
            'UPDATE channels SET name = $2, topic = $3 WHERE id = $1 RETURNING *', [ch.id, name, topic])).rows[0];
        }
      }
      const added = (await client.query(
        `INSERT INTO channel_members (channel_id, user_id) SELECT $1, unnest($2::bigint[])
         ON CONFLICT DO NOTHING RETURNING user_id`, [ch.id, ids])).rows.map(r => Number(r.user_id));
      for (const uid of added) invited.set(uid, [...(invited.get(uid) || []), ch]);
      out.push({ key: want.key, id: Number(ch.id), name: ch.name, url: channelUrl(wsId, ch.id) });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Tell connected people; their client reloads its roster on either event.
  for (const [uid, chans] of invited) {
    for (const ch of chans) hub.sendTo(uid, { type: 'channel.invited', channel: ch });
  }
  for (const uid of removed) hub.sendTo(uid, { type: 'channel.removed', workspaceId: wsId });

  res.json({ workspaceId: wsId, url: wsUrl(wsId), channels: out });
}));

// ---- latest top-level messages across the team's channels ----
router.get('/teams/:source/activity', wrap(async (req, res) => {
  const ws = await teamWorkspace(req.params.source);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const { rows } = await db.q(
    `SELECT m.id, m.channel_id, m.body, m.created_at, c.source_key, c.name AS channel_name,
       u.email, u.name AS author_name,
       COALESCE((SELECT count(*) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL), 0)::int AS reply_count
     FROM messages m
     JOIN channels c ON c.id = m.channel_id
     JOIN users u ON u.id = m.user_id
     WHERE c.workspace_id = $1 AND c.source_key IS NOT NULL
       AND m.parent_id IS NULL AND m.deleted_at IS NULL
     ORDER BY m.id DESC LIMIT $2`, [ws.id, limit]);
  res.json({
    messages: rows.map(r => ({
      id: Number(r.id),
      channelKey: r.source_key,
      channelName: r.channel_name,
      author: { email: r.email, name: r.author_name },
      body: r.body,
      createdAt: r.created_at,
      replyCount: r.reply_count,
      url: `${channelUrl(ws.id, r.channel_id)}&msg=${r.id}`,
    })),
  });
}));

// ---- post into a team channel as a member ----
router.post('/teams/:source/messages', wrap(async (req, res) => {
  const { channelKey, email } = req.body || {};
  const body = String((req.body || {}).body || '').slice(0, 8000).trim();
  if (!body) return res.status(400).json({ error: 'empty message' });
  const ws = await teamWorkspace(req.params.source);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const ch = (await db.q(
    'SELECT id FROM channels WHERE workspace_id = $1 AND source_key = $2', [ws.id, String(channelKey || '')])).rows[0];
  if (!ch) return res.status(404).json({ error: 'no such channel' });
  const user = (await db.q('SELECT id FROM users WHERE email = $1', [normEmail(email)])).rows[0];
  // Groups has checked team membership already; the channel is still the authority here.
  if (!user || !await db.isMember(ch.id, user.id)) return res.status(403).json({ error: 'not a member' });
  const chId = Number(ch.id);
  const { rows } = await db.q(
    'INSERT INTO messages (channel_id, user_id, body) VALUES ($1,$2,$3) RETURNING id', [chId, user.id, body]);
  const msg = await messageRow(rows[0].id);
  await db.q(
    `UPDATE channel_members SET last_read_msg = GREATEST(last_read_msg, $3)
     WHERE channel_id = $1 AND user_id = $2`, [chId, user.id, msg.id]);
  hub.broadcastChannel(chId, { type: 'message.new', message: msg });
  res.json(msg);
}));

// ---- team deleted: everyone leaves, the messages stay ----
router.delete('/teams/:source', wrap(async (req, res) => {
  const ws = await teamWorkspace(req.params.source);
  if (!ws) return res.json({ ok: true });
  const removed = (await db.q(
    'DELETE FROM workspace_members WHERE workspace_id = $1 RETURNING user_id', [ws.id])).rows.map(r => Number(r.user_id));
  await db.q(
    'DELETE FROM channel_members cm USING channels c WHERE c.id = cm.channel_id AND c.workspace_id = $1', [ws.id]);
  for (const uid of removed) hub.sendTo(uid, { type: 'channel.removed', workspaceId: Number(ws.id) });
  res.json({ ok: true });
}));

// Anything else under /api/svc is not ours; never fall through to the signed-in API.
router.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = { router };
