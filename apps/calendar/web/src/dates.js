// Date helpers for the views, and repeat rules (RFC 5545 RRULE) to and from the editor.

export const DAY_MS = 86400000;
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; };
export const startOfWeek = d => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
export const startOfMonth = d => { const x = startOfDay(d); x.setDate(1); return x; };
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtHour = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
export const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** The six weeks a month view shows. */
export function monthGrid(cursor) {
  const first = startOfWeek(startOfMonth(cursor));
  return [...Array(42)].map((_, i) => addDays(first, i));
}

/**
 * All-day events are stored as UTC midnights, so they sit on the same dates wherever the
 * viewer is: the local Date for each day an all-day event covers.
 */
export function allDayDays(e) {
  const s = new Date(e.start_at), en = new Date(e.end_at);
  const out = [];
  let d = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const last = new Date(en.getUTCFullYear(), en.getUTCMonth(), en.getUTCDate());
  if (sameDay(d, last) || last < d) return [d];
  while (d < last && out.length < 366) { out.push(d); d = addDays(d, 1); }
  return out;
}

export function coversDay(e, day) {
  if (e.all_day) return allDayDays(e).some(d => sameDay(d, day));
  return new Date(e.start_at) < addDays(day, 1) && new Date(e.end_at) > day;
}

export const eventKey = e => `${e.id}|${e.occurrence ? new Date(e.occurrence).getTime() : ''}`;

// ---- repeat rules ----

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

export function parseRule(rrule) {
  const p = {};
  for (const part of String(rrule || '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v) p[k.toUpperCase()] = v.toUpperCase();
  }
  return p;
}

/** Editor state for a rule, given the series' first start. */
export function ruleToState(rrule, start) {
  const s = new Date(start);
  const base = {
    freq: 'NONE', interval: 1, byDay: [WEEKDAYS[s.getDay()]], monthMode: 'date', end: 'never',
    until: dayKey(addMonths(s, 3)), count: 10,
  };
  if (!rrule) return base;
  const p = parseRule(rrule);
  const st = { ...base, freq: p.FREQ || 'NONE', interval: Number(p.INTERVAL || 1) };
  if (p.BYDAY && p.FREQ === 'WEEKLY') st.byDay = p.BYDAY.split(',');
  if (p.FREQ === 'MONTHLY' && p.BYDAY) st.monthMode = /^-1/.test(p.BYDAY) ? 'last' : 'nth';
  if (p.COUNT) { st.end = 'count'; st.count = Number(p.COUNT); }
  if (p.UNTIL) { st.end = 'until'; st.until = `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`; }
  // Rules the editor can't show (e.g. from a phone) are kept as they are.
  const known = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST'];
  if (Object.keys(p).some(k => !known.includes(k)) || !['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(st.freq)) st.raw = rrule;
  return st;
}

export function nthOfMonth(d) {
  const n = Math.ceil(d.getDate() / 7);
  const last = addDays(d, 7).getMonth() !== d.getMonth();
  return { n, last };
}

/** The RRULE for editor state (null when it doesn't repeat). */
export function stateToRule(st, start) {
  if (st.raw) return st.raw;
  if (!st.freq || st.freq === 'NONE') return null;
  const s = new Date(start);
  const parts = [`FREQ=${st.freq}`];
  if (st.interval > 1) parts.push(`INTERVAL=${Math.min(999, Math.floor(st.interval))}`);
  if (st.freq === 'WEEKLY') parts.push(`BYDAY=${(st.byDay.length ? st.byDay : [WEEKDAYS[s.getDay()]]).slice().sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)).join(',')}`);
  if (st.freq === 'MONTHLY') {
    const wd = WEEKDAYS[s.getDay()];
    if (st.monthMode === 'nth') parts.push(`BYDAY=${nthOfMonth(s).n}${wd}`);
    else if (st.monthMode === 'last') parts.push(`BYDAY=-1${wd}`);
    else parts.push(`BYMONTHDAY=${s.getDate()}`);
  }
  if (st.end === 'count') parts.push(`COUNT=${Math.max(1, Math.min(999, Math.floor(st.count) || 1))}`);
  if (st.end === 'until' && st.until) parts.push(`UNTIL=${st.until.replace(/-/g, '')}`);
  return parts.join(';');
}

const dayName = c => new Date(2023, 0, 1 + WEEKDAYS.indexOf(c)).toLocaleDateString([], { weekday: 'short' });
const dayLong = c => new Date(2023, 0, 1 + WEEKDAYS.indexOf(c)).toLocaleDateString([], { weekday: 'long' });

/** "Every 2 weeks on Mon, Wed, until 30 Mar 2026" */
export function describeRule(rrule, start) {
  if (!rrule) return 'Does not repeat';
  const p = parseRule(rrule);
  const s = new Date(start);
  const n = Number(p.INTERVAL || 1);
  const unit = { HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[p.FREQ] || 'time';
  let text = n > 1 ? `Every ${n} ${unit}s` : { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly', HOURLY: 'Hourly' }[p.FREQ] || 'Repeats';
  if (p.FREQ === 'WEEKLY' && p.BYDAY) {
    const days = p.BYDAY.split(',');
    text += days.join(',') === 'MO,TU,WE,TH,FR' ? ' on weekdays' : ` on ${days.map(dayName).join(', ')}`;
  }
  if (p.FREQ === 'MONTHLY') {
    const m = /^(-?\d)?([A-Z]{2})$/.exec(p.BYDAY || '');
    if (m) text += ` on the ${m[1] === '-1' ? 'last' : ORD[Number(m[1])] || m[1]} ${dayLong(m[2])}`;
    else text += ` on day ${p.BYMONTHDAY || s.getDate()}`;
  }
  if (p.FREQ === 'YEARLY') text += ` on ${s.toLocaleDateString([], { month: 'long', day: 'numeric' })}`;
  if (p.COUNT) text += `, ${p.COUNT} times`;
  if (p.UNTIL) {
    const u = new Date(Date.UTC(+p.UNTIL.slice(0, 4), +p.UNTIL.slice(4, 6) - 1, +p.UNTIL.slice(6, 8)));
    text += `, until ${u.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  }
  return text;
}

/** Lays out overlapping timed events side by side: { lane, lanes } per event key. */
export function lanes(events) {
  const sorted = [...events].sort((a, b) => new Date(a.start_at) - new Date(b.start_at) || new Date(b.end_at) - new Date(a.end_at));
  const out = new Map();
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    const width = Math.max(1, ...cluster.map(c => out.get(c).lane + 1));
    for (const c of cluster) out.get(c).lanes = width;
    cluster = [];
  };
  const laneEnds = [];
  for (const e of sorted) {
    const s = new Date(e.start_at).getTime(), en = new Date(e.end_at).getTime();
    if (cluster.length && s >= clusterEnd) { flush(); laneEnds.length = 0; }
    let lane = laneEnds.findIndex(t => t <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(en); } else laneEnds[lane] = en;
    const k = eventKey(e);
    out.set(k, { lane, lanes: 1 });
    cluster.push(k);
    clusterEnd = Math.max(clusterEnd, en);
  }
  if (cluster.length) flush();
  return out;
}
