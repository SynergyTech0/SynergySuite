// Compliance protocol (see @synergy/compliance): the Admin center searches and exports
// messages over the internal network, and asks nothing of the gateway. Holds keep what a
// held person deletes (the text moves to held_body, never shown by the normal API), and a
// retention sweep blanks messages past the configured age unless their sender is on hold.
// A held sender's edits keep what they replaced (message_held_versions), searched with the
// message and exported as metadata.previousVersions.
const express = require('express');
const db = require('./db');
const {
  complianceAuthorized, createPolicyClient, parseQuery, queryToSql,
  MAX_PAGE, MAX_EXPORT_IDS,
} = require('@synergy/compliance');

const APP = 'chat';
const KINDS = ['message'];
const policy = createPolicyClient({ app: APP });

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Validate a SearchRequest. Dates are inclusive: a bare YYYY-MM-DD `to` covers that whole day.
function parseSearch(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('body must be a JSON object');
  if (b.query != null && typeof b.query !== 'string') throw bad('query must be a string');
  const list = (v, name) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw bad(`${name} must be an array of strings`);
    return v.map(x => x.trim().toLowerCase()).filter(Boolean);
  };
  const date = (v, name, end) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (typeof v !== 'string' || isNaN(d)) throw bad(`${name} must be an ISO date`);
    if (!end) return d;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(d.getTime() + 86400000) : new Date(d.getTime() + 1);
  };
  if (b.limit != null && (!Number.isInteger(b.limit) || b.limit < 1)) throw bad('limit must be a positive integer');
  let offset = 0;
  if (b.cursor != null && b.cursor !== '') {
    const raw = typeof b.cursor === 'string' ? Buffer.from(b.cursor, 'base64url').toString() : '';
    if (!/^\d+$/.test(raw)) throw bad('bad cursor');
    offset = Number(raw);
  }
  return {
    query: parseQuery(b.query),
    custodians: list(b.custodians, 'custodians'),
    kinds: list(b.kinds, 'kinds'),
    from: date(b.from, 'from', false),
    to: date(b.to, 'to', true),          // exclusive upper bound
    limit: Math.min(b.limit || 50, MAX_PAGE),
    offset,
  };
}

// ~200 characters of plain text around the first match, from the first of `texts` (the
// current text, then earlier versions) that has one.
function snippet(texts, parsed) {
  const terms = parsed.groups.flat();
  const all = texts.map(x => String(x || '').replace(/\s+/g, ' ').trim());
  const t = all.find(x => terms.some(term => x.toLowerCase().includes(term))) ?? all[0];
  const lower = t.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + t.slice(start, start + 200) + (start + 200 < t.length ? '…' : '');
}

const placeName = r => r.channel_kind === 'dm'
  ? `DM: ${[r.owner, ...(r.participants || [])].join(', ')}`
  : `#${r.channel_name}`;

// Every message, kept or live, with what search and export need. Blanked deletes are gone
// unless an earlier version was kept for a hold.
const ROWS = `
  SELECT m.id, m.channel_id, m.parent_id, m.created_at, m.edited_at, m.deleted_at,
         COALESCE(m.held_body, m.body) AS text, lower(u.email) AS owner, u.name AS owner_name,
         (SELECT string_agg(v.body, E'\n' ORDER BY v.id) FROM message_held_versions v WHERE v.message_id = m.id) AS history,
         c.kind AS channel_kind, c.name AS channel_name, c.topic AS channel_topic, w.name AS workspace,
         COALESCE((SELECT array_agg(lower(x.email) ORDER BY lower(x.email))
                     FROM channel_members cm JOIN users x ON x.id = cm.user_id
                    WHERE cm.channel_id = m.channel_id AND x.id <> m.user_id), '{}') AS participants
    FROM messages m
    JOIN users u ON u.id = m.user_id
    JOIN channels c ON c.id = m.channel_id
    LEFT JOIN workspaces w ON w.id = c.workspace_id
   WHERE (m.deleted_at IS NULL OR m.held_body IS NOT NULL
          OR EXISTS (SELECT 1 FROM message_held_versions v WHERE v.message_id = m.id))`;

function hit(r, parsed) {
  return {
    id: `message:${r.id}`,
    kind: 'message',
    title: `${placeName(r)}${r.parent_id ? ' (thread reply)' : ''}`,
    owner: r.owner,
    participants: r.participants,
    date: new Date(r.created_at).toISOString(),
    snippet: snippet([r.text, r.history], parsed),
    size: Buffer.byteLength(r.text),
    ...(r.deleted_at ? { deleted: true } : {}),
  };
}

async function search(body) {
  const s = parseSearch(body);
  if (s.kinds.length && !s.kinds.some(k => KINDS.includes(k))) return { app: APP, hits: [], total: 0 };
  const params = [];
  const p = v => `$${params.push(v)}`;
  const where = [];
  const kw = queryToSql(s.query, ['x.text', 'x.history'], 1);
  params.push(...kw.params);
  where.push(kw.sql);
  if (s.custodians.length) {
    const c = p(s.custodians);
    where.push(`(x.owner = ANY(${c}::text[]) OR x.participants && ${c}::text[])`);
  }
  if (s.from) where.push(`x.created_at >= ${p(s.from)}`);
  if (s.to) where.push(`x.created_at < ${p(s.to)}`);
  const base = `FROM (${ROWS}) x WHERE ${where.join(' AND ')}`;
  const total = Number((await db.q(`SELECT count(*) AS n ${base}`, params)).rows[0].n);
  const rows = (await db.q(
    `SELECT x.* ${base} ORDER BY x.created_at DESC, x.id DESC LIMIT ${p(s.limit)} OFFSET ${p(s.offset)}`,
    params)).rows;
  const next = s.offset + rows.length;
  return {
    app: APP,
    hits: rows.map(r => hit(r, s.query)),
    total,
    ...(next < total ? { nextCursor: Buffer.from(String(next)).toString('base64url') } : {}),
  };
}

async function exportItems(body) {
  const ids = body && body.ids;
  if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) throw bad('ids must be an array of strings');
  if (ids.length > MAX_EXPORT_IDS) throw bad(`at most ${MAX_EXPORT_IDS} ids`);
  const nums = ids.map(id => /^message:(\d+)$/.exec(id)).filter(Boolean).map(m => m[1]);
  if (!nums.length) return { items: [] };
  const rows = (await db.q(
    `SELECT x.*,
       (SELECT count(*) FROM messages r WHERE r.parent_id = x.id AND r.deleted_at IS NULL)::int AS reply_count,
       COALESCE((SELECT json_agg(json_build_object('emoji', rx.emoji, 'user', lower(ru.email)))
                   FROM reactions rx JOIN users ru ON ru.id = rx.user_id WHERE rx.message_id = x.id), '[]') AS reactions,
       COALESCE((SELECT json_agg(json_build_object('body', v.body, 'replacedAt', v.replaced_at) ORDER BY v.id)
                   FROM message_held_versions v WHERE v.message_id = x.id), '[]') AS previous_versions
       FROM (${ROWS}) x WHERE x.id = ANY($1::bigint[]) ORDER BY x.created_at`, [nums])).rows;
  const none = parseQuery('');
  return {
    items: rows.map(r => ({
      ...hit(r, none),
      app: APP,
      text: r.text,
      metadata: {
        workspace: r.workspace,
        channel: { id: Number(r.channel_id), kind: r.channel_kind, name: r.channel_kind === 'dm' ? null : r.channel_name, topic: r.channel_topic, title: placeName(r) },
        senderName: r.owner_name,
        // A reply points at its thread's root; a root message counts its replies.
        thread: r.parent_id ? { parentId: `message:${r.parent_id}` } : { replyCount: r.reply_count },
        editedAt: r.edited_at,
        deletedAt: r.deleted_at,
        reactions: r.reactions,
        previousVersions: r.previous_versions,
      },
    })),
  };
}

// Edit a user's message; a sender on hold keeps the text it replaces.
async function editMessage(user, id, body) {
  const held = await policy.onHold(user.email);
  return (await db.q(
    `WITH old AS (
       SELECT id, body FROM messages WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE
     ), kept AS (
       INSERT INTO message_held_versions (message_id, body) SELECT id, body FROM old WHERE $4 AND body <> $1
     )
     UPDATE messages m SET body = $1, edited_at = now() FROM old WHERE m.id = old.id RETURNING m.channel_id`,
    [body, id, user.id, held])).rows;
}

// Delete a user's messages the way the app always has (blank the body, keep a tombstone),
// except that a sender on hold keeps the text in held_body for compliance search. Without a
// hold, versions kept by an earlier hold go too.
async function deleteMessages(user, ids) {
  const held = await policy.onHold(user.email);
  if (!held) {
    await db.q(
      `DELETE FROM message_held_versions v USING messages m
        WHERE v.message_id = m.id AND m.id = ANY($1::bigint[]) AND m.user_id = $2 AND m.deleted_at IS NULL`,
      [ids, user.id]);
  }
  return (await db.q(
    `UPDATE messages SET deleted_at = now(), held_body = CASE WHEN $3 THEN body END, body = ''
     WHERE id = ANY($1::bigint[]) AND user_id = $2 AND deleted_at IS NULL
     RETURNING id, channel_id, parent_id`,
    [ids, user.id, held])).rows;
}

// ---- data loss prevention ----
// Before a message is saved (posts, replies, DMs, edits) its text is checked against the Admin
// center's DLP rules. The other members of the conversation are the recipients, so rules that
// only cover content leaving the organization apply when someone outside it is in the room.
// block refuses (422); warn refuses (409) unless the sender gives a reason (dlpOverride); audit
// and an overridden warn are saved. Every match is reported to the Admin center.
const MAX_JUSTIFICATION = 500;

function justificationOf(override) {
  const j = override && typeof override === 'object' ? override.justification : null;
  return typeof j === 'string' ? j.trim().slice(0, MAX_JUSTIFICATION) : '';
}

async function conversation(channelId, userId) {
  return (await db.q(
    `SELECT c.kind, c.name,
       COALESCE((SELECT array_agg(lower(u.email) ORDER BY lower(u.email))
                   FROM channel_members cm JOIN users u ON u.id = cm.user_id
                  WHERE cm.channel_id = c.id AND u.id <> $2), '{}') AS recipients
       FROM channels c WHERE c.id = $1`, [channelId, userId])).rows[0];
}

// Returns { refuse: { status, body } } when the message can't be saved as it is, otherwise
// { report(messageId) } to call once it is saved.
async function checkMessageDlp(user, { channelId, text, reply = false, edit = false, override }) {
  const none = { report() {} };
  const settings = await policy.dlpSettings();
  if (!settings.rules.some(r => r.enabled)) return none;
  const conv = await conversation(channelId, user.id);
  if (!conv) return none;
  const recipients = conv.recipients || [];
  const decision = await policy.checkDlp({ text, recipients });
  if (decision.action === 'allow') return none;
  const place = conv.kind === 'dm' ? `direct message to ${recipients.join(', ') || 'yourself'}` : `#${conv.name}`;
  const what = edit ? 'Edited message' : reply ? 'Reply' : 'Message';
  const justification = justificationOf(override);
  const overridden = decision.action === 'warn' && !!justification;
  const report = target => policy.reportDlp({
    actor: String(user.email).toLowerCase(),
    title: conv.kind === 'dm' ? `${what} in a ${place}` : `${what} in ${place}`,
    ...(target != null ? { target: `message:${target}` } : {}),
    action: decision.action,
    ...(overridden ? { overridden: true, justification } : {}),
    rules: decision.rules,
    matches: decision.matches.map(({ type, name, count }) => ({ type, name, count })),
    recipients,
  });
  if (decision.action === 'block' || (decision.action === 'warn' && !overridden)) {
    void report(null);
    return { refuse: { status: decision.action === 'block' ? 422 : 409, body: { error: decision.tip, dlp: decision } } };
  }
  return { report: id => { void report(id); } };
}

// Retention: blank messages older than the policy allows, sender by sender, skipping anyone on hold.
async function sweepRetention() {
  const days = await policy.retentionDays('message');
  if (days == null) return 0;
  const cutoff = new Date(Date.now() - days * 86400000);
  const owners = (await db.q(
    `SELECT DISTINCT u.id, u.email FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.deleted_at IS NULL AND m.created_at < $1`, [cutoff])).rows;
  let n = 0;
  for (const u of owners) {
    if (await policy.onHold(u.email)) continue;
    const ids = (await db.q(
      'SELECT id FROM messages WHERE user_id = $1 AND deleted_at IS NULL AND created_at < $2',
      [u.id, cutoff])).rows.map(r => r.id);
    n += (await deleteMessages(u, ids)).length;
  }
  return n;
}

function startRetentionSweep(everyMs = 3600000) {
  const run = () => sweepRetention().catch(e => console.error('[chat] retention sweep', e));
  setTimeout(run, 0);
  setInterval(run, everyMs).unref();
}

const router = express.Router();
router.use((req, res, next) => {
  if (!complianceAuthorized(req.headers.authorization)) return res.status(401).json({ error: 'unauthorized' });
  next();
});
router.post('/search', (req, res, next) => search(req.body).then(r => res.json(r), next));
router.post('/export', (req, res, next) => exportItems(req.body).then(r => res.json(r), next));

module.exports = { router, policy, checkMessageDlp, editMessage, deleteMessages, sweepRetention, startRetentionSweep };
