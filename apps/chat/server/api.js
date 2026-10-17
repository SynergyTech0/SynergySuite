const express = require('express');
const db = require('./db');
const hub = require('./ws');
const compliance = require('./compliance');
const suiteSearch = require('./search');
const whiteboard = require('./whiteboard');
const { SearchInputError } = require('@synergy/search');

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// ---- SynergyDrive integration: attachments are stored in the user's Drive ----
// We relay the raw multipart upload to the Drive auth-shim, passing the signed-in
// email; the shim mints the Drive identity (uuid5 of email + domain tenant) and
// forwards to the Drive API. So chat files land in the exact same Drive the user
// sees at drive.<SUITE_DOMAIN> — no separate blob store, no duplicated auth.
const DRIVE_UPLOAD_URL = process.env.DRIVE_UPLOAD_URL || 'http://shim:8012';
const DRIVE_PUBLIC_URL = process.env.DRIVE_PUBLIC_URL || `https://drive.${process.env.SUITE_DOMAIN}`;

router.post('/upload', express.raw({ type: () => true, limit: '64mb' }), wrap(async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Empty upload' });
  const ct = req.headers['content-type'] || 'application/octet-stream';
  let r;
  try {
    r = await fetch(`${DRIVE_UPLOAD_URL}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': ct, 'X-Auth-Request-Email': req.user.email },
      body,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach SynergyDrive: ' + (e.message || e) });
  }
  const text = await r.text();
  if (!r.ok) return res.status(502).json({ error: 'Drive rejected the upload', detail: text.slice(0, 300) });
  let f;
  try { f = JSON.parse(text); } catch { return res.status(502).json({ error: 'Bad response from Drive' }); }
  res.json({ id: f.id, name: f.name, size: f.size_bytes ?? null, mimetype: f.mimetype, url: `${DRIVE_PUBLIC_URL}/preview/${f.id}` });
}));

const MSG_COLS = `m.id, m.channel_id, m.user_id, m.parent_id, m.body,
  m.created_at, m.edited_at, m.deleted_at`;

async function messageRow(id) {
  const { rows } = await db.q(
    `SELECT ${MSG_COLS},
       COALESCE((SELECT count(*) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL), 0)::int AS reply_count,
       COALESCE((SELECT json_agg(json_build_object('emoji', x.emoji, 'user_id', x.user_id))
                 FROM reactions x WHERE x.message_id = m.id), '[]'::json) AS reactions
     FROM messages m WHERE m.id = $1`, [id]);
  return rows[0];
}

// ---- bootstrap ---- (scoped to a workspace; ?ws=<id>, defaults to the first)
router.get('/me', wrap(async (req, res) => {
  const me = req.user;
  const workspaces = await db.userWorkspaces(me.id);
  const online = hub.onlineIds();
  const directory = (await db.q('SELECT id, email, name, color FROM users ORDER BY name')).rows;
  if (!workspaces.length) {
    return res.json({ me, workspaces: [], activeWorkspace: null, users: directory, directory, channels: [], browsable: [], online });
  }
  let wsId = Number(req.query.ws) || 0;
  if (!workspaces.some(w => Number(w.id) === wsId)) wsId = Number(workspaces[0].id);

  // Members of the active workspace — used for DMs and mention autocomplete.
  const users = (await db.q(
    `SELECT u.id, u.email, u.name, u.color FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = $1
     ORDER BY u.name`, [wsId])).rows;

  const channels = (await db.q(
    `SELECT c.id, c.kind, c.name, c.topic, c.dm_key, cm.last_read_msg,
       (SELECT count(*) FROM channel_members x WHERE x.channel_id = c.id)::int AS member_count,
       COALESCE((SELECT count(*) FROM messages m
          WHERE m.channel_id = c.id AND m.id > cm.last_read_msg
            AND m.deleted_at IS NULL AND m.user_id <> $1), 0)::int AS unread,
       EXISTS (SELECT 1 FROM messages m
          WHERE m.channel_id = c.id AND m.id > cm.last_read_msg AND m.deleted_at IS NULL
            AND m.user_id <> $1 AND m.body ILIKE '%@' || $2 || '%') AS has_mention,
       (SELECT json_agg(x.user_id) FROM channel_members x WHERE x.channel_id = c.id) AS member_ids
     FROM channels c JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
     WHERE c.workspace_id = $3
     ORDER BY c.kind = 'dm', lower(c.name)`, [me.id, me.name, wsId])).rows;

  const browsable = (await db.q(
    `SELECT c.id, c.name, c.topic,
       (SELECT count(*) FROM channel_members x WHERE x.channel_id = c.id)::int AS member_count
     FROM channels c
     WHERE c.kind = 'public' AND c.workspace_id = $2 AND NOT EXISTS
       (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1)
     ORDER BY lower(c.name)`, [me.id, wsId])).rows;

  res.json({ me, workspaces, activeWorkspace: wsId, users, directory, channels, browsable, online });
}));

// ---- workspaces ----
router.post('/workspaces', wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Workspace name is too short' });
  const ws = await db.createWorkspace(name.slice(0, 60), req.user.id);
  res.json(ws);
}));

// ---- channels ----
router.post('/channels', wrap(async (req, res) => {
  const { name, topic = '', kind = 'public', workspaceId } = req.body || {};
  const wsId = Number(workspaceId);
  if (!wsId || !await db.isWorkspaceMember(wsId, req.user.id)) return res.status(403).json({ error: 'not a workspace member' });
  const clean = String(name || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) return res.status(400).json({ error: 'invalid channel name' });
  if (!['public', 'private'].includes(kind)) return res.status(400).json({ error: 'invalid kind' });
  let ch;
  try {
    ch = (await db.q(
      `INSERT INTO channels (kind, name, topic, created_by, workspace_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [kind, clean, String(topic).slice(0, 250), req.user.id, wsId])).rows[0];
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'channel exists' });
    throw e;
  }
  await db.q('INSERT INTO channel_members (channel_id, user_id) VALUES ($1,$2)', [ch.id, req.user.id]);
  // Notify only this workspace's members (other workspaces don't care).
  if (kind === 'public') {
    const event = { type: 'channel.created', channel: { ...ch, member_count: 1 } };
    for (const uid of await db.workspaceMemberIds(wsId)) hub.sendTo(uid, event);
  }
  res.json(ch);
}));

router.post('/channels/:id/join', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  const ch = (await db.q(`SELECT * FROM channels WHERE id = $1`, [chId])).rows[0];
  if (!ch || ch.kind !== 'public') return res.status(404).json({ error: 'not found' });
  await db.q(
    `INSERT INTO channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [chId, req.user.id]);
  hub.broadcastChannel(chId, { type: 'member.joined', channelId: chId, userId: Number(req.user.id) });
  res.json({ ok: true });
}));

router.post('/channels/:id/invite', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  const userId = Number((req.body || {}).userId);
  if (!await db.isMember(chId, req.user.id)) return res.status(403).json({ error: 'not a member' });
  const ch = (await db.q(`SELECT * FROM channels WHERE id = $1 AND kind <> 'dm'`, [chId])).rows[0];
  if (!ch) return res.status(404).json({ error: 'not found' });
  // Inviting into a channel also brings the person into that channel's workspace.
  if (ch.workspace_id) {
    await db.q('INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ch.workspace_id, userId]);
  }
  await db.q(
    `INSERT INTO channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [chId, userId]);
  hub.sendTo(userId, { type: 'channel.invited', channel: ch });
  hub.broadcastChannel(chId, { type: 'member.joined', channelId: chId, userId });
  res.json({ ok: true });
}));

router.post('/channels/:id/leave', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  await db.q('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [chId, req.user.id]);
  res.json({ ok: true });
}));

// ---- DMs ----
router.post('/dms', wrap(async (req, res) => {
  const otherId = Number((req.body || {}).userId);
  const wsId = Number((req.body || {}).workspaceId);
  const me = Number(req.user.id);
  if (!otherId) return res.status(400).json({ error: 'userId required' });
  if (!wsId || !await db.isWorkspaceMember(wsId, me)) return res.status(403).json({ error: 'not a workspace member' });
  if (!await db.isWorkspaceMember(wsId, otherId)) return res.status(400).json({ error: 'that person is not in this workspace' });
  const key = [Math.min(me, otherId), Math.max(me, otherId)].join(':');
  let ch = (await db.q('SELECT * FROM channels WHERE workspace_id = $1 AND dm_key = $2 AND kind = \'dm\'', [wsId, key])).rows[0];
  if (!ch) {
    try {
      ch = (await db.q(
        `INSERT INTO channels (kind, dm_key, created_by, workspace_id) VALUES ('dm', $1, $2, $3) RETURNING *`,
        [key, me, wsId])).rows[0];
    } catch (e) {
      if (e.code !== '23505') throw e;
      ch = (await db.q('SELECT * FROM channels WHERE workspace_id = $1 AND dm_key = $2 AND kind = \'dm\'', [wsId, key])).rows[0];
    }
    for (const uid of new Set([me, otherId])) {
      await db.q(
        'INSERT INTO channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [ch.id, uid]);
    }
    const withMembers = { ...ch, member_ids: [me, otherId], member_count: 2 };
    hub.sendTo(otherId, { type: 'channel.invited', channel: withMembers });
  }
  res.json(ch);
}));

// ---- messages ----
router.get('/channels/:id/messages', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  if (!await db.isMember(chId, req.user.id)) return res.status(403).json({ error: 'not a member' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const parent = req.query.parent ? Number(req.query.parent) : null;
  const before = req.query.before ? Number(req.query.before) : null;
  const params = [chId];
  let where = `m.channel_id = $1 AND ` + (parent ? `m.parent_id = $${params.push(parent)}` : 'm.parent_id IS NULL');
  if (before) where += ` AND m.id < $${params.push(before)}`;
  const { rows } = await db.q(
    `SELECT ${MSG_COLS},
       COALESCE((SELECT count(*) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL), 0)::int AS reply_count,
       COALESCE((SELECT json_agg(json_build_object('emoji', x.emoji, 'user_id', x.user_id))
                 FROM reactions x WHERE x.message_id = m.id), '[]'::json) AS reactions
     FROM messages m WHERE ${where}
     ORDER BY m.id ${parent ? 'ASC' : 'DESC'} LIMIT $${params.push(limit)}`, params);
  res.json(parent ? rows : rows.reverse());
}));

router.post('/channels/:id/messages', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  if (!await db.isMember(chId, req.user.id)) return res.status(403).json({ error: 'not a member' });
  const body = String((req.body || {}).body || '').slice(0, 8000).trim();
  const parentId = (req.body || {}).parentId ? Number(req.body.parentId) : null;
  if (!body) return res.status(400).json({ error: 'empty message' });
  if (parentId) {
    const p = (await db.q('SELECT channel_id FROM messages WHERE id = $1', [parentId])).rows[0];
    if (!p || Number(p.channel_id) !== chId) return res.status(400).json({ error: 'bad parent' });
  }
  const dlp = await compliance.checkMessageDlp(req.user, {
    channelId: chId, text: body, reply: !!parentId, override: (req.body || {}).dlpOverride,
  });
  if (dlp.refuse) return res.status(dlp.refuse.status).json(dlp.refuse.body);
  const { rows } = await db.q(
    `INSERT INTO messages (channel_id, user_id, parent_id, body) VALUES ($1,$2,$3,$4) RETURNING id`,
    [chId, req.user.id, parentId, body]);
  const msg = await messageRow(rows[0].id);
  dlp.report(msg.id);
  // sender has read their own message
  await db.q(
    `UPDATE channel_members SET last_read_msg = GREATEST(last_read_msg, $3)
     WHERE channel_id = $1 AND user_id = $2`, [chId, req.user.id, msg.id]);
  hub.broadcastChannel(chId, { type: 'message.new', message: msg });
  res.json(msg);
}));

// ---- whiteboard: the channel's board in the Whiteboard app, which every member can draw on ----
router.post('/channels/:id/whiteboard', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  if (!await db.isMember(chId, req.user.id)) return res.status(403).json({ error: 'not a member' });
  const ch = (await db.q('SELECT id, kind, name FROM channels WHERE id = $1', [chId])).rows[0];
  if (!ch) return res.status(404).json({ error: 'not found' });
  const people = (await db.q(
    'SELECT u.email FROM channel_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = $1', [chId])).rows.map(r => r.email);
  let board;
  try {
    board = await whiteboard.channelBoard(ch, req.user.email, people);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message });
  }
  if (board.created) {
    // Tell the channel, once, where its whiteboard is.
    const body = `Started a whiteboard for everyone here: [Open the whiteboard](${board.url})`;
    const { rows } = await db.q(
      'INSERT INTO messages (channel_id, user_id, body) VALUES ($1,$2,$3) RETURNING id', [chId, req.user.id, body]);
    hub.broadcastChannel(chId, { type: 'message.new', message: await messageRow(rows[0].id) });
  }
  res.json({ url: board.url, created: board.created });
}));

router.patch('/messages/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const body = String((req.body || {}).body || '').slice(0, 8000).trim();
  if (!body) return res.status(400).json({ error: 'empty message' });
  const own = (await db.q(
    'SELECT channel_id, parent_id FROM messages WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, req.user.id])).rows[0];
  if (!own) return res.status(404).json({ error: 'not found' });
  const dlp = await compliance.checkMessageDlp(req.user, {
    channelId: Number(own.channel_id), text: body, reply: !!own.parent_id, edit: true, override: (req.body || {}).dlpOverride,
  });
  if (dlp.refuse) return res.status(dlp.refuse.status).json(dlp.refuse.body);
  const rows = await compliance.editMessage(req.user, id, body);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const msg = await messageRow(id);
  dlp.report(id);
  hub.broadcastChannel(Number(rows[0].channel_id), { type: 'message.edited', message: msg });
  res.json(msg);
}));

router.delete('/messages/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await compliance.deleteMessages(req.user, [id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  hub.broadcastChannel(Number(rows[0].channel_id), {
    type: 'message.deleted', messageId: id,
    channelId: Number(rows[0].channel_id),
    parentId: rows[0].parent_id ? Number(rows[0].parent_id) : null,
  });
  res.json({ ok: true });
}));

router.post('/messages/:id/reactions', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const emoji = String((req.body || {}).emoji || '').slice(0, 16);
  if (!emoji) return res.status(400).json({ error: 'emoji required' });
  const m = (await db.q('SELECT channel_id FROM messages WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
  if (!m || !await db.isMember(Number(m.channel_id), req.user.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  const del = await db.q(
    'DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [id, req.user.id, emoji]);
  if (del.rowCount === 0) {
    await db.q('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)', [id, req.user.id, emoji]);
  }
  const msg = await messageRow(id);
  hub.broadcastChannel(Number(m.channel_id), { type: 'message.edited', message: msg });
  res.json(msg);
}));

// ---- read cursor ----
router.post('/channels/:id/read', wrap(async (req, res) => {
  const chId = Number(req.params.id);
  const lastId = Number((req.body || {}).lastMessageId) || 0;
  await db.q(
    `UPDATE channel_members SET last_read_msg = GREATEST(last_read_msg, $3)
     WHERE channel_id = $1 AND user_id = $2`, [chId, req.user.id, lastId]);
  res.json({ ok: true });
}));

// ---- search ----
router.get('/search', wrap(async (req, res) => {
  const qstr = String(req.query.q || '').trim();
  if (qstr.length < 2) return res.json([]);
  const wsId = Number(req.query.ws) || 0;
  const params = [req.user.id, qstr];
  const wsFilter = wsId ? ` AND c.workspace_id = $${params.push(wsId)}` : '';
  const { rows } = await db.q(
    `SELECT m.id, m.channel_id, m.body, m.created_at, m.user_id, c.name AS channel_name, c.kind
     FROM messages m
     JOIN channels c ON c.id = m.channel_id
     JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
     WHERE m.deleted_at IS NULL AND m.body ILIKE '%' || $2 || '%'${wsFilter}
     ORDER BY m.id DESC LIMIT 30`, params);
  res.json(rows);
}));

// ---- suite search (the Search app, on the signed-in person's behalf) ----
router.post('/search', wrap(async (req, res) => {
  try {
    res.json(await suiteSearch.search(req.user, req.body));
  } catch (e) {
    if (e instanceof SearchInputError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

module.exports = router;
