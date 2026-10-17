// Repeating-event rules on their own: expansion in the series' time zone across daylight
// saving changes, exceptions, and the rule arithmetic behind "this and following".
const test = require('node:test');
const assert = require('node:assert');
const recur = require('../server/recur');
const { toICalendar, fromICalendar } = require('../server/ical');

const iso = list => list.map(o => o.start.toISOString());
const series = (over) => ({
  id: Math.random(), start_at: '2026-03-02T14:30:00Z', end_at: '2026-03-02T15:00:00Z', tzid: 'America/New_York',
  all_day: false, exdates: [], ...over,
});

test('weekly on chosen days keeps local time across the spring change', () => {
  const ev = series({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' });
  assert.deepStrictEqual(iso(recur.expand(ev, new Date('2026-03-01'), new Date('2026-03-12'))), [
    '2026-03-02T14:30:00.000Z', '2026-03-04T14:30:00.000Z', // 9:30 EST
    '2026-03-09T13:30:00.000Z', '2026-03-11T13:30:00.000Z', // 9:30 EDT
  ]);
  // Ends keep the series' length.
  assert.strictEqual(recur.expand(ev, new Date('2026-03-09'), new Date('2026-03-10'))[0].end.toISOString(), '2026-03-09T14:00:00.000Z');
});

test('daily across the autumn change in Europe', () => {
  const ev = series({ start_at: '2026-10-23T07:00:00Z', end_at: '2026-10-23T08:00:00Z', tzid: 'Europe/Berlin', rrule: 'FREQ=DAILY;COUNT=4' });
  assert.deepStrictEqual(iso(recur.expand(ev, new Date('2026-10-01'), new Date('2026-11-30'))), [
    '2026-10-23T07:00:00.000Z', '2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-26T08:00:00.000Z',
  ]);
  assert.strictEqual(recur.seriesEnd(ev).toISOString(), '2026-10-26T09:00:00.000Z');
});

test('monthly by date, by nth weekday, last weekday, yearly, interval and until', () => {
  const at = (rrule, start, from, to) => iso(recur.expand(series({ rrule, start_at: start, end_at: new Date(new Date(start).getTime() + 3600000).toISOString() }), new Date(from), new Date(to)));
  assert.deepStrictEqual(at('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31T15:00:00Z', '2026-01-01', '2026-06-01'),
    ['2026-01-31T15:00:00.000Z', '2026-03-31T14:00:00.000Z', '2026-05-31T14:00:00.000Z']);
  assert.deepStrictEqual(at('FREQ=MONTHLY;BYDAY=2TU', '2026-01-13T15:00:00Z', '2026-01-01', '2026-04-01'),
    ['2026-01-13T15:00:00.000Z', '2026-02-10T15:00:00.000Z', '2026-03-10T14:00:00.000Z']);
  assert.deepStrictEqual(at('FREQ=MONTHLY;BYDAY=-1FR', '2026-01-30T15:00:00Z', '2026-01-01', '2026-04-01'),
    ['2026-01-30T15:00:00.000Z', '2026-02-27T15:00:00.000Z', '2026-03-27T14:00:00.000Z']);
  assert.deepStrictEqual(at('FREQ=YEARLY', '2024-02-29T15:00:00Z', '2024-01-01', '2029-01-01'),
    ['2024-02-29T15:00:00.000Z', '2028-02-29T15:00:00.000Z']);
  assert.deepStrictEqual(at('FREQ=DAILY;INTERVAL=3;UNTIL=20260110T235959Z', '2026-01-01T15:00:00Z', '2026-01-01', '2026-02-01'),
    ['2026-01-01T15:00:00.000Z', '2026-01-04T15:00:00.000Z', '2026-01-07T15:00:00.000Z', '2026-01-10T15:00:00.000Z']);
});

test('exdates and overridden occurrences are left out; all-day series stay on their dates', () => {
  const ev = series({ rrule: 'FREQ=DAILY;COUNT=5', exdates: ['2026-03-03T14:30:00.000Z'] });
  const skip = new Set([new Date('2026-03-05T14:30:00Z').getTime()]);
  assert.deepStrictEqual(iso(recur.expand(ev, new Date('2026-03-01'), new Date('2026-04-01'), { skip })),
    ['2026-03-02T14:30:00.000Z', '2026-03-04T14:30:00.000Z', '2026-03-06T14:30:00.000Z']);
  const allDay = series({ start_at: '2026-03-07T00:00:00Z', end_at: '2026-03-08T00:00:00Z', tzid: 'UTC', all_day: true, rrule: 'FREQ=WEEKLY;COUNT=3' });
  assert.deepStrictEqual(iso(recur.expand(allDay, new Date('2026-03-01'), new Date('2026-04-01'))),
    ['2026-03-07T00:00:00.000Z', '2026-03-14T00:00:00.000Z', '2026-03-21T00:00:00.000Z']);
});

test('an occurrence that only partly overlaps the range is included', () => {
  const ev = series({ start_at: '2026-03-02T23:00:00Z', end_at: '2026-03-03T01:00:00Z', tzid: 'UTC', rrule: 'FREQ=DAILY' });
  assert.deepStrictEqual(iso(recur.expand(ev, new Date('2026-03-04T00:00:00Z'), new Date('2026-03-04T12:00:00Z'))), ['2026-03-03T23:00:00.000Z']);
});

test('this and following: the rule is cut before the split, the rest keeps its remaining count', () => {
  const ev = series({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6' });
  const at = '2026-03-11T13:30:00.000Z';
  assert.strictEqual(recur.countBefore(ev, at), 3);
  assert.strictEqual(recur.ruleEndingBefore(ev, at), 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260311T132959Z');
  assert.strictEqual(recur.ruleFrom(ev, at), 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3');
  const first = { ...ev, rrule: recur.ruleEndingBefore(ev, at) };
  assert.deepStrictEqual(iso(recur.expand(first, new Date('2026-03-01'), new Date('2026-04-01'))),
    ['2026-03-02T14:30:00.000Z', '2026-03-04T14:30:00.000Z', '2026-03-09T13:30:00.000Z']);
  const allDay = series({ start_at: '2026-03-01T00:00:00Z', end_at: '2026-03-02T00:00:00Z', tzid: 'UTC', all_day: true, rrule: 'FREQ=DAILY' });
  assert.strictEqual(recur.ruleEndingBefore(allDay, '2026-03-05T00:00:00Z'), 'FREQ=DAILY;UNTIL=20260304');
});

test('rules are checked and tidied', () => {
  const opts = { start: '2026-03-02T14:30:00Z', tzid: 'America/New_York', allDay: false };
  assert.strictEqual(recur.cleanRule('', opts), null);
  assert.strictEqual(recur.cleanRule('RRULE:freq=weekly;interval=1;byday=mo', opts), 'FREQ=WEEKLY;BYDAY=MO');
  // A date UNTIL on a timed series means through that day in the series' zone.
  assert.strictEqual(recur.cleanRule('FREQ=DAILY;UNTIL=20260310', opts), 'FREQ=DAILY;UNTIL=20260311T035959Z');
  assert.throws(() => recur.cleanRule('FREQ=SECONDLY', opts), /hourly, daily/);
  assert.throws(() => recur.cleanRule('FREQ=DAILY;COUNT=2;UNTIL=20260310', opts), /COUNT or UNTIL/);
  assert.throws(() => recur.cleanRule('FREQ=DAILY;BYDAY=XX', opts), /can't be used/);
});

test('iCalendar: a series with an exception and a moved occurrence, out and back in', () => {
  const master = {
    uid: 'u-1', title: 'Review; weekly', description: 'Line 1\nLine 2', location: 'Room, 4', owner_email: 'ada@example.com',
    start_at: '2026-03-02T14:30:00Z', end_at: '2026-03-02T15:00:00Z', tzid: 'America/New_York', all_day: false,
    attendees: ['bob@example.com'], rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-03-16T13:30:00.000Z'],
    ical_extra: 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM',
    updated_at: '2026-03-01T00:00:00Z', created_at: '2026-03-01T00:00:00Z',
  };
  const override = { ...master, title: 'Review (moved)', rrule: null, exdates: [], ical_extra: '', start_at: '2026-03-10T18:00:00Z', end_at: '2026-03-10T18:30:00Z', recurrence_id: '2026-03-09T13:30:00Z' };
  const text = toICalendar(master, [override]);
  assert.match(text, /DTSTART;TZID=America\/New_York:20260302T093000/);
  assert.match(text, /EXDATE;TZID=America\/New_York:20260316T093000/);
  assert.match(text, /RECURRENCE-ID;TZID=America\/New_York:20260309T093000/);
  assert.match(text, /SUMMARY:Review\\; weekly/);
  assert.match(text, /BEGIN:VALARM/);
  const back = fromICalendar(text);
  assert.strictEqual(back.uid, 'u-1');
  assert.strictEqual(back.master.title, 'Review; weekly');
  assert.strictEqual(back.master.description, 'Line 1\nLine 2');
  assert.strictEqual(back.master.location, 'Room, 4');
  assert.strictEqual(back.master.start_at.toISOString(), '2026-03-02T14:30:00.000Z');
  assert.strictEqual(back.master.tzid, 'America/New_York');
  assert.strictEqual(back.master.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.deepStrictEqual(back.master.exdates, ['2026-03-16T13:30:00.000Z']);
  assert.deepStrictEqual(back.master.attendees, ['bob@example.com']);
  assert.match(back.master.ical_extra, /TRIGGER:-PT15M/);
  assert.strictEqual(back.overrides.length, 1);
  assert.strictEqual(back.overrides[0].recurrence_id.toISOString(), '2026-03-09T13:30:00.000Z');
  assert.strictEqual(back.overrides[0].start_at.toISOString(), '2026-03-10T18:00:00.000Z');
});

test('iCalendar from clients: all-day dates, durations, cancelled occurrences, Windows zones', () => {
  const text = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
    'BEGIN:VEVENT', 'UID:x@example.com', 'DTSTART;VALUE=DATE:20260401', 'DTEND;VALUE=DATE:20260402', 'SUMMARY:Holiday', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x@example.com', 'RECURRENCE-ID;VALUE=DATE:20270401', 'DTSTART;VALUE=DATE:20270401', 'STATUS:CANCELLED', 'SUMMARY:Holiday', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const r = fromICalendar(text);
  assert.strictEqual(r.master.all_day, true);
  assert.strictEqual(r.master.start_at.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.deepStrictEqual(r.master.exdates, ['2027-04-01T00:00:00.000Z']);
  assert.strictEqual(r.overrides.length, 0);
  const win = fromICalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=Pacific Standard Time:20260701T090000\r\nDURATION:PT45M\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  assert.strictEqual(win.master.tzid, 'America/Los_Angeles');
  assert.strictEqual(win.master.start_at.toISOString(), '2026-07-01T16:00:00.000Z');
  assert.strictEqual(win.master.end_at.toISOString(), '2026-07-01T16:45:00.000Z');
  assert.throws(() => fromICalendar('BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:t\r\nEND:VTODO\r\nEND:VCALENDAR\r\n'), /Only events/);
  assert.throws(() => fromICalendar('hello'), /Not iCalendar/);
});
