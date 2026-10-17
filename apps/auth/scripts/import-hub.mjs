/*
 * Brings people and apps over from an older Synergy Hub (a separate SynergyAuth
 * install) into this one. Reads the hub's export (deploy/hub-import/auth.sql)
 * as JSON on stdin; deploy/hub-import/run.sh does both steps.
 *
 *   - People: added with their hub password hash (bcrypt, so their password keeps
 *     working), name, role and disabled state. Someone who already has an account
 *     here keeps it as it is, unless --overwrite-passwords.
 *   - Two-step sign-in: authenticator secrets are encrypted with the hub's own key,
 *     so they can't come across. Anyone who had it on is asked to set it up again.
 *   - Apps: hub apps the suite now covers are dropped (their suite tile replaces
 *     them, see COVERED). Every other hub app becomes a linked app with the same
 *     address, and the hub's per-person grants for those apps come along.
 *
 * Safe to run again: nothing already here is duplicated. --dry-run prints the plan only.
 */
import pg from 'pg';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const OVERWRITE = args.has('--overwrite-passwords');

/** Hub app slug -> the suite app that replaces it. */
const COVERED = {
  crm: 'crm', chat: 'chat', portal: 'portal', insights: 'insights', cal: 'calendar', sites: 'sites',
  boards: 'planner', clm: 'contracts', cadence: 'bookings', drive: 'drive',
  docs: 'office', sheets: 'office', slides: 'office', forms: 'forms', notes: 'notes', meet: 'meet',
  desk: 'desk', time: 'projects', stock: 'commerce', sign: 'sign', people: 'hr', synergytrust: 'trust',
  law: 'law', books: 'books', invoice: 'books', bills: 'books', billing: 'books', budget: 'books', expense: 'books',
};

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('No hub export on stdin. Run deploy/hub-import/run.sh.');
  return JSON.parse(text);
}

const num = (v) => Number(v ?? 0);

async function main() {
  const hub = await readStdin();
  const users = hub.users ?? [];
  const apps = hub.apps ?? [];
  const grants = hub.user_apps ?? [];

  // The auth app creates and seeds its tables on first use; make sure it has.
  const authUrl = (process.env.AUTH_SELF_URL || 'http://127.0.0.1:3500').replace(/\/$/, '');
  await fetch(`${authUrl}/api/oidc/jwks`).catch(() => {});

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = (text, params = []) => pool.query(text, params).then((r) => r.rows);
  const now = Date.now();
  const log = (s) => console.log((DRY ? '[dry run] ' : '') + s);

  const missing = await db(`SELECT to_regclass('sa_apps') AS t`);
  if (!missing[0].t) throw new Error('This Account app is too old for the Hub tables. Update the auth image first.');

  // People
  const hubUserEmail = new Map();
  let added = 0, updated = 0, kept = 0;
  for (const u of users) {
    const email = String(u.email).toLowerCase().trim();
    hubUserEmail.set(String(u.id), email);
    const mfa = num(u.mfa_enabled) || num(u.mfa_required) ? 1 : 0;
    const found = await db(`SELECT id FROM sa_users WHERE email = $1::text`, [email]);
    if (found.length && !OVERWRITE) { kept++; log(`kept existing account ${email}`); continue; }
    if (found.length) {
      if (!DRY) await db(
        `UPDATE sa_users SET password_hash = $2::text, name = COALESCE(name, $3::text), updated_ms = $4::bigint WHERE id = $1::bigint`,
        [found[0].id, u.password_hash, u.name, now]);
      updated++; log(`hub password set for ${email}`);
      continue;
    }
    if (!DRY) await db(
      `INSERT INTO sa_users (email, name, password_hash, role, disabled, mfa_enabled, mfa_required, failed_logins, locked_until_ms, created_ms, updated_ms)
       VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint, 0::bigint, $6::bigint, 0::bigint, 0::bigint, $7::bigint, $8::bigint)`,
      [email, u.name, u.password_hash, u.role === 'admin' ? 'admin' : 'user', num(u.disabled), mfa, num(u.created_ms) || now, now]);
    added++; log(`added ${email} (${u.role}${mfa ? ', must set up two-step sign-in again' : ''})`);
  }

  // Apps
  const hubAppSlug = new Map();
  let linked = 0, covered = 0, present = 0;
  for (const a of apps) {
    hubAppSlug.set(String(a.id), a.slug);
    if (COVERED[a.slug]) { covered++; log(`${a.name}: now ${COVERED[a.slug]} in the suite`); continue; }
    if (num(a.disabled) && !a.url) continue;
    const found = await db(`SELECT id FROM sa_apps WHERE slug = $1::text`, [a.slug]);
    if (found.length) { present++; continue; }
    if (!DRY) await db(
      `INSERT INTO sa_apps (slug, name, description, url, icon, color, category, sort, open_to_all, disabled, suite, created_ms)
       VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::bigint, $9::bigint, $10::bigint, 0::bigint, $11::bigint)`,
      [a.slug, a.name, a.description, a.url, a.icon, a.color, a.category, 500 + num(a.sort), num(a.open_to_all), num(a.disabled), now]);
    linked++; log(`linked ${a.name} -> ${a.url}${num(a.open_to_all) ? '' : ' (restricted)'}`);
  }

  // Grants for linked apps
  let granted = 0;
  for (const g of grants) {
    const email = hubUserEmail.get(String(g.user_id));
    const slug = hubAppSlug.get(String(g.app_id));
    if (!email || !slug || COVERED[slug]) continue;
    const [user] = await db(`SELECT id FROM sa_users WHERE email = $1::text`, [email]);
    const [app] = await db(`SELECT id FROM sa_apps WHERE slug = $1::text AND suite = 0::bigint`, [slug]);
    if (!user || !app) continue;
    const has = await db(`SELECT id FROM sa_user_apps WHERE user_id = $1::bigint AND app_id = $2::bigint`, [user.id, app.id]);
    if (has.length) continue;
    if (!DRY) await db(`INSERT INTO sa_user_apps (user_id, app_id, created_ms) VALUES ($1::bigint, $2::bigint, $3::bigint)`, [user.id, app.id, now]);
    granted++;
  }

  console.log(`\nPeople: ${added} added, ${updated} given their hub password, ${kept} already here and left as they were.`);
  console.log(`Apps: ${linked} linked, ${present} already linked, ${covered} replaced by suite apps. Grants: ${granted} added.`);
  if (DRY) console.log('Dry run: nothing was written.');
  await pool.end();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
