// Suite search (POST /api/search, see @synergy/search): the forms and responses the signed-in
// person can open in the app: forms they own or that are shared with them (server/access.js),
// as an editor or a viewer, and those forms' responses, exactly as GET /api/forms/:id and
// GET /api/forms/:id/submissions allow.
// Forms a held owner deleted (held_deleted_at), and their responses, never come back; those are
// for eDiscovery only.
const { readSearchQuery, queryToSql, snippet, clipText } = require('@synergy/search');
const { principalsFor, visibleSql } = require('./access');

const APP = 'forms';
const KINDS = ['form', 'response'];

// Which forms (alias f) the person can open and see the results of: $3 is their email, $4 their principals.
const FORM_VISIBLE = visibleSql('f', 3, 4);

// Forms (title, description, questions) and responses ("Question: answer" lines) as one list.
const ROWS = `
  SELECT 'form' AS kind, f.id, f.id AS form_id, f.title, f.created_by AS person, f.updated_at AS date,
         concat_ws(E'\\n', f.title, f.description,
           (SELECT string_agg(concat_ws(' ', fl->>'label',
                     (SELECT string_agg(o, ' ') FROM jsonb_array_elements_text(fl->'options') o)), E'\\n')
              FROM jsonb_array_elements(f.fields) fl)) AS text
    FROM forms f WHERE ${FORM_VISIBLE}
  UNION ALL
  SELECT 'response', s.id, f.id, 'Response to ' || f.title,
         (SELECT trim(s.data->>(fl->>'id')) FROM jsonb_array_elements(f.fields) fl
           WHERE fl->>'type' = 'email' AND coalesce(trim(s.data->>(fl->>'id')), '') LIKE '%@%' LIMIT 1),
         s.submitted_at,
         (SELECT string_agg((fl->>'label') || ': ' || coalesce(s.data->>(fl->>'id'), ''), E'\\n' ORDER BY ord)
            FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS t(fl, ord))
    FROM submissions s JOIN forms f ON f.id = s.form_id WHERE ${FORM_VISIBLE}`;

function createSearch(q) {
  return async function search(email, body) {
    const s = readSearchQuery(body);
    const kinds = s.kinds.length ? KINDS.filter(k => s.kinds.includes(k)) : KINDS;
    if (!kinds.length) return { app: APP, results: [] };
    const kw = queryToSql(s.parsed, ['x.text'], 5);
    const { rows } = await q(
      `SELECT x.* FROM (${ROWS}) x
        WHERE x.kind = ANY($1::text[]) AND ${kw.sql}
        ORDER BY x.date DESC, x.kind, x.id DESC LIMIT $2`,
      [kinds, s.limit, email, principalsFor(email), ...kw.params]);
    return {
      app: APP,
      results: rows.map(r => ({
        id: `${r.kind}:${r.id}`,
        kind: r.kind,
        title: r.title,
        snippet: snippet(r.text, s.parsed),
        date: new Date(r.date).toISOString(),
        // The app opens the form builder, or the form's responses, from these params.
        url: r.kind === 'form' ? `/?form=${r.form_id}` : `/?form=${r.form_id}&responses=1`,
        ...(r.person ? { person: r.person } : {}),
        ...(s.text ? { text: clipText(r.text) } : {}),
      })),
    };
  };
}

module.exports = { createSearch };
