const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, requireBearer, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { createCompliance } = require('./compliance');
const { createSearch } = require('./search');
const { SearchInputError } = require('@synergy/search');

const PORT = portFor('forms');

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5474/forms' });
const q = db.q;
const compliance = createCompliance(q);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS forms (
    id          BIGSERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    fields      JSONB NOT NULL DEFAULT '[]',
    published   BOOLEAN NOT NULL DEFAULT false,
    notify_desk BOOLEAN NOT NULL DEFAULT false,
    created_by  TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS submissions (
    id           BIGSERIAL PRIMARY KEY,
    form_id      BIGINT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    data         JSONB NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_form_idx ON submissions (form_id, id DESC);
-- Legal hold: a form its held owner deleted stays, with its responses, hidden from the app
-- but found by compliance search.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
`;

const FIELD_TYPES = ['text', 'textarea', 'email', 'select', 'checkbox'];


function cleanFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.slice(0, 40).map((f, i) => ({
    id: `f${i}`,
    label: String(f.label || '').slice(0, 200).trim() || `Field ${i + 1}`,
    type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
    required: Boolean(f.required),
    options: f.type === 'select'
      ? (Array.isArray(f.options) ? f.options : []).map(o => String(o).slice(0, 100)).filter(Boolean).slice(0, 30)
      : [],
  }));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const router = express.Router();

router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail })));

router.get('/forms', wrap(async (req, res) => {
  res.json((await q(
    `SELECT f.id, f.slug, f.title, f.published, f.updated_at,
       (SELECT count(*) FROM submissions s WHERE s.form_id = f.id)::int AS submission_count
     FROM forms f WHERE f.held_deleted_at IS NULL ORDER BY f.updated_at DESC`)).rows);
}));

router.get('/forms/:id', wrap(async (req, res) => {
  const f = (await q('SELECT * FROM forms WHERE id = $1 AND held_deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!f) return res.status(404).json({ error: 'not found' });
  res.json(f);
}));

router.post('/forms', wrap(async (req, res) => {
  const { title, description = '', fields = [] } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'title required' });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'form';
  try {
    const { rows } = await q(
      `INSERT INTO forms (slug, title, description, fields, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [slug, title.trim(), description, JSON.stringify(cleanFields(fields)), req.userEmail]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'a form with that title exists' });
    throw e;
  }
}));

router.patch('/forms/:id', wrap(async (req, res) => {
  const { title, description, fields, published } = req.body || {};
  const { rows } = await q(
    `UPDATE forms SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       fields = COALESCE($4, fields),
       published = COALESCE($5, published),
       updated_at = now()
     WHERE id = $1 AND held_deleted_at IS NULL RETURNING *`,
    [Number(req.params.id), title, description,
     fields ? JSON.stringify(cleanFields(fields)) : null,
     published != null ? Boolean(published) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

router.delete('/forms/:id', wrap(async (req, res) => {
  await compliance.deleteForms([Number(req.params.id)]);
  res.json({ ok: true });
}));

router.get('/forms/:id/submissions', wrap(async (req, res) => {
  res.json((await q(
    `SELECT s.* FROM submissions s JOIN forms f ON f.id = s.form_id AND f.held_deleted_at IS NULL
     WHERE s.form_id = $1 ORDER BY s.id DESC LIMIT 1000`,
    [Number(req.params.id)])).rows);
}));

router.get('/forms/:id/export', wrap(async (req, res) => {
  const f = (await q('SELECT * FROM forms WHERE id = $1 AND held_deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!f) return res.status(404).json({ error: 'not found' });
  const subs = (await q('SELECT * FROM submissions WHERE form_id = $1 ORDER BY id', [f.id])).rows;
  const fields = f.fields;
  const head = ['submitted_at', ...fields.map(x => x.label)];
  const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.map(csvEsc).join(',')];
  for (const s of subs) {
    lines.push([s.submitted_at.toISOString(), ...fields.map(x => s.data[x.id])].map(csvEsc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${f.slug}-submissions.csv"`);
  res.send(lines.join('\n'));
}));

// Suite search for the signed-in person (the Search app calls this with their gateway headers).
const suiteSearch = createSearch(q);
router.post('/search', wrap(async (req, res) => {
  try {
    res.json(await suiteSearch(req.userEmail, req.body));
  } catch (e) {
    if (e instanceof SearchInputError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

async function main() {
  await db.migrate(SCHEMA, 'forms');

  const app = express();
  baseApp(app, express, '1mb');
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ---- compliance API for the Admin center (COMPLIANCE_TOKEN, internal network) ----
  app.use('/api/compliance', compliance.router);

  // ---- public form pages (oauth2-proxy skip-auth ^/f/) ----
  app.get('/f/:slug', wrap(async (req, res) => {
    const f = (await q('SELECT * FROM forms WHERE slug = $1 AND published = true AND held_deleted_at IS NULL', [req.params.slug])).rows[0];
    if (!f) return res.status(404).send('Form not found');
    const inputs = f.fields.map(fl => {
      const reqd = fl.required ? ' required' : '';
      if (fl.type === 'textarea') return `<label>${esc(fl.label)}${fl.required ? ' *' : ''}<textarea name="${fl.id}"${reqd}></textarea></label>`;
      if (fl.type === 'select') return `<label>${esc(fl.label)}${fl.required ? ' *' : ''}<select name="${fl.id}"${reqd}><option value="">—</option>${fl.options.map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`;
      if (fl.type === 'checkbox') return `<label class="row"><input type="checkbox" name="${fl.id}" value="yes"${reqd}> ${esc(fl.label)}${fl.required ? ' *' : ''}</label>`;
      return `<label>${esc(fl.label)}${fl.required ? ' *' : ''}<input type="${fl.type === 'email' ? 'email' : 'text'}" name="${fl.id}"${reqd}></label>`;
    }).join('\n');
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(f.title)}</title><style>
body{font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f4f5f8;color:#1d1e26}
@media(prefers-color-scheme:dark){body{background:#111218;color:#e8e9f2}.card{background:#1b1c25 !important}input,textarea,select{background:#14151c;color:#e8e9f2;border-color:#333648 !important}}
.card{max-width:560px;margin:40px auto;background:#fff;border-radius:14px;padding:28px 32px;box-shadow:0 6px 30px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 6px}p.desc{color:#777;margin-top:0}
label{display:block;margin:14px 0;font-weight:600;font-size:14px}
label.row{display:flex;gap:8px;align-items:center}
input:not([type=checkbox]),textarea,select{width:100%;margin-top:5px;padding:9px 11px;border:1.5px solid #d8dae5;border-radius:8px;font:inherit}
textarea{height:90px}
button{margin-top:16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:11px 22px;font-weight:700;font-size:15px;cursor:pointer}
.hp{position:absolute;left:-5000px}
</style></head><body><div class="card"><h1>${esc(f.title)}</h1>
${f.description ? `<p class="desc">${esc(f.description)}</p>` : ''}
<form method="POST" action="/f/${esc(f.slug)}">
<div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
${inputs}
<button type="submit">Submit</button>
</form></div></body></html>`);
  }));

  app.post('/f/:slug', wrap(async (req, res) => {
    const f = (await q('SELECT * FROM forms WHERE slug = $1 AND published = true AND held_deleted_at IS NULL', [req.params.slug])).rows[0];
    if (!f) return res.status(404).send('Form not found');
    if (req.body.website) return res.status(400).send('rejected'); // honeypot
    const data = {};
    for (const fl of f.fields) {
      const v = String(req.body[fl.id] ?? '').slice(0, 4000);
      if (fl.required && !v.trim()) return res.status(400).send(`Missing required field: ${esc(fl.label)}`);
      data[fl.id] = v;
    }
    await q('INSERT INTO submissions (form_id, data) VALUES ($1,$2)', [f.id, JSON.stringify(data)]);
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thanks</title>
<style>body{font:16px -apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f5f8}
@media(prefers-color-scheme:dark){body{background:#111218;color:#e8e9f2}}</style></head>
<body><div style="text-align:center"><div style="font-size:52px">✅</div><h2>Thanks — got it.</h2></div></body></html>`);
  }));

  app.use('/api', requireUser());
  app.use('/api', router);

  app.use(errorHandler('forms'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'forms' });

  app.listen(PORT, () => console.log(`SynergyForms listening on :${PORT}`));
  compliance.startRetentionSweep();
}

main().catch(e => { console.error(e); process.exit(1); });
