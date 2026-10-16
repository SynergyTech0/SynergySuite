/*
 * Bootstrap for a compose deploy: the first admin and the suite gateway's OIDC client.
 * Runs once per `docker compose up` (the auth-init service) after auth is healthy. Idempotent:
 *   - creates the admin (SEED_ADMIN_EMAIL, default admin@SUITE_DOMAIN) only if that user does not
 *     exist, with SEED_ADMIN_PASSWORD or a random password printed once. An existing admin's
 *     password is never touched, so changing it in the account page sticks.
 *   - registers the gateway client OIDC_CLIENT_ID with secret OIDC_CLIENT_SECRET and redirect URI
 *     GATEWAY_REDIRECT_URI, or brings an existing one in line with them (secret, redirect URI,
 *     first-party, enabled). A client registered by hand in the admin page with the same ID is
 *     kept and only adjusted.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const env = (k) => (process.env[k] ?? '').trim();

const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 2 });
const authUrl = (env('AUTH_INTERNAL_URL') || 'http://auth:3500').replace(/\/$/, '');
const now = Date.now();

const SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const GRANTS = ['authorization_code', 'refresh_token'];

async function waitForAuth() {
  // The auth app creates its schema (sa_*) on first DB use; JWKS touches it.
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${authUrl}/api/oidc/jwks`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`auth did not answer at ${authUrl}/api/oidc/jwks`);
}

async function ensureAdmin() {
  const domain = env('SUITE_DOMAIN') || 'example.com';
  const email = (env('SEED_ADMIN_EMAIL') || `admin@${domain}`).toLowerCase();
  const found = await pool.query(`SELECT id FROM sa_users WHERE email = $1::text`, [email]);
  if (found.rows.length) {
    console.log(`admin ${email}: already exists`);
    return;
  }
  const given = env('SEED_ADMIN_PASSWORD');
  const password = given || 'SynergyAuth-' + randomBytes(9).toString('hex');
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO sa_users (email, name, password_hash, role, created_ms, updated_ms)
     VALUES ($1::text, $2::text, $3::text, 'admin', ${now}, ${now})`,
    [email, env('SEED_ADMIN_NAME') || 'Administrator', hash],
  );
  console.log(`admin ${email}: created`);
  if (!given) console.log(`admin password (shown once, change it after signing in): ${password}`);
}

async function ensureGatewayClient() {
  const clientId = env('OIDC_CLIENT_ID');
  const secret = env('OIDC_CLIENT_SECRET');
  const redirectUri = env('GATEWAY_REDIRECT_URI');
  if (!clientId || !secret || !redirectUri) {
    console.log('gateway client: OIDC_CLIENT_ID, OIDC_CLIENT_SECRET or GATEWAY_REDIRECT_URI not set, skipping');
    return;
  }
  const rows = (await pool.query(`SELECT * FROM sa_clients WHERE client_id = $1::text`, [clientId])).rows;
  if (!rows.length) {
    await pool.query(
      `INSERT INTO sa_clients (client_id, client_secret_hash, name, redirect_uris, post_logout_uris, grant_types, scopes, first_party, public_client, disabled, created_ms)
       VALUES ($1::text, $2::text, $3::text, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, 1, 0, 0, ${now})`,
      [
        clientId, await bcrypt.hash(secret, 10), 'Suite gateway',
        JSON.stringify([redirectUri]), JSON.stringify([]), JSON.stringify(GRANTS), JSON.stringify(SCOPES),
      ],
    );
    console.log(`gateway client ${clientId}: registered for ${redirectUri}`);
    return;
  }
  const c = rows[0];
  const changes = [];
  const sets = [];
  const params = [clientId];
  const set = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };

  if (!c.client_secret_hash || !(await bcrypt.compare(secret, c.client_secret_hash))) {
    set('client_secret_hash = ?::text', await bcrypt.hash(secret, 10));
    changes.push('secret');
  }
  const uris = Array.isArray(c.redirect_uris) ? c.redirect_uris : [];
  if (!uris.includes(redirectUri)) {
    set('redirect_uris = ?::jsonb', JSON.stringify([...uris, redirectUri]));
    changes.push('redirect URI');
  }
  const grants = Array.isArray(c.grant_types) ? c.grant_types : [];
  if (GRANTS.some((g) => !grants.includes(g))) {
    set('grant_types = ?::jsonb', JSON.stringify([...new Set([...grants, ...GRANTS])]));
    changes.push('grant types');
  }
  const scopes = Array.isArray(c.scopes) ? c.scopes : [];
  if (['openid', 'profile', 'email'].some((s) => !scopes.includes(s))) {
    set('scopes = ?::jsonb', JSON.stringify([...new Set([...scopes, ...SCOPES])]));
    changes.push('scopes');
  }
  // The gateway is part of the suite: no consent screen, never public, enabled.
  if (Number(c.first_party) !== 1) { sets.push('first_party = 1'); changes.push('first-party'); }
  if (Number(c.public_client) !== 0) { sets.push('public_client = 0'); changes.push('confidential'); }
  if (Number(c.disabled) !== 0) { sets.push('disabled = 0'); changes.push('enabled'); }

  if (!sets.length) {
    console.log(`gateway client ${clientId}: up to date`);
    return;
  }
  await pool.query(`UPDATE sa_clients SET ${sets.join(', ')} WHERE client_id = $1::text`, params);
  console.log(`gateway client ${clientId}: updated ${changes.join(', ')}`);
}

async function main() {
  if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set');
  await waitForAuth();
  await ensureAdmin();
  await ensureGatewayClient();
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
