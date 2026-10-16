// Compliance protocol (see @synergy/compliance): the Admin center searches and exports forms
// and their responses over the internal network with COMPLIANCE_TOKEN. A form whose owner is
// on hold is kept when deleted (held_deleted_at, hidden everywhere else, responses with it),
// and a retention sweep removes old responses and forms unless the owner is on hold.
const express = require('express');
const {
  complianceAuthorized, createPolicyClient, parseQuery, queryToSql,
  MAX_PAGE, MAX_EXPORT_IDS,
} = require('@synergy/compliance');

const APP = 'forms';
const KINDS = ['form', 'response'];
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

// ~200 characters of plain text around the first match.
function snippet(text, parsed) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = t.toLowerCase();
  let at = -1;
  for (const g of parsed.groups) for (const term of g) {
    const i = lower.indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + t.slice(start, start + 200) + (start + 200 < t.length ? '…' : '');
}

// Forms and responses as one list. A response's participants are the addresses typed into
// the form's email fields; its text is "Label: value" per answer (field id for answers to
// fields no longer on the form).
const ROWS = `
  SELECT 'form' AS kind, f.id, f.title, lower(f.created_by) AS owner, f.updated_at AS date,
         concat_ws(E'\\n', f.title, f.description,
           (SELECT string_agg(fl->>'label', E'\\n') FROM jsonb_array_elements(f.fields) fl)) AS text,
         '{}'::text[] AS participants, f.held_deleted_at, f.id AS form_id
    FROM forms f
  UNION ALL
  SELECT 'response', s.id, 'Response to ' || f.title, lower(f.created_by), s.submitted_at,
         concat_ws(E'\\n',
           (SELECT string_agg((fl->>'label') || ': ' || coalesce(s.data->>(fl->>'id'), ''), E'\\n' ORDER BY ord)
              FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS t(fl, ord)),
           -- Answers to fields an edit has since removed are kept by id, so they stay searchable.
           (SELECT string_agg(d.k || ': ' || d.v, E'\\n' ORDER BY d.k) FROM jsonb_each_text(s.data) AS d(k, v)
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.fields) fl WHERE fl->>'id' = d.k))),
         ARRAY(SELECT DISTINCT lower(trim(s.data->>(fl->>'id'))) FROM jsonb_array_elements(f.fields) fl
                WHERE fl->>'type' = 'email' AND coalesce(trim(s.data->>(fl->>'id')), '') LIKE '%@%'),
         f.held_deleted_at, f.id
    FROM submissions s JOIN forms f ON f.id = s.form_id`;

function hit(r, parsed) {
  return {
    id: `${r.kind}:${r.id}`,
    kind: r.kind,
    title: r.title,
    owner: r.owner,
    participants: r.participants.filter(p => p !== r.owner),
    date: new Date(r.date).toISOString(),
    snippet: snippet(r.text, parsed),
    size: Buffer.byteLength(r.text || ''),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

function createCompliance(q) {
  async function search(body) {
    const s = parseSearch(body);
    const kinds = s.kinds.length ? KINDS.filter(k => s.kinds.includes(k)) : KINDS;
    if (!kinds.length) return { app: APP, hits: [], total: 0 };
    const params = [];
    const p = v => `$${params.push(v)}`;
    const kw = queryToSql(s.query, ['x.text'], 1);
    params.push(...kw.params);
    const where = [kw.sql, `x.kind = ANY(${p(kinds)}::text[])`];
    if (s.custodians.length) {
      const c = p(s.custodians);
      where.push(`(x.owner = ANY(${c}::text[]) OR x.participants && ${c}::text[])`);
    }
    if (s.from) where.push(`x.date >= ${p(s.from)}`);
    if (s.to) where.push(`x.date < ${p(s.to)}`);
    const base = `FROM (${ROWS}) x WHERE ${where.join(' AND ')}`;
    const total = Number((await q(`SELECT count(*) AS n ${base}`, params)).rows[0].n);
    const rows = (await q(
      `SELECT x.* ${base} ORDER BY x.date DESC, x.kind, x.id DESC LIMIT ${p(s.limit)} OFFSET ${p(s.offset)}`,
      params)).rows;
    const next = s.offset + rows.length;
    return {
      app: APP,
      hits: rows.map(r => hit(r, s.query)),
      total,
      ...(next < total ? { nextCursor: Buffer.from(String(next)).toString('base64url') } : {}),
    };
  }

  async function exportItems(body) {
    const ids = body && body.ids;
    if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) throw bad('ids must be an array of strings');
    if (ids.length > MAX_EXPORT_IDS) throw bad(`at most ${MAX_EXPORT_IDS} ids`);
    const want = k => ids.map(id => new RegExp(`^${k}:(\\d+)$`).exec(id)).filter(Boolean).map(m => m[1]);
    const forms = want('form'), responses = want('response');
    if (!forms.length && !responses.length) return { items: [] };
    const rows = (await q(
      `SELECT x.*, f.slug, f.description, f.fields, f.published, f.created_at AS form_created_at,
              s.data, (SELECT count(*) FROM submissions c WHERE c.form_id = f.id)::int AS response_count
         FROM (${ROWS}) x JOIN forms f ON f.id = x.form_id
         LEFT JOIN submissions s ON x.kind = 'response' AND s.id = x.id
        WHERE (x.kind = 'form' AND x.id = ANY($1::bigint[])) OR (x.kind = 'response' AND x.id = ANY($2::bigint[]))
        ORDER BY x.date`, [forms, responses])).rows;
    const none = parseQuery('');
    return {
      items: rows.map(r => ({
        ...hit(r, none),
        app: APP,
        text: r.text,
        metadata: r.kind === 'form'
          ? {
              slug: r.slug.replace(/~\d+$/, ''),   // a held delete frees the slug with a ~id suffix
              description: r.description, fields: r.fields, published: r.published,
              createdAt: r.form_created_at, responses: r.response_count, deletedAt: r.held_deleted_at,
            }
          : {
              form: { id: `form:${r.form_id}`, title: r.title.replace(/^Response to /, ''), fields: r.fields },
              answers: r.data, deletedAt: r.held_deleted_at,
            },
      })),
    };
  }

  // The one way forms are deleted: for real (responses cascade), unless the owner is on hold,
  // in which case the form and its responses stay, marked held_deleted_at and hidden. The slug
  // gets a ~id suffix so the owner can make a new form with the same title.
  async function deleteForms(ids) {
    const rows = (await q('SELECT id, created_by FROM forms WHERE id = ANY($1::bigint[]) AND held_deleted_at IS NULL', [ids])).rows;
    let n = 0;
    for (const f of rows) {
      n += (await policy.onHold(f.created_by))
        ? (await q(`UPDATE forms SET held_deleted_at = now(), slug = slug || '~' || id WHERE id = $1`, [f.id])).rowCount
        : (await q('DELETE FROM forms WHERE id = $1', [f.id])).rowCount;
    }
    return n;
  }

  // Responses have no delete in the app, so retention is their only delete path.
  async function deleteResponses(formId, before) {
    const f = (await q('SELECT created_by FROM forms WHERE id = $1', [formId])).rows[0];
    if (!f || await policy.onHold(f.created_by)) return 0;
    return (await q('DELETE FROM submissions WHERE form_id = $1 AND submitted_at < $2', [formId, before])).rowCount;
  }

  // Retention: responses by when they were submitted, forms by when they were last changed.
  async function sweepRetention() {
    let n = 0;
    const responseDays = await policy.retentionDays('response');
    if (responseDays != null) {
      const cutoff = new Date(Date.now() - responseDays * 86400000);
      const forms = (await q('SELECT DISTINCT form_id FROM submissions WHERE submitted_at < $1', [cutoff])).rows;
      for (const { form_id: id } of forms) n += await deleteResponses(id, cutoff);
    }
    const formDays = await policy.retentionDays('form');
    if (formDays != null) {
      const cutoff = new Date(Date.now() - formDays * 86400000);
      const old = (await q('SELECT id, created_by FROM forms WHERE held_deleted_at IS NULL AND updated_at < $1', [cutoff])).rows;
      for (const f of old) if (!(await policy.onHold(f.created_by))) n += await deleteForms([f.id]);
    }
    return n;
  }

  function startRetentionSweep(everyMs = 3600000) {
    const run = () => sweepRetention().catch(e => console.error('[forms] retention sweep', e));
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

  return { router, deleteForms, sweepRetention, startRetentionSweep };
}

module.exports = { createCompliance, policy };
