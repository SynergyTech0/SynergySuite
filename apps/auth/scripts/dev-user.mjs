/*
 * Local dev login helper — list the users in the dev database, or set a
 * password on one so you can sign in at http://localhost:3500/hub.
 *
 *   node scripts/dev-user.mjs                      list accounts
 *   node scripts/dev-user.mjs <email> <password>   set that account's password
 *   node scripts/dev-user.mjs <email> <password> --create   create it if absent
 *
 * WHY THIS EXISTS: scripts/seed.mjs generates a random password and PRINTS it.
 * That is fine for a first run on a box, but it puts a credential into whatever
 * captured the output. This takes the password as an argument instead, so you
 * choose it and it never has to be echoed back.
 *
 * DEV ONLY. It refuses to run against anything but a local database.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Read .env.local ourselves rather than sourcing it into a shell — the estate
   has an outage on record from `source .env.local` picking up the wrong file. */
function envFromFile(rel) {
  try {
    const out = {};
    for (const line of readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

const env = { ...envFromFile('.env.local'), ...process.env };
const url = env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb';

const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to run: ${host} is not a local database. This is a dev helper.`);
  process.exit(1);
}

const [email, password, ...flags] = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: url, max: 2 });

try {
  if (!email) {
    const { rows } = await pool.query(
      `SELECT email, name, role FROM sa_users ORDER BY created_ms ASC LIMIT 25`,
    );
    if (!rows.length) {
      console.log('No users in the dev database yet.');
      console.log('Create one:  node scripts/dev-user.mjs you@example.com <password> --create');
    } else {
      console.log(`${rows.length} account(s):\n`);
      for (const r of rows) console.log(`  ${r.email}  (${r.role})  ${r.name ?? ''}`);
      console.log('\nSet a password:  node scripts/dev-user.mjs <email> <password>');
    }
  } else if (!password) {
    console.error('Usage: node scripts/dev-user.mjs <email> <password> [--create]');
    process.exit(1);
  } else {
    const hash = await bcrypt.hash(password, 12);
    const now = Date.now();
    const { rowCount } = await pool.query(
      `UPDATE sa_users SET password_hash = $2::text, updated_ms = $3::bigint WHERE email = $1::text`,
      [email, hash, now],
    );
    if (rowCount) {
      console.log(`Password set for ${email}. Sign in at http://localhost:3500/hub`);
    } else if (flags.includes('--create')) {
      await pool.query(
        `INSERT INTO sa_users (email, name, password_hash, role, created_ms, updated_ms)
         VALUES ($1::text, $2::text, $3::text, 'admin', $4::bigint, $4::bigint)`,
        [email, email.split('@')[0], hash, now],
      );
      console.log(`Created ${email} as admin. Sign in at http://localhost:3500/hub`);
    } else {
      console.error(`No account ${email}. Add --create to make one.`);
      process.exit(1);
    }
  }
} finally {
  await pool.end();
}
