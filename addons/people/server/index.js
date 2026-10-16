const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { businessDays } = require('./days');

const PORT = portFor('people');
const ADMINS = (process.env.ADMIN_EMAILS || '')
  .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5475/people' });
const q = db.q;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    manager_email TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    start_date    DATE,
    pto_days_per_year NUMERIC(5,1) NOT NULL DEFAULT 15,
    emergency_contact TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pto_requests (
    id          BIGSERIAL PRIMARY KEY,
    employee_email TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'vacation' CHECK (kind IN ('vacation','sick','personal','other')),
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    days        NUMERIC(5,1) NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
    decided_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS pto_emp_idx ON pto_requests (employee_email, start_date DESC);
`;

const isAdmin = email => ADMINS.includes(email);


async function balanceFor(email) {
  const emp = (await q('SELECT * FROM employees WHERE email = $1', [email])).rows[0];
  if (!emp) return null;
  const year = new Date().getFullYear();
  const used = (await q(
    `SELECT COALESCE(SUM(days), 0) AS used FROM pto_requests
     WHERE employee_email = $1 AND status = 'approved' AND kind = 'vacation'
       AND EXTRACT(YEAR FROM start_date) = $2`, [email, year])).rows[0].used;
  return { allowance: Number(emp.pto_days_per_year), used: Number(used), remaining: Number(emp.pto_days_per_year) - Number(used) };
}

const router = express.Router();

router.get('/me', wrap(async (req, res) => {
  res.json({
    email: req.userEmail,
    admin: isAdmin(req.userEmail),
    balance: await balanceFor(req.userEmail),
  });
}));

// ---- employees (admin writes; everyone reads directory) ----
router.get('/employees', wrap(async (req, res) => {
  const full = isAdmin(req.userEmail);
  const cols = full
    ? '*'
    : 'id, email, name, title, manager_email, active';
  res.json((await q(`SELECT ${cols} FROM employees ORDER BY lower(name)`)).rows);
}));

router.post('/employees', wrap(async (req, res) => {
  if (!isAdmin(req.userEmail)) return res.status(403).json({ error: 'admin only' });
  const { email, name, title = '', managerEmail = '', phone = '', startDate = null, ptoDays = 15, emergencyContact = '', notes = '' } = req.body || {};
  if (!String(email || '').includes('@') || !String(name || '').trim()) {
    return res.status(400).json({ error: 'email and name required' });
  }
  try {
    const { rows } = await q(
      `INSERT INTO employees (email, name, title, manager_email, phone, start_date, pto_days_per_year, emergency_contact, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [email.toLowerCase(), name.trim(), title, String(managerEmail).toLowerCase().trim(), phone, startDate, Number(ptoDays) || 15, emergencyContact, notes]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'employee exists' });
    throw e;
  }
}));

router.patch('/employees/:id', wrap(async (req, res) => {
  if (!isAdmin(req.userEmail)) return res.status(403).json({ error: 'admin only' });
  const { name, title, managerEmail, phone, startDate, ptoDays, emergencyContact, notes, active } = req.body || {};
  const { rows } = await q(
    `UPDATE employees SET
       name = COALESCE($2,name), title = COALESCE($3,title), manager_email = COALESCE($4,manager_email),
       phone = COALESCE($5,phone), start_date = COALESCE($6,start_date),
       pto_days_per_year = COALESCE($7,pto_days_per_year),
       emergency_contact = COALESCE($8,emergency_contact), notes = COALESCE($9,notes),
       active = COALESCE($10,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, title,
     managerEmail != null ? String(managerEmail).toLowerCase().trim() : null, phone, startDate,
     ptoDays != null ? Number(ptoDays) : null, emergencyContact, notes,
     active != null ? Boolean(active) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

// ---- PTO ----
router.get('/pto', wrap(async (req, res) => {
  const mine = !isAdmin(req.userEmail) || req.query.mine === '1';
  const params = [];
  const where = mine ? `employee_email = $${params.push(req.userEmail)}` : '1=1';
  res.json((await q(
    `SELECT * FROM pto_requests WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params)).rows);
}));

router.post('/pto', wrap(async (req, res) => {
  const { kind = 'vacation', startDate, endDate, note = '' } = req.body || {};
  const s = new Date(startDate), e = new Date(endDate);
  if (isNaN(s) || isNaN(e) || s > e) return res.status(400).json({ error: 'valid start/end dates required' });
  const days = businessDays(startDate, endDate);
  if (days <= 0) return res.status(400).json({ error: 'no business days in range' });
  const { rows } = await q(
    `INSERT INTO pto_requests (employee_email, kind, start_date, end_date, days, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.userEmail, ['vacation', 'sick', 'personal', 'other'].includes(kind) ? kind : 'other',
     startDate, endDate, days, String(note).slice(0, 500)]);
  res.json(rows[0]);
}));

router.post('/pto/:id/decide', wrap(async (req, res) => {
  if (!isAdmin(req.userEmail)) return res.status(403).json({ error: 'admin only' });
  const status = req.body?.status === 'approved' ? 'approved' : 'denied';
  const { rows } = await q(
    `UPDATE pto_requests SET status = $2, decided_by = $3 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [Number(req.params.id), status, req.userEmail]);
  if (!rows.length) return res.status(404).json({ error: 'not found or already decided' });
  res.json(rows[0]);
}));

router.post('/pto/:id/cancel', wrap(async (req, res) => {
  const { rows } = await q(
    `UPDATE pto_requests SET status = 'cancelled'
     WHERE id = $1 AND employee_email = $2 AND status IN ('pending','approved') RETURNING *`,
    [Number(req.params.id), req.userEmail]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

async function main() {
  await db.migrate(SCHEMA, 'people');
  const app = express();
  baseApp(app, express, '256kb');

  app.use('/api', requireUser());
  app.use('/api', router);

  app.use(errorHandler('people'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'people' });

  app.listen(PORT, () => console.log(`SynergyPeople listening on :${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
