const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');

const PORT = portFor('portal');
const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

// Upstream service feeds (token-gated read endpoints on Invoice + Desk).
const INVOICE_URL = (process.env.INVOICE_SVC_URL || '').replace(/\/$/, '');
const INVOICE_TOKEN = process.env.INVOICE_SVC_TOKEN || '';
const DESK_URL = (process.env.DESK_SVC_URL || '').replace(/\/$/, '');
const DESK_TOKEN = process.env.DESK_SVC_TOKEN || '';

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5477/portal' });
const q = db.q;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
    id         BIGSERIAL PRIMARY KEY,
    token      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    company    TEXT NOT NULL DEFAULT '',
    welcome    TEXT NOT NULL DEFAULT '',
    active     BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS clients_email_idx ON clients (lower(email));
`;

async function fetchJson(url, token, timeoutMs = 5000) {
  if (!url || !token) return [];
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }   // an upstream being down must degrade gracefully, not 500 the portal
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = c => '$' + (Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const fmtD = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// ---------- staff API ----------
const router = express.Router();
router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail })));

router.get('/clients', wrap(async (req, res) => {
  res.json((await q('SELECT * FROM clients ORDER BY lower(name)')).rows);
}));
router.post('/clients', wrap(async (req, res) => {
  const { name, email, company = '', welcome = '' } = req.body || {};
  if (!String(name || '').trim() || !String(email || '').includes('@')) {
    return res.status(400).json({ error: 'name and valid email required' });
  }
  const token = crypto.randomBytes(18).toString('base64url');
  const { rows } = await q(
    `INSERT INTO clients (token, name, email, company, welcome, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [token, name.trim(), email.toLowerCase().trim(), company, String(welcome).slice(0, 500), req.userEmail]);
  res.json(rows[0]);
}));
router.patch('/clients/:id', wrap(async (req, res) => {
  const { name, email, company, welcome, active } = req.body || {};
  const { rows } = await q(
    `UPDATE clients SET name = COALESCE($2,name), email = COALESCE($3,email),
       company = COALESCE($4,company), welcome = COALESCE($5,welcome), active = COALESCE($6,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, email ? String(email).toLowerCase() : null, company, welcome,
     active != null ? Boolean(active) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));
router.post('/clients/:id/rotate', wrap(async (req, res) => {
  const token = crypto.randomBytes(18).toString('base64url');
  const { rows } = await q('UPDATE clients SET token = $2 WHERE id = $1 RETURNING *', [Number(req.params.id), token]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));
// staff preview of what a client sees
router.get('/clients/:id/preview', wrap(async (req, res) => {
  const c = (await q('SELECT * FROM clients WHERE id = $1', [Number(req.params.id)])).rows[0];
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(await clientData(c));
}));

async function clientData(c) {
  const [invoices, tickets] = await Promise.all([
    fetchJson(`${INVOICE_URL}/api/svc/invoices?email=${encodeURIComponent(c.email)}`, INVOICE_TOKEN),
    fetchJson(`${DESK_URL}/api/svc/tickets?email=${encodeURIComponent(c.email)}`, DESK_TOKEN),
  ]);
  const outstanding = invoices
    .filter(i => i.status === 'open')
    .reduce((s, i) => s + (Number(i.total_cents) - Number(i.amount_paid_cents || 0)), 0);
  return { client: { name: c.name, company: c.company, welcome: c.welcome }, invoices, tickets, outstanding };
}

async function main() {
  await db.migrate(SCHEMA, 'portal');
  const app = express();
  baseApp(app, express, '256kb');

  // ---------- public tokenized portal (oauth2 skip-auth ^/c/) ----------
  app.get('/c/:token', wrap(async (req, res) => {
    const c = (await q('SELECT * FROM clients WHERE token = $1 AND active', [req.params.token])).rows[0];
    if (!c) return res.status(404).send('Portal link not found or deactivated.');
    q('UPDATE clients SET last_seen_at = now() WHERE id = $1', [c.id]).catch(() => {});
    const { invoices, tickets, outstanding } = await clientData(c);

    const invoiceRows = invoices.length ? invoices.map(i => {
      const due = Number(i.total_cents) - Number(i.amount_paid_cents || 0);
      const badge = i.status === 'paid' ? '<span class="b paid">paid</span>'
        : i.status === 'void' ? '<span class="b void">void</span>'
        : '<span class="b open">due</span>';
      const pay = i.status === 'open' && i.hosted_url
        ? `<a class="pay" href="${esc(i.hosted_url)}" target="_blank" rel="noopener">Pay now</a>` : '';
      const pdf = i.pdf_url ? `<a class="lnk" href="${esc(i.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : '';
      return `<tr><td class="mono">${esc(i.number)}</td><td>${badge}</td>
        <td class="mono">${usd(i.total_cents)}</td><td class="mono">${i.status === 'open' ? usd(due) : '—'}</td>
        <td>${fmtD(i.created_at)}</td><td class="right">${pay} ${pdf}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No invoices.</td></tr>';

    const ticketRows = tickets.length ? tickets.map(t =>
      `<tr><td class="mono">${esc(t.number)}</td><td>${esc(t.subject)}</td>
        <td><span class="b ${esc(t.status)}">${esc(t.status)}</span></td>
        <td>${t.message_count} msg</td><td>${fmtD(t.updated_at)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">No support tickets.</td></tr>';

    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.company || c.name)} — Portal</title><style>
body{font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f4f5f8;color:#1d1e26}
@media(prefers-color-scheme:dark){body{background:#111218;color:#e8e9f2}.card{background:#1b1c25 !important}th{color:#8b8fa8 !important}tr{border-color:#2c2e3d !important}}
.wrap{max-width:840px;margin:0 auto;padding:28px 18px}
.head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}
h1{font-size:22px;margin:0}.sub{color:#889}
.summary{display:flex;gap:12px;margin:18px 0;flex-wrap:wrap}
.card{background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 2px 12px rgba(0,0,0,.06);flex:1;min-width:160px}
.card .v{font-size:24px;font-weight:800}.card .l{color:#889;font-size:12.5px}
.welcome{background:#eef2ff;border-radius:12px;padding:12px 16px;margin:14px 0}
@media(prefers-color-scheme:dark){.welcome{background:#20233a}}
h2{font-size:16px;margin:24px 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)}
@media(prefers-color-scheme:dark){table{background:#1b1c25}}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#889;padding:9px 12px}
td{padding:10px 12px;border-top:1px solid #eceef4}tr{border-color:#eceef4}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,Consolas,monospace;font-size:13px}
.right{text-align:right}.empty{color:#889;text-align:center;padding:20px}
.b{padding:1px 9px;border-radius:10px;font-size:11.5px;font-weight:700}
.b.open,.b.due{background:#fde8cf;color:#b45309}.b.paid,.b.solved,.b.closed{background:#d9f5e5;color:#0a6b45}
.b.void{background:#eee;color:#888}.b.pending{background:#fdecd3;color:#8a5a12}.b.investigating,.b.identified{background:#fde8cf;color:#b45309}
.pay{background:#4f46e5;color:#fff;padding:5px 12px;border-radius:7px;text-decoration:none;font-weight:700;font-size:13px}
.lnk{color:#4f46e5;text-decoration:none;font-size:13px;margin-left:6px}
footer{color:#889;font-size:12px;margin-top:26px;text-align:center}
</style></head><body><div class="wrap">
<div class="head"><h1>${esc(c.company || c.name)}</h1><span class="sub">Client portal</span></div>
${c.welcome ? `<div class="welcome">${esc(c.welcome)}</div>` : ''}
<div class="summary">
  <div class="card"><div class="v">${usd(outstanding)}</div><div class="l">Outstanding balance</div></div>
  <div class="card"><div class="v">${invoices.length}</div><div class="l">Invoices</div></div>
  <div class="card"><div class="v">${tickets.filter(t => ['open','pending'].includes(t.status)).length}</div><div class="l">Open tickets</div></div>
</div>
<h2>Invoices</h2>
<table><thead><tr><th>#</th><th>Status</th><th>Total</th><th>Balance</th><th>Date</th><th></th></tr></thead><tbody>${invoiceRows}</tbody></table>
<h2>Support tickets</h2>
<table><thead><tr><th>#</th><th>Subject</th><th>Status</th><th>Activity</th><th>Updated</th></tr></thead><tbody>${ticketRows}</tbody></table>
<footer>Secure portal · powered by SynergyTech</footer>
</div></body></html>`);
  }));

  app.use('/api', requireUser(), (req, res, next) => {
    // ALLOWED_EMAILS limits the staff console to named people; unset, any signed-in user may use it.
    if (ALLOWED.length && !ALLOWED.includes(req.userEmail)) return res.status(403).json({ error: 'not authorized for SynergyPortal' });
    next();
  });
  app.use('/api', router);

  app.use(errorHandler('portal'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'portal' });

  app.listen(PORT, () => console.log(`SynergyPortal listening on :${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
