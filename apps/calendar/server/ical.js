// Events as iCalendar (RFC 5545) for CalDAV: one calendar object per event or series, the
// series' master VEVENT with RRULE and EXDATE plus a VEVENT with RECURRENCE-ID for each
// occurrence changed on its own. What the suite doesn't model (alarms, status, categories,
// RDATE...) is kept as it came and written back unchanged, so a phone's alerts survive a sync.
const {
  parseICalendar, serialize, getProp, getProps, parseDateValue, parseDateText, parseDuration, unescapeText, escapeText,
  formatLocal, formatUtc, formatDate, zoneFor,
} = require('@synergy/dav');

const PRODID = '-//Synergy Suite//Calendar//EN';
const MAPPED = new Set(['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'RRULE',
  'EXDATE', 'RECURRENCE-ID', 'ATTENDEE', 'ORGANIZER', 'CREATED', 'LAST-MODIFIED', 'SEQUENCE']);
const MAX_EXTRA = 20000;

function dateProp(name, d, tzid, allDay) {
  if (allDay) return { name, params: { VALUE: 'DATE' }, value: formatDate(new Date(d)) };
  if (!tzid || tzid === 'UTC') return { name, params: {}, value: formatUtc(new Date(d)) };
  return { name, params: { TZID: tzid }, value: formatLocal(new Date(d), tzid) };
}

function vevent(row, master, recurrenceId) {
  const props = [
    { name: 'UID', params: {}, value: master.uid },
    { name: 'DTSTAMP', params: {}, value: formatUtc(new Date(row.updated_at || Date.now())) },
    { name: 'CREATED', params: {}, value: formatUtc(new Date(row.created_at || Date.now())) },
    { name: 'LAST-MODIFIED', params: {}, value: formatUtc(new Date(row.updated_at || Date.now())) },
  ];
  if (recurrenceId) props.push(dateProp('RECURRENCE-ID', recurrenceId, master.tzid, master.all_day));
  props.push(dateProp('DTSTART', row.start_at, row.tzid, row.all_day));
  props.push(dateProp('DTEND', row.end_at, row.tzid, row.all_day));
  props.push({ name: 'SUMMARY', params: {}, value: escapeText(row.title || '') });
  if (row.location) props.push({ name: 'LOCATION', params: {}, value: escapeText(row.location) });
  if (row.description) props.push({ name: 'DESCRIPTION', params: {}, value: escapeText(row.description) });
  if (row.rrule) props.push({ name: 'RRULE', params: {}, value: row.rrule });
  for (const d of row.exdates || []) props.push(dateProp('EXDATE', d, row.tzid, row.all_day));
  if ((row.attendees || []).length) {
    props.push({ name: 'ORGANIZER', params: {}, value: `mailto:${row.owner_email}` });
    for (const a of row.attendees) props.push({ name: 'ATTENDEE', params: { ROLE: 'REQ-PARTICIPANT' }, value: `mailto:${a}` });
  }
  const comp = { name: 'VEVENT', props, components: [] };
  if (row.ical_extra) {
    try {
      const kept = parseICalendar(`BEGIN:VEVENT\r\n${row.ical_extra}\r\nEND:VEVENT\r\n`);
      comp.props.push(...kept.props);
      comp.components.push(...kept.components);
    } catch { /* kept text that no longer parses is dropped */ }
  }
  return comp;
}

/** A series (or single event) and its overrides as one iCalendar object. */
function toICalendar(master, overrides = []) {
  const cal = {
    name: 'VCALENDAR',
    props: [{ name: 'VERSION', params: {}, value: '2.0' }, { name: 'PRODID', params: {}, value: PRODID }, { name: 'CALSCALE', params: {}, value: 'GREGORIAN' }],
    components: [vevent(master, master), ...overrides.map(o => vevent(o, master, o.recurrence_id))],
  };
  return serialize(cal);
}

function bad(message) {
  return Object.assign(new Error(message), { status: 415, precondition: '{urn:ietf:params:xml:ns:caldav}valid-calendar-data' });
}

const emailOf = v => String(v || '').replace(/^mailto:/i, '').trim().toLowerCase();

function eventFields(ev, fallbackTz) {
  const ds = getProp(ev, 'DTSTART');
  const start = ds && parseDateValue(ds, fallbackTz);
  if (!start) throw bad('Every event needs a DTSTART');
  let end;
  const de = getProp(ev, 'DTEND');
  const du = getProp(ev, 'DURATION');
  if (de) end = parseDateValue(de, start.tzid)?.date;
  else if (du) {
    const d = parseDuration(du.value);
    if (d != null) end = new Date(start.date.getTime() + d);
  }
  if (!end || !(end > start.date)) end = new Date(start.date.getTime() + (start.allDay ? 86400000 : 60000));
  const status = (getProp(ev, 'STATUS')?.value || '').toUpperCase();
  const extra = ev.props.filter(p => !MAPPED.has(p.name));
  let extraText = serialize({ name: 'X', props: extra, components: ev.components })
    .split('\r\n').slice(1, -2).join('\r\n');
  if (extraText.length > MAX_EXTRA) extraText = '';
  return {
    title: unescapeText(getProp(ev, 'SUMMARY')?.value || '').slice(0, 300).trim() || '(untitled)',
    description: unescapeText(getProp(ev, 'DESCRIPTION')?.value || '').slice(0, 2000),
    location: unescapeText(getProp(ev, 'LOCATION')?.value || '').slice(0, 300),
    start_at: start.date, end_at: end, all_day: start.allDay, tzid: start.allDay ? 'UTC' : start.tzid,
    attendees: getProps(ev, 'ATTENDEE').map(a => emailOf(a.value)).filter(a => a.includes('@')),
    cancelled: status === 'CANCELLED',
    ical_extra: extraText,
  };
}

/**
 * Reads a calendar object a client PUT: { uid, master, overrides } where master has `rrule`
 * and `exdates` and each override has `recurrence_id`. Occurrences a client cancelled
 * (STATUS:CANCELLED) become exdates.
 */
function fromICalendar(text, fallbackTz = 'UTC') {
  let cal;
  try {
    cal = parseICalendar(text);
  } catch (e) {
    throw bad(`Not iCalendar data: ${e.message}`);
  }
  if (cal.name !== 'VCALENDAR') throw bad('Not iCalendar data');
  const events = cal.components.filter(c => c.name === 'VEVENT');
  if (!events.length) throw bad('Only events (VEVENT) are stored here');
  const uid = getProp(events[0], 'UID')?.value?.trim();
  if (!uid || uid.length > 255) throw bad('Every event needs a UID');
  if (events.some(e => getProp(e, 'UID')?.value?.trim() !== uid)) throw bad('One UID per calendar object');
  const tzOf = ev => zoneFor(getProp(ev, 'DTSTART')?.params.TZID, fallbackTz);
  let masterEv = events.find(e => !getProp(e, 'RECURRENCE-ID'));
  const overrideEvs = events.filter(e => e !== masterEv);
  if (!masterEv) masterEv = overrideEvs.shift();
  const master = eventFields(masterEv, tzOf(masterEv));
  const rr = getProp(masterEv, 'RRULE');
  master.rrule = rr ? rr.value.trim() : null;
  master.exdates = [];
  for (const p of getProps(masterEv, 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseDateText(v, p.params.VALUE, p.params.TZID || (master.tzid !== 'UTC' ? master.tzid : undefined), master.tzid);
      if (d) master.exdates.push(d.date.toISOString());
    }
  }
  const overrides = [];
  for (const ev of master.rrule ? overrideEvs : []) {
    const rid = getProp(ev, 'RECURRENCE-ID');
    const at = rid && parseDateValue(rid, master.tzid);
    if (!at) continue;
    const o = eventFields(ev, tzOf(ev));
    if (o.cancelled) master.exdates.push(at.date.toISOString());
    else overrides.push({ ...o, recurrence_id: at.date });
  }
  master.exdates = [...new Set(master.exdates)].sort();
  return { uid, master, overrides };
}

module.exports = { toICalendar, fromICalendar };
