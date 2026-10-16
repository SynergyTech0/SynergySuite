const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, requireBearer, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { createCompliance } = require('./compliance');
const { createSearch } = require('./search');
const groupCalendars = require('./groups');
const { SearchInputError } = require('@synergy/search');

const PORT = portFor('calendar');
// Service token for machine consumers (SynergyBook free/busy + event creation).
const SVC_TOKEN = process.env.CAL_SVC_TOKEN || '';

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5475/cal' });
const q = db.q;
const compliance = createCompliance(q);
const groups = groupCalendars.createGroups(db);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    owner_email TEXT NOT NULL,
    calendar    TEXT NOT NULL DEFAULT 'personal' CHECK (calendar IN ('personal','company','group')),
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL DEFAULT '',
    start_at    TIMESTAMPTZ NOT NULL,
    end_at      TIMESTAMPTZ NOT NULL,
    all_day     BOOLEAN NOT NULL DEFAULT false,
    attendees   JSONB NOT NULL DEFAULT '[]',
    source      TEXT NOT NULL DEFAULT 'cal',   -- cal | booking | api
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start_at < end_at)
);
CREATE INDEX IF NOT EXISTS events_owner_idx ON events (owner_email, start_at);
CREATE INDEX IF NOT EXISTS events_range_idx ON events (start_at, end_at);
-- Legal hold: an event its held organizer deleted stays, hidden, for compliance search.
ALTER TABLE events ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
-- ...and what a held organizer's edits replaced, never shown by the normal API.
CREATE TABLE IF NOT EXISTS event_held_versions (
    id          BIGSERIAL PRIMARY KEY,
    event_id    BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    fields      JSONB NOT NULL,
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_held_versions_event_idx ON event_held_versions (event_id, id);
`;


// events visible to a user: own, company calendar, where they're an attendee, or on a group
// calendar they're a member of
const VISIBLE = `(owner_email = $1 OR calendar = 'company' OR attendees ? $1
  OR ${groupCalendars.VISIBLE_GROUP}) AND held_deleted_at IS NULL`;

async function busyBlocks(email, from, to) {
  const { rows } = await q(
    `SELECT start_at, end_at, title FROM events
     WHERE (owner_email = $1 OR attendees ? $1) AND all_day = false AND held_deleted_at IS NULL
       AND start_at < $3 AND end_at > $2
     ORDER BY start_at`, [email, from, to]);
  return rows.map(r => ({ start: r.start_at, end: r.end_at }));
}

function cleanAttendees(list) {
  return (Array.isArray(list) ? list : [])
    .map(a => String(a).toLowerCase().trim()).filter(a => a.includes('@')).slice(0, 50);
}

function cleanEvent(b, ownerEmail) {
  const s = new Date(b.startAt), e = new Date(b.endAt);
  if (isNaN(s) || isNaN(e) || !(s < e)) return null;
  const calendar = ['company', 'group'].includes(b.calendar) ? b.calendar : 'personal';
  return [
    ownerEmail,
    calendar,
    String(b.title || '').slice(0, 300).trim() || '(untitled)',
    String(b.description || '').slice(0, 2000),
    String(b.location || '').slice(0, 300),
    s, e, Boolean(b.allDay),
    JSON.stringify(cleanAttendees(b.attendees)),
    calendar === 'group' ? String(b.groupSource || '') : null,
  ];
}

// A new event on a group calendar: the organizer must be a member of it. Returns an error
// [status, message] or null when the event may be added.
async function groupRefusal(vals) {
  if (vals[1] !== 'group') return null;
  if (!groupCalendars.isSource(vals[9])) return [400, 'groupSource required for a group event'];
  if (!(await groups.roleOf(vals[0], vals[9]))) return [403, 'not a member of that group calendar'];
  return null;
}

// The event if this person may change it: its organizer, or an owner of the group calendar it is on.
async function editableEvent(email, id) {
  const { rows } = await q(
    'SELECT id, owner_email, calendar, group_source, start_at, end_at FROM events WHERE id = $1 AND held_deleted_at IS NULL',
    [id]);
  const ev = rows[0];
  if (!ev) return null;
  if (ev.owner_email === email) return ev;
  if (ev.calendar === 'group' && (await groups.roleOf(email, ev.group_source)) === 'owner') return ev;
  return null;
}

const router = express.Router();
router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail })));

router.get('/calendars', wrap(async (req, res) => {
  res.json([
    { id: 'personal', name: 'Personal' },
    { id: 'company', name: 'Company' },
    ...(await groups.calendarsFor(req.userEmail)),
  ]);
}));

router.get('/events', wrap(async (req, res) => {
  const from = new Date(req.query.from || Date.now() - 7 * 86400000);
  const to = new Date(req.query.to || Date.now() + 30 * 86400000);
  res.json((await q(
    `SELECT * FROM events WHERE ${VISIBLE} AND start_at < $3 AND end_at > $2
     ORDER BY start_at LIMIT 1000`, [req.userEmail, from, to])).rows);
}));

router.post('/events', wrap(async (req, res) => {
  const vals = cleanEvent(req.body || {}, req.userEmail);
  if (!vals) return res.status(400).json({ error: 'title, valid startAt < endAt required' });
  const refused = await groupRefusal(vals);
  if (refused) return res.status(refused[0]).json({ error: refused[1] });
  const { rows } = await q(
    `INSERT INTO events (owner_email, calendar, title, description, location, start_at, end_at, all_day, attendees, group_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, vals);
  res.json(rows[0]);
}));

router.patch('/events/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).json({ error: 'not found' });
  const cur = await editableEvent(req.userEmail, id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  let start = null, end = null;
  if (b.startAt != null || b.endAt != null) {
    start = b.startAt != null ? new Date(b.startAt) : null;
    end = b.endAt != null ? new Date(b.endAt) : null;
    if ((start && isNaN(start)) || (end && isNaN(end))) {
      return res.status(400).json({ error: 'startAt and endAt must be valid dates' });
    }
    if (!((start || cur.start_at) < (end || cur.end_at))) {
      return res.status(400).json({ error: 'startAt must be before endAt' });
    }
  }
  // Moving between calendars: only the organizer, and onto a group calendar only as its member.
  let calendar = cur.calendar, groupSource = cur.group_source;
  if (['personal', 'company', 'group'].includes(b.calendar)) {
    calendar = b.calendar;
    groupSource = calendar !== 'group' ? null : b.groupSource != null ? String(b.groupSource) : cur.group_source;
    if (calendar !== cur.calendar || groupSource !== cur.group_source) {
      if (cur.owner_email !== req.userEmail) {
        return res.status(403).json({ error: 'only the organizer can move an event to another calendar' });
      }
      if (calendar === 'group') {
        if (!groupCalendars.isSource(groupSource)) return res.status(400).json({ error: 'groupSource required for a group event' });
        if (!(await groups.roleOf(req.userEmail, groupSource))) {
          return res.status(403).json({ error: 'not a member of that group calendar' });
        }
      }
    }
  }
  await compliance.keepVersion(cur.owner_email, id);
  const { rows } = await q(
    `UPDATE events SET
       title = COALESCE($3, title), description = COALESCE($4, description),
       location = COALESCE($5, location),
       start_at = COALESCE($6, start_at), end_at = COALESCE($7, end_at),
       calendar = $8, group_source = $10,
       attendees = COALESCE($9, attendees)
     WHERE id = $1 AND owner_email = $2 AND held_deleted_at IS NULL RETURNING *`,
    [id, cur.owner_email,
     b.title != null ? String(b.title).slice(0, 300) : null,
     b.description != null ? String(b.description).slice(0, 2000) : null,
     b.location != null ? String(b.location).slice(0, 300) : null,
     start, end,
     calendar,
     Array.isArray(b.attendees) ? JSON.stringify(cleanAttendees(b.attendees)) : null,
     groupSource]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

router.delete('/events/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const cur = Number.isSafeInteger(id) ? await editableEvent(req.userEmail, id) : null;
  // Deleted as the organizer's event, so the organizer's hold (if any) keeps it.
  const rowCount = cur ? await compliance.deleteEvents(cur.owner_email, [id]) : 0;
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

// Suite search for the signed-in person (the Search app calls this with their gateway headers).
const suiteSearch = createSearch(q, VISIBLE);
router.post('/search', wrap(async (req, res) => {
  try {
    res.json(await suiteSearch(req.userEmail, req.body));
  } catch (e) {
    if (e instanceof SearchInputError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.get('/freebusy', wrap(async (req, res) => {
  const email = String(req.query.email || req.userEmail).toLowerCase();
  const from = new Date(req.query.from || Date.now());
  const to = new Date(req.query.to || Date.now() + 14 * 86400000);
  res.json({ email, busy: await busyBlocks(email, from, to) });
}));

async function main() {
  await db.migrate(SCHEMA + groupCalendars.SCHEMA, 'calendar');
  const app = express();
  baseApp(app, express, '256kb');

  // ---- compliance API for the Admin center (COMPLIANCE_TOKEN, internal network) ----
  app.use('/api/compliance', compliance.router);

  // ---- service API (Bearer token; oauth2 skip-auth ^/api/svc/) ----
  const svcAuth = requireBearer(SVC_TOKEN);
  app.get('/api/svc/freebusy', svcAuth, wrap(async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (!email.includes('@')) return res.status(400).json({ error: 'email required' });
    const from = new Date(req.query.from || Date.now());
    const to = new Date(req.query.to || Date.now() + 14 * 86400000);
    res.json({ email, busy: await busyBlocks(email, from, to) });
  }));
  app.post('/api/svc/events', svcAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const owner = String(b.ownerEmail || '').toLowerCase();
    if (!owner.includes('@')) return res.status(400).json({ error: 'ownerEmail required' });
    const vals = cleanEvent(b, owner);
    if (!vals) return res.status(400).json({ error: 'title, valid startAt < endAt required' });
    const refused = await groupRefusal(vals);
    if (refused) return res.status(refused[0]).json({ error: refused[1] });
    const { rows } = await q(
      `INSERT INTO events (owner_email, calendar, title, description, location, start_at, end_at, all_day, attendees, group_source, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [...vals, String(b.source || 'api').slice(0, 20)]);
    res.json({ id: rows[0].id });
  }));
  // Group calendars, pushed by the Groups app.
  app.use('/api/svc', svcAuth, groups.svc);
  // A service may move or remove only the events it added, on the organizer's calendar it names
  // (Bookings rescheduling or cancelling an appointment). Held organizers keep what is replaced.
  const svcEvent = (b) => ({
    id: Number(b.id),
    owner: String(b.ownerEmail || '').toLowerCase(),
    source: String(b.source || 'api').slice(0, 20),
  });
  app.patch('/api/svc/events/:id', svcAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const { id, owner, source } = svcEvent({ ...b, id: req.params.id });
    if (!owner.includes('@') || !Number.isSafeInteger(id)) return res.status(400).json({ error: 'ownerEmail and a numeric id required' });
    const s = b.startAt != null ? new Date(b.startAt) : null;
    const e = b.endAt != null ? new Date(b.endAt) : null;
    if ((s && isNaN(s)) || (e && isNaN(e))) return res.status(400).json({ error: 'startAt and endAt must be valid dates' });
    const cur = await q('SELECT start_at, end_at FROM events WHERE id = $1 AND owner_email = $2 AND source = $3 AND held_deleted_at IS NULL',
      [id, owner, source]);
    if (!cur.rows.length) return res.status(404).json({ error: 'not found' });
    if (!((s || cur.rows[0].start_at) < (e || cur.rows[0].end_at))) return res.status(400).json({ error: 'startAt must be before endAt' });
    await compliance.keepVersion(owner, id);
    await q(
      `UPDATE events SET start_at = COALESCE($3, start_at), end_at = COALESCE($4, end_at),
         title = COALESCE($5, title), description = COALESCE($6, description), location = COALESCE($7, location)
       WHERE id = $1 AND owner_email = $2 AND held_deleted_at IS NULL`,
      [id, owner, s, e,
       b.title != null ? String(b.title).slice(0, 300) : null,
       b.description != null ? String(b.description).slice(0, 2000) : null,
       b.location != null ? String(b.location).slice(0, 300) : null]);
    res.json({ ok: true });
  }));
  app.delete('/api/svc/events/:id', svcAuth, wrap(async (req, res) => {
    const { id, owner, source } = svcEvent({ ...req.query, id: req.params.id });
    if (!owner.includes('@') || !Number.isSafeInteger(id)) return res.status(400).json({ error: 'ownerEmail and a numeric id required' });
    const own = await q('SELECT 1 FROM events WHERE id = $1 AND owner_email = $2 AND source = $3 AND held_deleted_at IS NULL',
      [id, owner, source]);
    if (!own.rows.length) return res.status(404).json({ error: 'not found' });
    await compliance.deleteEvents(owner, [id]);
    res.json({ ok: true });
  }));

  app.use('/api', requireUser());
  app.use('/api', router);

  app.use(errorHandler('calendar'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'calendar' });

  app.listen(PORT, () => console.log(`SynergyCal listening on :${PORT}`));
  compliance.startRetentionSweep();
}

main().catch(e => { console.error(e); process.exit(1); });
