// CLI wrapper around the shared collection runner.
//
//   node scripts/collect.mjs [tenant-slug] [monitor-key]
//   node scripts/collect.mjs --due [tenant-slug]     <- what a scheduler should run
//
// Without a tenant slug it runs for every active organisation.
//
// `--due` runs only the monitors whose cadence has elapsed since their last run. That is
// what turns this from a button into continuous monitoring: a SOC 2 Type II opinion covers
// a window, and the run series has to fill itself without anyone remembering to click.
//
// `node` does not read .env files, so give it DATABASE_URL explicitly. In the suite's
// Docker deployment, run it inside the trust container, e.g. hourly from the host's cron:
//   docker compose -f deploy/compose.yml exec -T trust node scripts/collect.mjs --due

import { adminSql } from '../src/lib/db.mjs';
import { runMonitors } from '../src/lib/collect-runner.mjs';

const args = process.argv.slice(2);
const dueOnly = args.includes('--due');
const positional = args.filter((a) => !a.startsWith('--'));
const slug = positional[0];
const monitorKey = positional[1];

const sql = adminSql({ max: 2 });

try {
  const tenants = slug
    ? await sql`SELECT id, name FROM tenants WHERE slug = ${slug}`
    : await sql`SELECT id, name FROM tenants WHERE status = 'active' ORDER BY name`;
  if (slug && !tenants.length) throw new Error(`no tenant with slug '${slug}'`);

  let errors = 0;
  for (const tenant of tenants) {
    const scope = monitorKey ? `monitor ${monitorKey}` : dueOnly ? 'monitors now due' : 'all enabled monitors';
    console.log(`\n${new Date().toISOString()}  ${tenant.name} — ${scope}\n`);

    const { results, pass, fail, error } = await runMonitors(sql, tenant.id, { monitorKey, dueOnly });

    if (!results.length) {
      console.log(
        dueOnly
          ? '  Nothing due. (This is the normal result for most runs.)'
          : '  No enabled monitors matched. Run scripts/seed-monitors.mjs first.',
      );
    }
    for (const r of results) {
      const tag = { pass: 'PASS ', fail: 'FAIL ', error: 'ERROR', skipped: 'SKIP ' }[r.status];
      console.log(`  ${tag} ${r.key.padEnd(22)} ${r.message}`);
    }
    if (results.length) console.log(`\n  ${pass} pass, ${fail} fail, ${error} error\n`);
    errors += error;
  }

  // A failing control is a true result and must not fail the process — a scheduler would
  // alert about it every night and the signal would be lost. An error means the measurement
  // did not happen, which is an operational problem worth a non-zero exit.
  if (errors) process.exitCode = 1;
} catch (err) {
  console.error('\nCollection failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
