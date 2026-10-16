/* Seed: admin user + a first-party demo client. Idempotent. */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb',
  max: 2,
});

const now = Date.now();

async function main() {
  // The app creates the sa_* schema lazily on first DB touch — hit JWKS to trigger it.
  const base = process.env.ISSUER_URL ?? 'http://localhost:3500';
  await fetch(`${base}/api/oidc/jwks`).catch(() => {
    console.log('note: server not reachable at ' + base + ' — assuming schema already exists');
  });

  // The first admin's sign-in email. Set SEED_ADMIN_EMAIL, or it defaults to admin@<SUITE_DOMAIN>.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || `admin@${process.env.SUITE_DOMAIN || 'example.com'}`).toLowerCase();
  const admins = await pool.query(`SELECT id FROM sa_users WHERE email = $1::text`, [adminEmail]);
  if (admins.rows.length === 0) {
    const password = 'SynergyAuth-' + randomBytes(6).toString('hex');
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO sa_users (email, name, password_hash, role, created_ms, updated_ms)
       VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint, $5::bigint)`,
      [adminEmail, process.env.SEED_ADMIN_NAME || 'Administrator', hash, 'admin', now],
    );
    console.log('Admin created:  ' + adminEmail);
    console.log('Password:       ' + password);
    console.log('(change it after first login)');
  } else {
    console.log('Admin already exists, skipping.');
  }

  const demo = await pool.query(`SELECT id FROM sa_clients WHERE name = $1::text`, ['Demo Portal']);
  if (demo.rows.length === 0) {
    const clientId = 'sa_' + randomBytes(12).toString('hex');
    const secret = randomBytes(32).toString('hex');
    const secretHash = await bcrypt.hash(secret, 10);
    await pool.query(
      `INSERT INTO sa_clients (client_id, client_secret_hash, name, redirect_uris, post_logout_uris, grant_types, scopes, first_party, public_client, created_ms)
       VALUES ($1::text, $2::text, $3::text, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, 1::bigint, 0::bigint, $8::bigint)`,
      [
        clientId, secretHash, 'Demo Portal',
        JSON.stringify(['http://localhost:4000/callback']),
        JSON.stringify(['http://localhost:4000/']),
        JSON.stringify(['authorization_code', 'refresh_token', 'client_credentials']),
        JSON.stringify(['openid', 'profile', 'email', 'offline_access']),
        now,
      ],
    );
    console.log('Demo client:    ' + clientId);
    console.log('Demo secret:    ' + secret);
  } else {
    console.log('Demo client already exists, skipping.');
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
