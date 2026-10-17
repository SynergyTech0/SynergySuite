// Repeating events (RFC 5545 RRULE). A series is one row, the master: its first occurrence's
// start and end, the time zone the rule repeats in (tzid), the rule, and the occurrences
// skipped (exdates, as UTC instants). An occurrence changed on its own is a row of its own, an
// override, pointing at the master (series_id) and naming the occurrence it replaces
// (recurrence_id). Expansion happens in the series' time zone with rrule-temporal (MIT), so a
// 9:00 meeting in New York stays at 9:00 on both sides of a daylight saving change.
const { RRuleTemporal } = require('rrule-temporal');
const { formatLocal, formatDate, formatUtc, fromWallTime } = require('@synergy/dav');

const FREQS = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const MAX_ITER = 100000;
const DAY = 86400000;

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** "FREQ=WEEKLY;BYDAY=MO,WE" → { FREQ: 'WEEKLY', BYDAY: 'MO,WE' } (keys upper-case). */
function parseRule(rrule) {
  const out = {};
  for (const part of String(rrule || '').replace(/^RRULE:/i, '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().toUpperCase();
  }
  return out;
}

function ruleText(parts) {
  const order = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST', 'COUNT', 'UNTIL'];
  const keys = Object.keys(parts).sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99 || a.localeCompare(b));
  return keys.filter(k => parts[k] != null && parts[k] !== '').map(k => `${k}=${parts[k]}`).join(';');
}

const dtstartLine = (start, tzid, allDay) =>
  allDay ? `DTSTART;VALUE=DATE:${formatDate(start)}` : `DTSTART;TZID=${tzid}:${formatLocal(start, tzid)}`;

const cache = new Map();
/** The rule object for a series row, cached by its id and rule. */
function ruleFor(ev) {
  const start = new Date(ev.start_at);
  const key = `${ev.id}|${start.getTime()}|${ev.tzid}|${ev.all_day}|${ev.rrule}`;
  let r = cache.get(key);
  if (!r) {
    r = new RRuleTemporal({ rruleString: `${dtstartLine(start, ev.tzid || 'UTC', ev.all_day)}\nRRULE:${ev.rrule}`, maxIterations: MAX_ITER });
    if (cache.size > 2000) cache.clear();
    cache.set(key, r);
  }
  return r;
}

/**
 * Checks and tidies a rule from the web app or a phone. All-day series need a date UNTIL and
 * timed ones a UTC time, so an UNTIL is rewritten to match. Returns null for "doesn't repeat".
 */
function cleanRule(rrule, { start, tzid, allDay }) {
  if (rrule == null || rrule === '') return null;
  if (typeof rrule !== 'string' || rrule.length > 500) throw bad('rrule must be a recurrence rule');
  const parts = parseRule(rrule);
  if (!FREQS.includes(parts.FREQ)) throw bad('Events can repeat hourly, daily, weekly, monthly or yearly');
  if (parts.INTERVAL && !/^\d{1,3}$/.test(parts.INTERVAL)) throw bad('INTERVAL must be a number');
  if (parts.INTERVAL === '1') delete parts.INTERVAL;
  if (parts.COUNT && (!/^\d{1,4}$/.test(parts.COUNT) || +parts.COUNT < 1)) throw bad('COUNT must be between 1 and 9999');
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(parts.UNTIL);
    if (!m) throw bad('UNTIL must be a date');
    if (parts.COUNT) throw bad('A rule ends by COUNT or UNTIL, not both');
    // A floating UNTIL is read in the series' zone; a date means "through that day".
    let until;
    if (!m[4]) until = allDay ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : fromWallTime({ year: +m[1], month: +m[2], day: +m[3], hour: 23, minute: 59, second: 59 }, tzid);
    else if (m[7]) until = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    else until = fromWallTime({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6] }, tzid);
    parts.UNTIL = allDay ? formatDate(until) : formatUtc(until);
  }
  const text = ruleText(parts);
  try {
    const r = new RRuleTemporal({ rruleString: `${dtstartLine(new Date(start), tzid, allDay)}\nRRULE:${text}`, maxIterations: MAX_ITER });
    r.between(new Date(start), new Date(new Date(start).getTime() + DAY), true);
  } catch (e) {
    throw bad(`That repeat rule can't be used: ${String(e.message || e).slice(0, 120)}`);
  }
  return text;
}

/** When the series' last occurrence ends, or null if it repeats forever. */
function seriesEnd(ev) {
  if (!ev.rrule) return null;
  const parts = parseRule(ev.rrule);
  const dur = new Date(ev.end_at) - new Date(ev.start_at);
  if (!parts.COUNT && !parts.UNTIL) return null;
  const r = ruleFor(ev);
  let last = null;
  if (parts.COUNT) {
    const all = r.all((_, i) => i < Number(parts.COUNT));
    last = all.length ? all[all.length - 1] : null;
  } else {
    const occ = r.between(new Date(ev.start_at), untilDate(parts.UNTIL), true);
    last = occ.length ? occ[occ.length - 1] : null;
  }
  return new Date((last ? last.epochMilliseconds : new Date(ev.start_at).getTime()) + dur);
}

function untilDate(u) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(u);
  if (!m) return new Date(8.64e15);
  return m[4] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59));
}

/**
 * Occurrences of a series overlapping [from, to): { start, end, recurrenceId } with Dates,
 * skipping exdates and the occurrences in `skip` (overridden ones), at most `limit`.
 */
function expand(ev, from, to, { skip = new Set(), limit = 5000 } = {}) {
  if (!ev.rrule) return [];
  const start = new Date(ev.start_at).getTime();
  const dur = new Date(ev.end_at).getTime() - start;
  const ex = new Set((ev.exdates || []).map(d => new Date(d).getTime()));
  const lo = Math.max(start, from.getTime() - dur);
  if (lo >= to.getTime()) return [];
  const out = [];
  for (const z of ruleFor(ev).between(new Date(lo), to, true)) {
    const s = z.epochMilliseconds;
    if (s >= to.getTime() || s + dur <= from.getTime() || ex.has(s) || skip.has(s)) continue;
    out.push({ start: new Date(s), end: new Date(s + dur), recurrenceId: new Date(s) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Is `at` one of the series' occurrences (before exdates)? */
function isOccurrence(ev, at) {
  const t = new Date(at).getTime();
  return ruleFor(ev).between(new Date(t - 1000), new Date(t + 1000), true).some(z => z.epochMilliseconds === t);
}

/** How many occurrences the rule makes before `at` (exdated ones count, as RFC 5545 says). */
function countBefore(ev, at) {
  return ruleFor(ev).between(new Date(ev.start_at), new Date(new Date(at).getTime() - 1), true).length;
}

/** The rule cut so the last occurrence is the one before `at`. */
function ruleEndingBefore(ev, at) {
  const parts = parseRule(ev.rrule);
  delete parts.COUNT;
  const t = new Date(at).getTime();
  parts.UNTIL = ev.all_day ? formatDate(new Date(t - DAY)) : formatUtc(new Date(t - 1000));
  return ruleText(parts);
}

/** The rule for the part of the series from `at` on, its COUNT reduced by the occurrences before. */
function ruleFrom(ev, at, rrule = ev.rrule) {
  const parts = parseRule(rrule);
  if (parts.COUNT && rrule === ev.rrule) {
    const left = Number(parts.COUNT) - countBefore(ev, at);
    parts.COUNT = String(Math.max(1, left));
  }
  return ruleText(parts);
}

/** The next occurrence at or after `at` (or the last one, for a series that has ended). */
function nearest(ev, at, skip = new Set()) {
  const r = ruleFor(ev);
  const ex = new Set((ev.exdates || []).map(d => new Date(d).getTime()));
  const fromT = Math.max(new Date(at).getTime(), new Date(ev.start_at).getTime());
  for (const z of r.between(new Date(fromT), new Date(fromT + 400 * DAY), true)) {
    if (!ex.has(z.epochMilliseconds) && !skip.has(z.epochMilliseconds)) return new Date(z.epochMilliseconds);
  }
  const end = seriesEnd(ev);
  if (end) {
    const back = r.between(new Date(end.getTime() - 400 * DAY), end, true).filter(z => !ex.has(z.epochMilliseconds));
    if (back.length) return new Date(back[back.length - 1].epochMilliseconds);
  }
  return new Date(ev.start_at);
}

module.exports = {
  parseRule, ruleText, cleanRule, seriesEnd, expand, isOccurrence, countBefore, ruleEndingBefore, ruleFrom, nearest, ruleFor,
};
