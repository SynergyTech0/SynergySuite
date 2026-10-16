// Synergy Workspace — identity, sessions and tenancy.
// Passwords are scrypt-hashed with a per-user salt; sessions are opaque random
// tokens stored server-side so they can be revoked. Nothing here trusts the client.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db, all, get, run, now, uid } from './db.mjs';

const SESSION_TTL = 14 * 86400000;   // 14 days, matching the stated policy

// ---------------------------------------------------------------- schema
db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'business', created INTEGER, suspended INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
  created INTEGER, expires INTEGER, ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Add the columns the original single-tenant schema lacked. SQLite has no
// ADD COLUMN IF NOT EXISTS, so check pragma first.
function hasColumn(table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col); }
  catch { return false; }
}
function addColumn(table, col, decl) {
  if (!hasColumn(table, col)) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch {}
  }
}

// Every row that belongs to somebody gets a tenant.
export const TENANT_TABLES = [
  'users', 'files', 'permissions', 'revisions', 'comments', 'calendars', 'events',
  'attendees', 'notes', 'task_lists', 'tasks', 'contacts', 'messages', 'spaces',
  'chat_messages', 'form_responses', 'meetings', 'audit_log', 'groups_tbl',
];
for (const t of TENANT_TABLES) addColumn(t, 'tenant_id', "TEXT NOT NULL DEFAULT 't_synergy'");
addColumn('users', 'pw_hash', 'TEXT');
addColumn('users', 'pw_salt', 'TEXT');
addColumn('users', 'must_change_pw', 'INTEGER DEFAULT 0');
addColumn('users', 'last_login', 'INTEGER');
addColumn('files', 'deleted_blocked_by_hold', 'INTEGER DEFAULT 0');

for (const t of TENANT_TABLES) {
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_tenant ON ${t}(tenant_id)`); } catch {}
}

// ---------------------------------------------------------------- passwords
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  if (candidate.length !== known.length) return false;
  return timingSafeEqual(candidate, known);
}

// ---------------------------------------------------------------- seed tenants
export function seedTenants() {
  if (get('SELECT COUNT(*) c FROM tenants').c === 0) {
    run(`INSERT INTO tenants(id,name,domain,plan,created) VALUES(?,?,?,?,?)`,
      't_synergy', 'Synergy Technologies', 'example.com', 'enterprise', now());
    // A second tenant exists from day one so isolation is testable, not theoretical.
    run(`INSERT INTO tenants(id,name,domain,plan,created) VALUES(?,?,?,?,?)`,
      't_northwind', 'Northwind Health', 'northwindhealth.com', 'business', now());
  }

  // Give every existing user a password so the suite is actually usable.
  for (const u of all('SELECT id,email,pw_hash FROM users')) {
    if (u.pw_hash) continue;
    const { hash, salt } = hashPassword(defaultPasswordFor(u.email));
    run('UPDATE users SET pw_hash=?, pw_salt=?, tenant_id=? WHERE id=?',
      hash, salt, tenantForEmail(u.email), u.id);
  }

  // A user in the second tenant, so cross-tenant reads can be proven to fail.
  if (!get('SELECT id FROM users WHERE email=?', 'ellen@northwindhealth.com')) {
    const { hash, salt } = hashPassword('northwind-demo');
    run(`INSERT INTO users(id,email,name,avatar_color,role,tenant_id,pw_hash,pw_salt,created)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      'u_ellen', 'ellen@northwindhealth.com', 'Ellen Park', '#d93025', 'superadmin',
      't_northwind', hash, salt, now());
    // Northwind gets its own calendar + a private file, to prove isolation.
    run(`INSERT INTO calendars(id,name,owner,color,primary_cal,tenant_id) VALUES(?,?,?,?,1,?)`,
      'cal_ellen', 'Ellen Park', 'ellen@northwindhealth.com', '#d93025', 't_northwind');
    run(`INSERT INTO files(id,name,mime,parent,owner,content,size,created,modified,modified_by,tenant_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      'fl_nw_secret', 'Northwind Confidential.doc', 'application/vnd.synergy-apps.document',
      null, 'ellen@northwindhealth.com', '{"html":"<p>Northwind internal only</p>"}', 40,
      now(), now(), 'ellen@northwindhealth.com', 't_northwind');
  }
}

export const tenantForEmail = email => {
  const domain = String(email).split('@')[1] || '';
  const t = get('SELECT id FROM tenants WHERE domain=?', domain);
  return t ? t.id : 't_synergy';
};

// Demo credentials are derived, not random, so the suite can be logged into.
// In a real deployment this function would not exist.
export const defaultPasswordFor = email => 'synergy-' + String(email).split('@')[0];

// ---------------------------------------------------------------- sessions
export function login(email, password, meta = {}) {
  const u = get('SELECT * FROM users WHERE lower(email)=lower(?)', String(email || '').trim());
  if (!u) return { error: 'Invalid email or password' };
  if (u.suspended) return { error: 'This account has been suspended' };
  const tenant = get('SELECT * FROM tenants WHERE id=?', u.tenant_id);
  if (!tenant || tenant.suspended) return { error: 'This organisation has been suspended' };
  if (!verifyPassword(String(password || ''), u.pw_hash, u.pw_salt))
    return { error: 'Invalid email or password' };

  const token = randomBytes(32).toString('hex');
  run(`INSERT INTO sessions(token,user_id,tenant_id,created,expires,ip,user_agent)
       VALUES(?,?,?,?,?,?,?)`,
    token, u.id, u.tenant_id, now(), now() + SESSION_TTL, meta.ip || '', meta.ua || '');
  run('UPDATE users SET last_login=? WHERE id=?', now(), u.id);
  return { token, user: publicUser(u), tenant };
}

export function logout(token) {
  run('DELETE FROM sessions WHERE token=?', token);
}
export function logoutAll(userId) {
  run('DELETE FROM sessions WHERE user_id=?', userId);
}

export function resolveSession(token) {
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token=?', token);
  if (!s) return null;
  if (s.expires < now()) { run('DELETE FROM sessions WHERE token=?', token); return null; }
  const u = get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || u.suspended) return null;                 // suspension takes effect immediately
  const tenant = get('SELECT * FROM tenants WHERE id=?', u.tenant_id);
  if (!tenant || tenant.suspended) return null;
  return {
    token, user: publicUser(u), tenant,
    email: u.email, userId: u.id, tenantId: u.tenant_id, role: u.role,
  };
}

export const publicUser = u => ({
  id: u.id, email: u.email, name: u.name, avatar_color: u.avatar_color,
  role: u.role, org_unit: u.org_unit, suspended: u.suspended, tenant_id: u.tenant_id,
  last_login: u.last_login,
});

export const ROLES = ['member', 'admin', 'superadmin'];
export const isAdmin = ctx => ctx && (ctx.role === 'admin' || ctx.role === 'superadmin');
export const isSuperAdmin = ctx => ctx && ctx.role === 'superadmin';

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(p => {
    const i = p.indexOf('=');
    return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
  }).filter(([k]) => k));
}

seedTenants();
