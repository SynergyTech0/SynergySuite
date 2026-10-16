// Compliance protocol (see @synergy/compliance): the Admin center searches and exports
// events over the internal network with COMPLIANCE_TOKEN. An event whose organizer is on
// hold is kept when deleted (held_deleted_at, hidden from every normal query), and a
// retention sweep removes events that ended longer ago than the policy allows. A held
// organizer's edits keep what they replaced (event_held_versions), searched with the event
// and exported as metadata.previousVersions.
const express = require('express');
const {
  complianceAuthorized, createPolicyClient, parseQuery, queryToSql,
  MAX_PAGE, MAX_EXPORT_IDS,
} = require('@synergy/compliance');

const recur = require('./recur');

const APP = 'calendar';
const KINDS = ['event'];
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

// Every event, including ones a held organizer deleted, with its searchable text.
const ROWS = `
  SELECT e.*, lower(e.owner_email) AS owner,
         concat_ws(E'\\n', e.title, e.location, e.description) AS text,
         ARRAY(SELECT jsonb_array_elements_text(e.attendees)) AS participants,
         (SELECT string_agg(concat_ws(E'\n', v.fields->>'title', v.fields->>'location', v.fields->>'description'), E'\n' ORDER BY v.id)
            FROM event_held_versions v WHERE v.event_id = e.id) AS history
    FROM events e`;

function hit(r, parsed) {
  return {
    id: `event:${r.id}`,
    kind: 'event',
    title: r.title,
    owner: r.owner,
    participants: r.participants.filter(p => p !== r.owner),
    date: new Date(r.start_at).toISOString(),
    snippet: snippet([r.text, r.history], parsed),
    size: Buffer.byteLength(r.text),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

function createCompliance(q) {
  async function search(body) {
    const s = parseSearch(body);
    if (s.kinds.length && !s.kinds.some(k => KINDS.includes(k))) return { app: APP, hits: [], total: 0 };
    const params = [];
    const p = v => `$${params.push(v)}`;
    const kw = queryToSql(s.query, ['x.text', 'x.history'], 1);
    params.push(...kw.params);
    const where = [kw.sql];
    if (s.custodians.length) {
      const c = p(s.custodians);
      where.push(`(x.owner = ANY(${c}::text[]) OR x.participants && ${c}::text[])`);
    }
    // A repeating series is found by any occurrence in the dates: the SQL keeps every series
    // whose span overlaps them, and expansion below drops the ones with no occurrence there.
    const from = s.from ? p(s.from) : null;
    const to = s.to ? p(s.to) : null;
    if (from || to) {
      const single = [from && `x.start_at >= ${from}`, to && `x.start_at < ${to}`].filter(Boolean).join(' AND ');
      const series = [to && `x.start_at < ${to}`, from && `(x.series_end IS NULL OR x.series_end > ${from})`].filter(Boolean).join(' AND ');
      where.push(`((x.rrule IS NULL AND ${single}) OR (x.rrule IS NOT NULL AND ${series}))`);
    }
    const base = `FROM (${ROWS}) x WHERE ${where.join(' AND ')}`;
    if (!from && !to) {
      const total = Number((await q(`SELECT count(*) AS n ${base}`, params)).rows[0].n);
      const rows = (await q(
        `SELECT x.* ${base} ORDER BY x.start_at DESC, x.id DESC LIMIT ${p(s.limit)} OFFSET ${p(s.offset)}`,
        params)).rows;
      return page(rows.map(r => hit(r, s.query)), total, s);
    }
    const lo = s.from || new Date(-8.64e15);
    const hi = s.to || new Date(8.64e15);
    const cands = (await q(
      `SELECT x.id, x.rrule, x.start_at, x.end_at, x.tzid, x.all_day, x.exdates ${base} ORDER BY x.start_at DESC, x.id DESC LIMIT 20000`,
      params)).rows;
    const firstIn = new Map();
    const ids = [];
    for (const c of cands) {
      if (!c.rrule) { ids.push(c.id); continue; }
      const occ = recur.expand(c, lo, hi, { limit: 400 }).find(o => o.start >= lo);
      if (occ) { ids.push(c.id); firstIn.set(String(c.id), occ.start); }
    }
    const slice = ids.slice(s.offset, s.offset + s.limit);
    const byId = new Map((await q(`SELECT x.* FROM (${ROWS}) x WHERE x.id = ANY($1::bigint[])`, [slice])).rows.map(r => [String(r.id), r]));
    const hits = slice.map(id => byId.get(String(id))).filter(Boolean)
      .map(r => ({ ...hit(r, s.query), ...(firstIn.has(String(r.id)) ? { date: firstIn.get(String(r.id)).toISOString() } : {}) }));
    return page(hits, ids.length, s);
  }

  function page(hits, total, s) {
    const next = s.offset + hits.length;
    return {
      app: APP,
      hits,
      total,
      ...(next < total && hits.length ? { nextCursor: Buffer.from(String(next)).toString('base64url') } : {}),
    };
  }

  async function exportItems(body) {
    const ids = body && body.ids;
    if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) throw bad('ids must be an array of strings');
    if (ids.length > MAX_EXPORT_IDS) throw bad(`at most ${MAX_EXPORT_IDS} ids`);
    const nums = ids.map(id => /^event:(\d+)$/.exec(id)).filter(Boolean).map(m => m[1]);
    if (!nums.length) return { items: [] };
    const rows = (await q(
      `SELECT x.*, COALESCE((SELECT json_agg(v.fields || jsonb_build_object('replacedAt', v.replaced_at) ORDER BY v.id)
                               FROM event_held_versions v WHERE v.event_id = x.id), '[]') AS previous_versions
         FROM (${ROWS}) x WHERE x.id = ANY($1::bigint[]) ORDER BY x.start_at`, [nums])).rows;
    const none = parseQuery('');
    return {
      items: rows.map(r => ({
        ...hit(r, none),
        app: APP,
        text: r.description,
        metadata: {
          calendar: r.calendar,
          location: r.location,
          start: r.start_at,
          end: r.end_at,
          allDay: r.all_day,
          attendees: r.participants,
          source: r.source,
          timeZone: r.tzid,
          ...(r.rrule ? { repeat: r.rrule, skipped: r.exdates } : {}),
          ...(r.series_id ? { seriesId: `event:${r.series_id}`, occurrence: r.recurrence_id } : {}),
          createdAt: r.created_at,
          deletedAt: r.held_deleted_at,
          previousVersions: r.previous_versions,
        },
      })),
    };
  }

  // Before an edit: when the organizer is on hold, keep the event as it is now.
  async function keepVersion(owner, id) {
    if (!(await policy.onHold(owner))) return;
    await q(
      `INSERT INTO event_held_versions (event_id, fields)
       SELECT id, jsonb_build_object('title', title, 'description', description, 'location', location,
                'start', start_at, 'end', end_at, 'allDay', all_day, 'calendar', calendar, 'attendees', attendees,
                'timeZone', tzid, 'repeat', rrule, 'skipped', exdates)
         FROM events WHERE id = $1 AND owner_email = $2 AND held_deleted_at IS NULL`, [id, owner]);
  }

  // The one way events are deleted: for real, unless the organizer is on hold, in which
  // case the rows stay, marked held_deleted_at. A series goes with the occurrences changed on
  // their own (overrides). Returns how many were removed from view.
  async function deleteEvents(owner, ids) {
    if (await policy.onHold(owner)) {
      return (await q(
        `UPDATE events SET held_deleted_at = now()
          WHERE (id = ANY($1::bigint[]) OR series_id = ANY($1::bigint[])) AND owner_email = $2 AND held_deleted_at IS NULL`, [ids, owner])).rowCount;
    }
    return (await q(
      'DELETE FROM events WHERE id = ANY($1::bigint[]) AND owner_email = $2 AND held_deleted_at IS NULL',
      [ids, owner])).rowCount;
  }

  // Retention: events that ended more than the policy's days ago, organizer by organizer,
  // skipping anyone on hold. A series counts as ended when its last occurrence has (one that
  // repeats forever never has), and occurrences changed on their own go with their series.
  const ENDED = `(CASE WHEN rrule IS NULL THEN end_at ELSE series_end END) < $1`;
  async function sweepRetention() {
    const days = await policy.retentionDays('event');
    if (days == null) return 0;
    const cutoff = new Date(Date.now() - days * 86400000);
    const owners = (await q(
      `SELECT DISTINCT owner_email FROM events WHERE held_deleted_at IS NULL AND series_id IS NULL AND ${ENDED}`, [cutoff])).rows;
    let n = 0;
    for (const { owner_email: owner } of owners) {
      if (await policy.onHold(owner)) continue;
      const ids = (await q(
        `SELECT id FROM events WHERE owner_email = $2 AND held_deleted_at IS NULL AND series_id IS NULL AND ${ENDED}`,
        [cutoff, owner])).rows.map(r => r.id);
      n += await deleteEvents(owner, ids);
    }
    return n;
  }

  function startRetentionSweep(everyMs = 3600000) {
    const run = () => sweepRetention().catch(e => console.error('[calendar] retention sweep', e));
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

  return { router, keepVersion, deleteEvents, sweepRetention, startRetentionSweep };
}

module.exports = { createCompliance, policy };
