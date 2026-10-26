const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, requireBearer, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { createCompliance } = require('./compliance');
const { createSearch } = require('./search');
const { calendarAiConfig, draftHandler } = require('./draft');
const groupCalendars = require('./groups');
const { SearchInputError } = require('@synergy/search');
const { SCHEMA: SERIES_SCHEMA, createEvents, inRange, busyBlocks: busyFor } = require('./events');
const { createCalDav } = require('./dav');

const PORT = portFor('calendar');
// Service token for machine consumers (SynergyBook free/busy + event creation).
const SVC_TOKEN = process.env.CAL_SVC_TOKEN || '';

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5475/cal' });
const q = db.q;
const compliance = createCompliance(q);
const groups = groupCalendars.createGroups(db);
const store = createEvents({ db, compliance, groups });

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
const VISIBLE_ROWS = `(owner_email = $1 OR calendar = 'company' OR attendees ? $1
  OR ${groupCalendars.VISIBLE_GROUP})`;
const VISIBLE = `${VISIBLE_ROWS} AND held_deleted_at IS NULL`;

// Free/busy: every occurrence of the person's own events and the ones they're invited to,
// repeating series expanded in their time zone (Bookings reads this through /api/svc/freebusy).
async function busyBlocks(email, from, to) {
  return busyFor(q, email, from, to);
}

function range(query, defFrom, defTo) {
  const from = new Date(query.from || defFrom);
  const to = new Date(query.to || defTo);
  if (isNaN(from) || isNaN(to)) throw Object.assign(new Error('from and to must be dates'), { status: 400 });
  if (to - from > 3 * 366 * 86400000) throw Object.assign(new Error('Ask for at most three years at a time'), { status: 400 });
  return { from, to };
}

function cleanAttendees(list) {
  return (Array.isArray(list) ? list : [])
    .map(a => String(a).toLowerCase().trim()).filter(a => a.includes('@')).slice(0, 50);
}

const router = express.Router();
router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail, ai: (await calendarAiConfig()) !== null })));

// Draft with Copilot: notes for the event editor. Returns text only; nothing is saved here.
router.post('/draft', wrap(draftHandler));

router.get('/calendars', wrap(async (req, res) => {
  res.json([
    { id: 'personal', name: 'Personal' },
    { id: 'company', name: 'Company' },
    ...(await groups.calendarsFor(req.userEmail)),
  ]);
}));

// Every occurrence in the range: single events, each occurrence of a repeating series (with
// `occurrence`, its original start, and `series_id`), and occurrences changed on their own.
router.get('/events', wrap(async (req, res) => {
  const { from, to } = range(req.query, Date.now() - 7 * 86400000, Date.now() + 30 * 86400000);
  res.json(await inRange(q, VISIBLE_ROWS, [req.userEmail], from, to));
}));

router.post('/events', wrap(async (req, res) => {
  res.json(await store.create(req.userEmail, req.body || {}));
}));

// Body: the fields to change, plus for a repeating event `scope` ("this", "following" or "all")
// and `occurrence` (the original start of the occurrence being edited).
router.patch('/events/:id', wrap(async (req, res) => {
  res.json(await store.edit(req.userEmail, Number(req.params.id), req.body || {}));
}));

// ?scope=this|following|all&occurrence=<original start> for a repeating event.
router.delete('/events/:id', wrap(async (req, res) => {
  await store.remove(req.userEmail, Number(req.params.id), {
    scope: ['this', 'following', 'all'].includes(req.query.scope) ? req.query.scope : 'all',
    occurrence: req.query.occurrence,
  });
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
  const { from, to } = range(req.query, Date.now(), Date.now() + 14 * 86400000);
  res.json({ email, busy: await busyBlocks(email, from, to) });
}));

async function main() {
  await db.migrate(SCHEMA + groupCalendars.SCHEMA + SERIES_SCHEMA, 'calendar');
  const app = express();
  baseApp(app, express, '256kb');

  // ---- CalDAV for phones and desktop apps (Basic sign-in with an app password) ----
  const dav = createCalDav({ db, compliance });
  app.use((req, res, next) => {
    if (!dav.matches(req.method, req.path)) return next();
    express.text({ type: () => true, limit: '5mb' })(req, res, err => {
      if (err) return next(err);
      dav.handle({
        method: req.method, url: req.originalUrl, headers: req.headers,
        body: typeof req.body === 'string' ? req.body : '', ip: req.ip,
      }).then(r => {
        res.status(r.status).set(r.headers).send(r.body);
      }, next);
    });
  });

  // ---- compliance API for the Admin center (COMPLIANCE_TOKEN, internal network) ----
  app.use('/api/compliance', compliance.router);

  // ---- service API (Bearer token; oauth2 skip-auth ^/api/svc/) ----
  const svcAuth = requireBearer(SVC_TOKEN);
  app.get('/api/svc/freebusy', svcAuth, wrap(async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (!email.includes('@')) return res.status(400).json({ error: 'email required' });
    const { from, to } = range(req.query, Date.now(), Date.now() + 14 * 86400000);
    res.json({ email, busy: await busyBlocks(email, from, to) });
  }));
  // What a person's calendar shows in a range, for an assistant reading "what's on today" (Jarvis). Only the
  // fields a glance needs - descriptions and attendee lists stay out, since every service holding the token
  // could read them.
  app.get('/api/svc/events', svcAuth, wrap(async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (!email.includes('@')) return res.status(400).json({ error: 'email required' });
    const { from, to } = range(req.query, Date.now(), Date.now() + 86400000);
    if (to - from > 62 * 86400000) return res.status(400).json({ error: 'Ask for at most 62 days at a time' });
    const rows = await inRange(q, VISIBLE_ROWS, [email], from, to);
    res.json({ email, events: rows.map(e => ({
      id: e.id, title: e.title, start_at: e.start_at, end_at: e.end_at, all_day: e.all_day, location: e.location,
      calendar: e.calendar, mine: e.owner_email === email, source: e.source,
      ...(e.occurrence ? { occurrence: e.occurrence } : {}),
    })) });
  }));
  app.post('/api/svc/events', svcAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const owner = String(b.ownerEmail || '').toLowerCase();
    if (!owner.includes('@')) return res.status(400).json({ error: 'ownerEmail required' });
    const ev = await store.create(owner, { ...b, rrule: null }, { source: String(b.source || 'api').slice(0, 20) });
    res.json({ id: ev.id });
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
