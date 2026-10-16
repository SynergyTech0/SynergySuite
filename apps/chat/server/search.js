// Suite search (POST /api/search, see @synergy/search): the messages the signed-in person can
// read in the app today, i.e. messages in channels and DMs they are a member of, the same
// rule as GET /api/channels/:id/messages. Deleted messages (including text a hold kept in
// held_body) never come back; those are for eDiscovery only.
const db = require('./db');
const { readSearchQuery, queryToSql, snippet, clipText } = require('@synergy/search');

const APP = 'chat';

// The app opens a channel, scrolls to a message and opens its thread from these params.
function urlOf(r) {
  const p = new URLSearchParams();
  if (r.workspace_id) p.set('ws', String(r.workspace_id));
  p.set('channel', String(r.channel_id));
  p.set('msg', String(r.id));
  if (r.parent_id) p.set('thread', String(r.parent_id));
  return `/?${p}`;
}

function titleOf(r) {
  const place = r.channel_kind === 'dm'
    ? `DM with ${r.dm_with || 'yourself'}`
    : `#${r.channel_name}`;
  return r.parent_id ? `${place} (thread reply)` : place;
}

async function search(user, body) {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes('message')) return { app: APP, results: [] };
  const kw = queryToSql(s.parsed, ['m.body'], 3);
  const { rows } = await db.q(
    `SELECT m.id, m.channel_id, m.parent_id, m.body, m.created_at,
            u.name AS sender, c.kind AS channel_kind, c.name AS channel_name, c.workspace_id,
            (SELECT string_agg(x.name, ', ' ORDER BY x.name)
               FROM channel_members o JOIN users x ON x.id = o.user_id
              WHERE o.channel_id = c.id AND o.user_id <> $1) AS dm_with
       FROM messages m
       JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
       JOIN channels c ON c.id = m.channel_id
       JOIN users u ON u.id = m.user_id
      WHERE m.deleted_at IS NULL AND ${kw.sql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2`,
    [user.id, s.limit, ...kw.params]);
  return {
    app: APP,
    results: rows.map(r => ({
      id: `message:${r.id}`,
      kind: 'message',
      title: titleOf(r),
      snippet: snippet(r.body, s.parsed),
      date: new Date(r.created_at).toISOString(),
      url: urlOf(r),
      person: r.sender,
      ...(s.text ? { text: clipText(r.body) } : {}),
    })),
  };
}

module.exports = { search };
