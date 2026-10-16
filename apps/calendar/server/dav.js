// CalDAV for phones and desktop calendar apps: each person sees three calendars, the same
// events the web app shows them. "Calendar" is their own (read and write), "Company" is the
// shared company calendar (anyone can add; only an event's organizer can change it) and
// "Invitations" holds other people's events they are invited to (read only). Sign-in is Basic
// with an app password from the Account page.
const { createDavHandler, DavError, appPasswordVerifier } = require('@synergy/dav');
const { toICalendar, fromICalendar } = require('./ical');
const { inRange, insert, update } = require('./events');
const recur = require('./recur');

const COLLECTIONS = {
  personal: { displayName: 'Calendar', color: '#0284C7', readOnly: false, where: `owner_email = $1 AND calendar = 'personal'`, calendar: 'personal' },
  company: { displayName: 'Company', color: '#7C3AED', readOnly: false, where: `calendar = 'company' AND $1::text <> ''`, calendar: 'company', description: 'Everyone in the organization sees these' },
  invited: { displayName: 'Invitations', color: '#0E9F6E', readOnly: true, where: `attendees ? $1 AND owner_email <> $1 AND calendar = 'personal'`, description: "Other people's events you're invited to" },
};

function createCalDav({ db, compliance, authenticate }) {
  const q = db.q;
  const coll = id => {
    const c = COLLECTIONS[id];
    if (!c) throw new DavError(404, 'No such calendar');
    return c;
  };
  const etag = r => `"${r.modseq}"`;
  const meta = r => ({ name: r.dav_name, etag: etag(r), lastModified: new Date(r.updated_at) });

  async function token(user, id) {
    const c = coll(id);
    const { rows } = await q(
      `SELECT GREATEST(
         (SELECT COALESCE(max(modseq), 0) FROM events WHERE ${c.where} AND series_id IS NULL),
         (SELECT COALESCE(max(modseq), 0) FROM event_tombstones WHERE ${c.where})) AS t`, [user]);
    return String(rows[0].t);
  }

  async function masters(user, id, names) {
    const c = coll(id);
    const { rows } = await q(
      `SELECT * FROM events WHERE ${c.where} AND series_id IS NULL AND held_deleted_at IS NULL AND dav_name = ANY($2::text[])`,
      [user, names]);
    return rows;
  }

  const backend = {
    async collections(user) {
      return Promise.all(Object.entries(COLLECTIONS).map(async ([id, c]) => ({
        id, displayName: c.displayName, description: c.description, color: c.color, readOnly: c.readOnly, syncToken: await token(user, id),
      })));
    },

    async list(user, id, range) {
      const c = coll(id);
      if (!range || (!range.start && !range.end)) {
        const { rows } = await q(
          `SELECT dav_name, modseq, updated_at FROM events WHERE ${c.where} AND series_id IS NULL AND held_deleted_at IS NULL ORDER BY id`, [user]);
        return rows.map(meta);
      }
      const from = range.start || new Date(-8.64e15);
      const to = range.end || new Date(8.64e15);
      const occ = await inRange(q, c.where.replace(/\$1/g, '$1'), [user], from, to, 100000);
      const ids = [...new Set(occ.map(o => String(o.series_id || o.id)))];
      if (!ids.length) return [];
      const { rows } = await q(
        `SELECT dav_name, modseq, updated_at FROM events
          WHERE ${c.where} AND series_id IS NULL AND held_deleted_at IS NULL AND id = ANY($2::bigint[]) ORDER BY id`, [user, ids]);
      return rows.map(meta);
    },

    async get(user, id, names) {
      if (!names.length) return [];
      const rows = await masters(user, id, names);
      if (!rows.length) return [];
      const { rows: ov } = await q(
        'SELECT * FROM events WHERE series_id = ANY($1::bigint[]) AND held_deleted_at IS NULL ORDER BY recurrence_id', [rows.map(r => r.id)]);
      return rows.map(r => ({ ...meta(r), data: toICalendar(r, ov.filter(o => String(o.series_id) === String(r.id))) }));
    },

    async put(user, id, name, data, existing) {
      const c = coll(id);
      const parsed = (() => {
        try {
          return fromICalendar(data);
        } catch (e) {
          throw new DavError(e.status || 415, e.message, e.precondition);
        }
      })();
      const { master, overrides, uid } = parsed;
      try {
        master.rrule = recur.cleanRule(master.rrule, { start: master.start_at, tzid: master.tzid, allDay: master.all_day });
      } catch (e) {
        throw new DavError(403, e.message, '{urn:ietf:params:xml:ns:caldav}valid-calendar-object-resource');
      }
      if (!master.rrule) master.exdates = [];
      const attendees = master.attendees.filter(a => a !== user).slice(0, 50);
      const fields = {
        title: master.title, description: master.description, location: master.location, start_at: master.start_at,
        end_at: master.end_at, all_day: master.all_day, tzid: master.tzid, attendees, rrule: master.rrule,
        exdates: master.exdates, ical_extra: master.ical_extra,
      };
      fields.series_end = fields.rrule ? recur.seriesEnd({ id: `new-${uid}`, ...fields }) : null;

      let row;
      if (existing) {
        [row] = await masters(user, id, [name]);
        if (!row) throw new DavError(404, 'Not found');
        if (row.owner_email !== user) throw new DavError(403, 'Only the organizer can change this event', '{DAV:}need-privileges');
        if (row.uid !== uid) throw new DavError(409, 'The UID of an event can\'t change', '{urn:ietf:params:xml:ns:caldav}no-uid-conflict');
        await compliance.keepVersion(user, row.id);
        row = await update(q, row.id, fields);
      } else {
        const clash = await q(
          'SELECT dav_name FROM events WHERE owner_email = $1 AND uid = $2 AND series_id IS NULL AND held_deleted_at IS NULL', [user, uid]);
        if (clash.rows.length) throw new DavError(409, 'An event with this UID is already stored', '{urn:ietf:params:xml:ns:caldav}no-uid-conflict');
        row = await insert(q, { ...fields, owner_email: user, calendar: c.calendar, uid, dav_name: name, source: 'cal' });
      }

      // The occurrences changed on their own: update the ones still there, add new ones, remove the rest.
      const { rows: current } = await q('SELECT * FROM events WHERE series_id = $1 AND held_deleted_at IS NULL', [row.id]);
      const byRid = new Map(current.map(o => [new Date(o.recurrence_id).getTime(), o]));
      const keep = new Set();
      for (const o of row.rrule ? overrides : []) {
        const t = o.recurrence_id.getTime();
        keep.add(t);
        const f = {
          title: o.title, description: o.description, location: o.location, start_at: o.start_at, end_at: o.end_at,
          all_day: o.all_day, tzid: o.tzid, attendees: o.attendees.filter(a => a !== user).slice(0, 50), ical_extra: o.ical_extra,
        };
        if (byRid.has(t)) {
          await compliance.keepVersion(user, byRid.get(t).id);
          await update(q, byRid.get(t).id, f);
        } else {
          await insert(q, { ...f, owner_email: user, calendar: row.calendar, uid, series_id: row.id, recurrence_id: o.recurrence_id, source: row.source });
        }
      }
      const gone = current.filter(o => !keep.has(new Date(o.recurrence_id).getTime())).map(o => o.id);
      if (gone.length) await compliance.deleteEvents(user, gone);
      const [after] = await masters(user, id, [name]);
      return meta(after);
    },

    async remove(user, id, name) {
      const [row] = await masters(user, id, [name]);
      if (!row) throw new DavError(404, 'Not found');
      if (row.owner_email !== user) throw new DavError(403, 'Only the organizer can delete this event', '{DAV:}need-privileges');
      await compliance.deleteEvents(user, [row.id]);
    },

    async changes(user, id, since) {
      const c = coll(id);
      const s = Number(since);
      const { rows: [g] } = await q('SELECT last_value, is_called FROM event_modseq');
      if (s > (g.is_called ? Number(g.last_value) : 0)) return null;
      const { rows: changed } = await q(
        `SELECT dav_name, modseq, updated_at FROM events
          WHERE ${c.where} AND series_id IS NULL AND held_deleted_at IS NULL AND modseq > $2 ORDER BY modseq`, [user, s]);
      const { rows: tomb } = await q(
        `SELECT DISTINCT t.dav_name FROM event_tombstones t
          WHERE ${c.where.replace(/\b(owner_email|calendar|attendees)\b/g, 't.$1')} AND t.modseq > $2
            AND NOT EXISTS (SELECT 1 FROM events e WHERE ${c.where.replace(/\b(owner_email|calendar|attendees)\b/g, 'e.$1')}
                              AND e.series_id IS NULL AND e.held_deleted_at IS NULL AND e.dav_name = t.dav_name)`, [user, s]);
      const t = Math.max(s, Number(await token(user, id)));
      return { token: String(t), changed: changed.map(meta), removed: tomb.map(r => r.dav_name) };
    },
  };

  return createDavHandler({
    kind: 'calendar',
    backend,
    realm: 'Synergy Calendar',
    authenticate: authenticate || appPasswordVerifier({ app: 'calendar' }),
  });
}

module.exports = { createCalDav, COLLECTIONS };
