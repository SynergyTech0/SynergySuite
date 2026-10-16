// Events and repeating series: what every reader of the calendar (the web app, free/busy for
// Bookings, CalDAV) sees, and the edits that touch one occurrence, this and following, or all.
const recur = require('./recur');
const { isTimeZone } = require('@synergy/dav');

// Repeating events, and the change counter phones sync by. Every insert or update stamps the
// row with the next modseq; a removed event, or one that left a collection (moved calendar,
// attendee taken off), leaves a tombstone so a phone's next sync learns it is gone. Changing an
// occurrence on its own (an override row) also stamps its series.
const SCHEMA = `
ALTER TABLE events ADD COLUMN IF NOT EXISTS tzid TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE events ADD COLUMN IF NOT EXISTS rrule TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS exdates JSONB NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS series_end TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS series_id BIGINT REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_id TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS dav_name TEXT;
-- What a phone sent that the suite doesn't model (alarms, status...), written back unchanged.
ALTER TABLE events ADD COLUMN IF NOT EXISTS ical_extra TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS modseq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE SEQUENCE IF NOT EXISTS event_modseq;
CREATE INDEX IF NOT EXISTS events_series_idx ON events (series_id, recurrence_id);
CREATE INDEX IF NOT EXISTS events_repeat_idx ON events (start_at, series_end) WHERE rrule IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_modseq_idx ON events (modseq);
CREATE TABLE IF NOT EXISTS event_tombstones (
    id          BIGSERIAL PRIMARY KEY,
    modseq      BIGINT NOT NULL,
    owner_email TEXT NOT NULL,
    calendar    TEXT NOT NULL,
    attendees   JSONB NOT NULL,
    dav_name    TEXT NOT NULL,
    removed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_tombstones_modseq_idx ON event_tombstones (modseq);

CREATE OR REPLACE FUNCTION events_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.modseq := nextval('event_modseq');
  NEW.updated_at := now();
  IF NEW.uid IS NULL THEN NEW.uid := gen_random_uuid()::text; END IF;
  IF NEW.series_id IS NULL AND NEW.dav_name IS NULL THEN NEW.dav_name := NEW.uid || '.ics'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.series_id IS NULL AND OLD.held_deleted_at IS NULL AND (
       NEW.held_deleted_at IS NOT NULL OR NEW.owner_email <> OLD.owner_email OR NEW.calendar <> OLD.calendar
       OR NEW.attendees <> OLD.attendees OR NEW.dav_name IS DISTINCT FROM OLD.dav_name OR NEW.series_id IS NOT NULL)
       AND OLD.dav_name IS NOT NULL THEN
    INSERT INTO event_tombstones (modseq, owner_email, calendar, attendees, dav_name)
    VALUES (NEW.modseq, OLD.owner_email, OLD.calendar, OLD.attendees, OLD.dav_name);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION events_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.series_id IS NULL AND OLD.held_deleted_at IS NULL THEN
      INSERT INTO event_tombstones (modseq, owner_email, calendar, attendees, dav_name)
      VALUES (nextval('event_modseq'), OLD.owner_email, OLD.calendar, OLD.attendees, OLD.dav_name);
    ELSIF OLD.series_id IS NOT NULL THEN
      UPDATE events SET updated_at = now() WHERE id = OLD.series_id;
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.series_id IS NOT NULL THEN
    UPDATE events SET updated_at = now() WHERE id = NEW.series_id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.series_id IS NOT NULL AND OLD.series_id IS DISTINCT FROM NEW.series_id THEN
    UPDATE events SET updated_at = now() WHERE id = OLD.series_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS events_stamp ON events;
CREATE TRIGGER events_stamp BEFORE INSERT OR UPDATE ON events FOR EACH ROW EXECUTE FUNCTION events_stamp();
DROP TRIGGER IF EXISTS events_after ON events;
CREATE TRIGGER events_after AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION events_after();
UPDATE events SET uid = NULL WHERE uid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS events_dav_name_idx ON events (owner_email, dav_name) WHERE series_id IS NULL AND held_deleted_at IS NULL;
`;

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const HIDDEN = new Set(['held_deleted_at', 'modseq', 'dav_name', 'series_end', 'ical_extra']);
/** An event as the API shows it. */
function pub(row, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!HIDDEN.has(k)) out[k] = v;
  return { ...out, ...extra };
}

function cleanAttendees(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map(a => String(a).toLowerCase().trim()).filter(a => a.includes('@')))].slice(0, 50);
}

const text = (v, max) => String(v ?? '').slice(0, max);
const zone = tz => (typeof tz === 'string' && isTimeZone(tz) ? tz : null);

/** A new event's fields from a request body, or a 400. */
function cleanNew(b, owner) {
  const s = new Date(b.startAt), e = new Date(b.endAt);
  if (isNaN(s) || isNaN(e) || !(s < e)) throw bad('title, valid startAt < endAt required');
  const allDay = Boolean(b.allDay);
  const tzid = allDay ? 'UTC' : zone(b.tzid) || 'UTC';
  const ev = {
    owner_email: owner,
    calendar: b.calendar === 'company' ? 'company' : 'personal',
    title: text(b.title, 300).trim() || '(untitled)',
    description: text(b.description, 2000),
    location: text(b.location, 300),
    start_at: s, end_at: e, all_day: allDay, tzid,
    attendees: cleanAttendees(b.attendees),
    rrule: null, exdates: [],
  };
  ev.rrule = recur.cleanRule(b.rrule, { start: s, tzid, allDay });
  return ev;
}

const COLS = ['owner_email', 'calendar', 'title', 'description', 'location', 'start_at', 'end_at', 'all_day', 'tzid',
  'attendees', 'rrule', 'exdates', 'series_end', 'series_id', 'recurrence_id', 'source', 'uid', 'dav_name', 'ical_extra'];
const JSONB = new Set(['attendees', 'exdates']);

async function insert(q, ev) {
  const row = { source: 'cal', ...ev };
  row.series_end = row.rrule ? recur.seriesEnd(row) : null;
  const cols = COLS.filter(c => row[c] !== undefined);
  const vals = cols.map(c => (JSONB.has(c) ? JSON.stringify(row[c]) : row[c]));
  const { rows } = await q(
    `INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, vals);
  return rows[0];
}

async function update(q, id, fields) {
  const cols = Object.keys(fields).filter(c => fields[c] !== undefined);
  if (!cols.length) return (await q('SELECT * FROM events WHERE id = $1', [id])).rows[0];
  const vals = cols.map(c => (JSONB.has(c) ? JSON.stringify(fields[c]) : fields[c]));
  const { rows } = await q(
    `UPDATE events SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...vals]);
  return rows[0];
}

// ---- reading: every occurrence in a range ----

const IN_RANGE = (from, to) => `held_deleted_at IS NULL AND (
   (rrule IS NULL AND start_at < ${to} AND end_at > ${from})
   OR (rrule IS NOT NULL AND start_at < ${to} AND (series_end IS NULL OR series_end > ${from})))`;

/**
 * Turns candidate rows (single events, series masters, overrides) into the occurrences that
 * overlap [from, to), sorted by start. Generated occurrences carry the master's id and
 * `occurrence` (the original start, the RECURRENCE-ID); overrides carry their own id.
 */
async function occurrencesOf(q, rows, from, to, limit = 3000) {
  const masters = rows.filter(r => r.rrule);
  const overridden = new Map();
  const rules = new Map(masters.map(m => [String(m.id), m.rrule]));
  if (masters.length) {
    const { rows: ov } = await q(
      'SELECT series_id, recurrence_id FROM events WHERE series_id = ANY($1::bigint[])', [masters.map(m => m.id)]);
    for (const o of ov) {
      const k = String(o.series_id);
      if (!overridden.has(k)) overridden.set(k, new Set());
      overridden.get(k).add(new Date(o.recurrence_id).getTime());
    }
  }
  const orphanSeries = [...new Set(rows.filter(r => r.series_id && !rules.has(String(r.series_id))).map(r => r.series_id))];
  if (orphanSeries.length) {
    for (const m of (await q('SELECT id, rrule FROM events WHERE id = ANY($1::bigint[])', [orphanSeries])).rows) rules.set(String(m.id), m.rrule);
  }
  const out = [];
  for (const r of rows) {
    if (r.rrule) {
      for (const o of recur.expand(r, from, to, { skip: overridden.get(String(r.id)), limit })) {
        out.push(pub(r, { start_at: o.start, end_at: o.end, occurrence: o.recurrenceId, series_id: r.id, recurring: true }));
      }
    } else if (r.series_id) {
      out.push(pub(r, { occurrence: r.recurrence_id, recurring: true, rrule: rules.get(String(r.series_id)) || null }));
    } else {
      out.push(pub(r, { recurring: false }));
    }
  }
  out.sort((a, b) => new Date(a.start_at) - new Date(b.start_at) || String(a.id).localeCompare(String(b.id)));
  return out.slice(0, limit);
}

/** Occurrences in [from, to) of the events matching `where` (which uses $1.. from `params`). */
async function inRange(q, where, params, from, to, limit = 3000) {
  const n = params.length;
  const { rows } = await q(
    `SELECT * FROM events WHERE (${where}) AND ${IN_RANGE(`$${n + 1}`, `$${n + 2}`)} ORDER BY start_at LIMIT 5000`,
    [...params, from, to]);
  return occurrencesOf(q, rows, from, to, limit);
}

/** Busy times for free/busy: the person's own events and ones they're invited to, not all-day ones. */
async function busyBlocks(q, email, from, to) {
  const occ = await inRange(q, '(owner_email = $1 OR attendees ? $1) AND all_day = false', [email], from, to, 5000);
  return occ.map(o => ({ start: new Date(o.start_at), end: new Date(o.end_at) }));
}

// ---- writing ----

async function load(q, owner, rawId) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) throw bad('not found', 404);
  const { rows } = await q('SELECT * FROM events WHERE id = $1 AND owner_email = $2 AND held_deleted_at IS NULL', [id, owner]);
  if (!rows.length) throw bad('not found', 404);
  return rows[0];
}

function occurrenceOf(master, given) {
  const at = given != null ? new Date(given) : new Date(master.start_at);
  if (isNaN(at)) throw bad('occurrence must be a date');
  if (!recur.isOccurrence(master, at)) throw bad('That is not an occurrence of this series');
  return at;
}

/** Field changes from a PATCH body (undefined = leave as it is). */
function changes(b) {
  const c = {};
  if (b.title != null) c.title = text(b.title, 300).trim() || '(untitled)';
  if (b.description != null) c.description = text(b.description, 2000);
  if (b.location != null) c.location = text(b.location, 300);
  if (b.calendar === 'company' || b.calendar === 'personal') c.calendar = b.calendar;
  if (Array.isArray(b.attendees)) c.attendees = cleanAttendees(b.attendees);
  if (b.allDay != null) c.all_day = Boolean(b.allDay);
  if (b.tzid != null) {
    if (!zone(b.tzid)) throw bad('tzid must be a time zone name such as Europe/Paris');
    c.tzid = b.tzid;
  }
  const s = b.startAt != null ? new Date(b.startAt) : undefined;
  const e = b.endAt != null ? new Date(b.endAt) : undefined;
  if ((s && isNaN(s)) || (e && isNaN(e))) throw bad('startAt and endAt must be valid dates');
  return { fields: c, start: s, end: e, rrule: b.rrule === undefined ? undefined : b.rrule };
}

const ms = d => new Date(d).getTime();
const shiftIso = (list, delta, keep = () => true) =>
  (list || []).filter(keep).map(d => new Date(ms(d) + delta).toISOString());

function createEvents({ db, compliance }) {
  const q = db.q;

  async function tx(fn) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn((text, params) => client.query(text, params));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function create(owner, body, extra = {}) {
    const ev = { ...cleanNew(body || {}, owner), ...extra };
    return pub(await insert(q, ev));
  }

  /** A single (non-repeating) event, or a series being made from one. */
  async function editSingle(tq, row, c) {
    const start = c.start ?? new Date(row.start_at);
    const end = c.end ?? new Date(row.end_at);
    if (!(start < end)) throw bad('startAt must be before endAt');
    const allDay = c.fields.all_day ?? row.all_day;
    const tzid = allDay ? 'UTC' : c.fields.tzid ?? row.tzid;
    const fields = { ...c.fields, tzid, start_at: start, end_at: end };
    if (c.rrule !== undefined && !row.series_id) {
      fields.rrule = recur.cleanRule(c.rrule, { start, tzid, allDay });
      fields.exdates = [];
    }
    const next = { ...row, ...fields };
    if (!row.series_id) fields.series_end = next.rrule ? recur.seriesEnd(next) : null;
    return update(tq, row.id, fields);
  }

  /** The whole series: the change to one occurrence's time moves every occurrence by as much. */
  async function editAll(tq, master, at, c) {
    const oldDur = ms(master.end_at) - ms(master.start_at);
    const newStartOcc = c.start ?? (c.end ? new Date(ms(at)) : at);
    const delta = ms(newStartOcc) - ms(at);
    const dur = c.end ? ms(c.end) - ms(newStartOcc) : oldDur;
    if (dur <= 0) throw bad('startAt must be before endAt');
    const start = new Date(ms(master.start_at) + delta);
    const end = new Date(ms(start) + dur);
    const allDay = c.fields.all_day ?? master.all_day;
    const tzid = allDay ? 'UTC' : c.fields.tzid ?? master.tzid;
    const rrule = c.rrule !== undefined ? recur.cleanRule(c.rrule, { start, tzid, allDay }) : master.rrule;
    const fields = { ...c.fields, tzid, start_at: start, end_at: end, rrule };
    if (!rrule) {
      // No longer repeats: what is left is the first occurrence.
      await tq('DELETE FROM events WHERE series_id = $1', [master.id]);
      return update(tq, master.id, { ...fields, exdates: [], series_end: null });
    }
    fields.exdates = shiftIso(master.exdates, delta);
    if (delta) {
      await tq(`UPDATE events SET recurrence_id = recurrence_id + ($2::bigint * interval '1 millisecond') WHERE series_id = $1`, [master.id, delta]);
    }
    // Overrides that kept the series' old title, place, notes, calendar or guests follow the change.
    for (const k of ['title', 'description', 'location', 'calendar', 'attendees']) {
      if (c.fields[k] === undefined) continue;
      const v = JSONB.has(k) ? JSON.stringify(c.fields[k]) : c.fields[k];
      const old = JSONB.has(k) ? JSON.stringify(master[k]) : master[k];
      await tq(`UPDATE events SET ${k} = $2 WHERE series_id = $1 AND ${k} = $3${JSONB.has(k) ? '::jsonb' : ''}`, [master.id, v, old]);
    }
    fields.series_end = recur.seriesEnd({ ...master, ...fields });
    return update(tq, master.id, fields);
  }

  /** One occurrence: an override row, made or updated. */
  async function editOne(tq, master, at, c) {
    const dur = ms(master.end_at) - ms(master.start_at);
    const { rows } = await tq('SELECT * FROM events WHERE series_id = $1 AND recurrence_id = $2', [master.id, at]);
    if (rows.length) return editSingle(tq, rows[0], { ...c, rrule: undefined });
    const start = c.start ?? at;
    const end = c.end ?? new Date(ms(start) + dur);
    if (!(start < end)) throw bad('startAt must be before endAt');
    return insert(tq, {
      owner_email: master.owner_email, calendar: master.calendar, title: master.title, description: master.description,
      location: master.location, all_day: master.all_day, tzid: master.tzid, attendees: master.attendees, source: master.source,
      uid: master.uid, ...c.fields, start_at: start, end_at: end, series_id: master.id, recurrence_id: at,
    });
  }

  /** This and following: the series ends before `at`, and a new series starts there. */
  async function editFollowing(tq, master, at, c) {
    const dur = ms(master.end_at) - ms(master.start_at);
    const start = c.start ?? at;
    const end = c.end ?? new Date(ms(start) + dur);
    if (!(start < end)) throw bad('startAt must be before endAt');
    const delta = ms(start) - ms(at);
    const allDay = c.fields.all_day ?? master.all_day;
    const tzid = allDay ? 'UTC' : c.fields.tzid ?? master.tzid;
    const rrule = c.rrule !== undefined
      ? recur.cleanRule(c.rrule, { start, tzid, allDay })
      : recur.cleanRule(recur.ruleFrom(master, at), { start, tzid, allDay });
    const before = { rrule: recur.ruleEndingBefore(master, at), exdates: (master.exdates || []).filter(d => ms(d) < ms(at)) };
    await update(tq, master.id, { ...before, series_end: recur.seriesEnd({ ...master, ...before }) });
    // The edited occurrence's own override is replaced by the new series' first occurrence.
    await tq('DELETE FROM events WHERE series_id = $1 AND recurrence_id = $2', [master.id, at]);
    const next = await insert(tq, {
      owner_email: master.owner_email, calendar: master.calendar, title: master.title, description: master.description,
      location: master.location, attendees: master.attendees, source: master.source,
      ...c.fields, all_day: allDay, tzid, start_at: start, end_at: end, rrule,
      exdates: rrule ? shiftIso(master.exdates, delta, d => ms(d) > ms(at)) : [],
    });
    if (rrule) {
      await tq(
        `UPDATE events SET series_id = $2, uid = $3, recurrence_id = recurrence_id + ($4::bigint * interval '1 millisecond')
          WHERE series_id = $1 AND recurrence_id > $5`, [master.id, next.id, next.uid, delta, at]);
    } else {
      await tq('DELETE FROM events WHERE series_id = $1 AND recurrence_id > $2', [master.id, at]);
    }
    return next;
  }

  /**
   * PATCH: `scope` is "this", "following" or "all" (default) for a repeating event, with
   * `occurrence` naming which one (its original start). An override's own id edits that
   * occurrence; "following" or "all" on it act on its series.
   */
  async function edit(owner, id, body) {
    const b = body || {};
    const scope = ['this', 'following', 'all'].includes(b.scope) ? b.scope : 'all';
    const c = changes(b);
    return tx(async tq => {
      let row = await load(tq, owner, id);
      let at = b.occurrence;
      if (row.series_id) {
        if (scope === 'this') {
          await compliance.keepVersion(owner, row.id);
          return pub(await editSingle(tq, row, { ...c, rrule: undefined }));
        }
        at = row.recurrence_id;
        row = await load(tq, owner, Number(row.series_id));
      }
      await compliance.keepVersion(owner, row.id);
      if (!row.rrule) return pub(await editSingle(tq, row, c));
      const occ = occurrenceOf(row, at);
      if (scope === 'this') return pub(await editOne(tq, row, occ, c));
      if (scope === 'following' && ms(occ) > ms(row.start_at)) return pub(await editFollowing(tq, row, occ, c));
      return pub(await editAll(tq, row, occ, c));
    });
  }

  /** DELETE with the same scopes. */
  async function remove(owner, id, { scope = 'all', occurrence } = {}) {
    let row = await load(q, owner, id);
    let at = occurrence;
    if (row.series_id) {
      if (scope === 'this') {
        await addExdate(owner, Number(row.series_id), row.recurrence_id);
        await compliance.deleteEvents(owner, [row.id]);
        return;
      }
      at = row.recurrence_id;
      row = await load(q, owner, Number(row.series_id));
    }
    if (!row.rrule || scope === 'all') {
      await compliance.deleteEvents(owner, [row.id]);
      return;
    }
    const occ = occurrenceOf(row, at);
    if (scope === 'this') {
      await addExdate(owner, row.id, occ);
      const { rows } = await q('SELECT id FROM events WHERE series_id = $1 AND recurrence_id = $2', [row.id, occ]);
      if (rows.length) await compliance.deleteEvents(owner, rows.map(r => r.id));
      return;
    }
    if (ms(occ) <= ms(row.start_at)) {
      await compliance.deleteEvents(owner, [row.id]);
      return;
    }
    await compliance.keepVersion(owner, row.id);
    const cut = { rrule: recur.ruleEndingBefore(row, occ), exdates: (row.exdates || []).filter(d => ms(d) < ms(occ)) };
    await update(q, row.id, { ...cut, series_end: recur.seriesEnd({ ...row, ...cut }) });
    const { rows } = await q('SELECT id FROM events WHERE series_id = $1 AND recurrence_id >= $2', [row.id, occ]);
    if (rows.length) await compliance.deleteEvents(owner, rows.map(r => r.id));
  }

  async function addExdate(owner, masterId, at) {
    const master = await load(q, owner, masterId);
    await compliance.keepVersion(owner, master.id);
    const list = [...new Set([...(master.exdates || []), new Date(at).toISOString()])].sort();
    await update(q, master.id, { exdates: list });
  }

  return { create, edit, remove, tx };
}

module.exports = { SCHEMA, createEvents, inRange, occurrencesOf, busyBlocks, pub, insert, update, cleanAttendees, IN_RANGE };
