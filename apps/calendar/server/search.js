// Suite search (POST /api/search, see @synergy/search): the events the signed-in person sees in
// the app today, by the same rule as GET /api/events: their own calendar, the shared company
// calendar, and events they are invited to. Events a held organizer deleted (held_deleted_at)
// and earlier versions kept for a hold never come back; those are for eDiscovery only.
// A repeating series is one result, dated and linked to its next occurrence (or its last one,
// once it has ended), with occurrences changed on their own leaving it out.
const { readSearchQuery, queryToSql, snippet, clipText } = require('@synergy/search');
const recur = require('./recur');

const APP = 'calendar';

function createSearch(q, visible) {
  return async function search(email, body) {
    const s = readSearchQuery(body);
    if (s.kinds.length && !s.kinds.includes('event')) return { app: APP, results: [] };
    const kw = queryToSql(s.parsed, ['title', 'location', 'description'], 3);
    const { rows } = await q(
      `SELECT id, title, description, location, start_at, end_at, owner_email, rrule, tzid, all_day, exdates,
              (SELECT array_agg(o.recurrence_id) FROM events o WHERE o.series_id = events.id) AS overridden
         FROM events
        WHERE ${visible} AND ${kw.sql}
        ORDER BY start_at DESC, id DESC LIMIT $2`,
      [email, s.limit, ...kw.params]);
    return {
      app: APP,
      results: rows.map(r => {
        const text = [r.location, r.description].filter(Boolean).join('\n') || r.title;
        const at = r.rrule
          ? recur.nearest(r, new Date(), new Set((r.overridden || []).map(d => new Date(d).getTime())))
          : new Date(r.start_at);
        return {
          id: `event:${r.id}`,
          kind: 'event',
          title: r.title,
          snippet: snippet(text, s.parsed),
          date: at.toISOString(),
          // The app opens the event's week and the event itself from these params.
          url: `/?event=${r.id}&at=${encodeURIComponent(at.toISOString())}`,
          person: r.owner_email,
          ...(s.text ? { text: clipText([r.title, r.location, r.description].filter(Boolean).join('\n')) } : {}),
        };
      }),
    };
  };
}

module.exports = { createSearch };
