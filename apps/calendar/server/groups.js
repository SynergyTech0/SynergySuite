// Group calendars. The Groups app is the source of truth for who is in a group: it pushes each
// group calendar here as "make it exactly this" (PUT /api/svc/group-calendars/:source) whenever the
// group changes, and again periodically to repair drift. Members see the calendar's events; any
// member may add events to it; a group calendar owner may also edit or delete other people's
// events on it. Events stay with their organizer (owner_email), so holds and retention work as
// for any other event.
const express = require('express');
const { wrap } = require('@synergy/server');
const { appUrl } = require('@synergy/config');

const SOURCE_RE = /^groups:[0-9a-f-]{36}$/;
const isSource = s => typeof s === 'string' && SOURCE_RE.test(s);

// Runs after the events table exists. The calendar CHECK is widened once (only when the current
// constraint does not allow 'group' yet), so later boots don't rescan the table.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS group_calendars (
    source      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_calendar_members (
    source      TEXT NOT NULL REFERENCES group_calendars(source) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    PRIMARY KEY (source, email)
);
CREATE INDEX IF NOT EXISTS group_calendar_members_email_idx ON group_calendar_members (email);
ALTER TABLE events ADD COLUMN IF NOT EXISTS group_source TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'events'::regclass AND conname = 'events_calendar_check'
                    AND pg_get_constraintdef(oid) LIKE '%group%') THEN
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_calendar_check;
    ALTER TABLE events ADD CONSTRAINT events_calendar_check CHECK (calendar IN ('personal','company','group'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'events'::regclass AND conname = 'events_group_source_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_group_source_check
      CHECK ((calendar = 'group') = (group_source IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS events_group_idx ON events (group_source, start_at) WHERE group_source IS NOT NULL;
`;

// A group calendar's events are visible to its members.
const VISIBLE_GROUP = `(calendar = 'group' AND group_source IN (SELECT source FROM group_calendar_members WHERE email = $1))`;

function cleanMembers(list) {
  const byEmail = new Map();
  for (const m of list) {
    const email = String((m && m.email) || '').toLowerCase().trim();
    if (!email.includes('@') || email.length > 320) continue;
    const role = m.role === 'owner' ? 'owner' : 'member';
    if (byEmail.get(email) !== 'owner') byEmail.set(email, role);
  }
  return byEmail;
}

function createGroups(db) {
  const q = db.q;

  // The person's role on a group calendar, or null when they are not a member.
  async function roleOf(email, source) {
    if (!isSource(source)) return null;
    const { rows } = await q('SELECT role FROM group_calendar_members WHERE source = $1 AND email = $2',
      [source, String(email || '').toLowerCase()]);
    return rows.length ? rows[0].role : null;
  }

  async function calendarsFor(email) {
    const { rows } = await q(
      `SELECT c.source, c.name, m.role FROM group_calendar_members m
         JOIN group_calendars c USING (source)
        WHERE m.email = $1 ORDER BY lower(c.name), c.source`, [String(email || '').toLowerCase()]);
    return rows.map(r => ({ id: `group:${r.source}`, source: r.source, name: r.name, role: r.role }));
  }

  // Service routes, mounted behind the Bearer check.
  const svc = express.Router();
  svc.put('/group-calendars/:source', wrap(async (req, res) => {
    const source = req.params.source;
    if (!isSource(source)) return res.status(400).json({ error: 'bad source' });
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!Array.isArray(b.members)) return res.status(400).json({ error: 'members must be an array' });
    const members = cleanMembers(b.members);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO group_calendars (source, name) VALUES ($1, $2)
         ON CONFLICT (source) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`, [source, name]);
      const emails = [...members.keys()];
      await client.query('DELETE FROM group_calendar_members WHERE source = $1 AND NOT (email = ANY($2::text[]))',
        [source, emails]);
      await client.query(
        `INSERT INTO group_calendar_members (source, email, role)
         SELECT $1, e, r FROM unnest($2::text[], $3::text[]) AS t(e, r)
         ON CONFLICT (source, email) DO UPDATE SET role = EXCLUDED.role`,
        [source, emails, [...members.values()]]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ source, url: `${appUrl('calendar')}/` });
  }));

  svc.get('/group-calendars/:source/events', wrap(async (req, res) => {
    const source = req.params.source;
    if (!isSource(source)) return res.status(400).json({ error: 'bad source' });
    const cal = await q('SELECT 1 FROM group_calendars WHERE source = $1', [source]);
    if (!cal.rows.length) return res.status(404).json({ error: 'not found' });
    const from = new Date(req.query.from || Date.now() - 7 * 86400000);
    const to = new Date(req.query.to || Date.now() + 30 * 86400000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'from and to must be valid dates' });
    // Every occurrence, repeating events expanded (required here: events.js requires this file).
    const { inRange } = require('./events');
    const rows = await inRange(q, `(calendar = 'group' AND group_source = $1)`, [source], from, to, 1000);
    res.json({ events: rows });
  }));

  // The calendar and its member list go; events stay (with their organizers, and for compliance)
  // but no longer show to anyone but the organizer and attendees.
  svc.delete('/group-calendars/:source', wrap(async (req, res) => {
    const source = req.params.source;
    if (!isSource(source)) return res.status(400).json({ error: 'bad source' });
    await q('DELETE FROM group_calendars WHERE source = $1', [source]);
    res.json({ ok: true });
  }));

  return { roleOf, calendarsFor, svc };
}

module.exports = { SCHEMA, VISIBLE_GROUP, isSource, createGroups };
