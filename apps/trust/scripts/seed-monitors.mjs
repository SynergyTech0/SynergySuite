// Binds monitors to tenant controls. Separate from seed.mjs because monitor config is
// tenant-specific infrastructure, not shipped catalog content.
//
// Config is validated against each collector before anything is written, so a typo here is
// a loud failure now rather than a monitor that records `error` every night until somebody
// reads the run history.

import { adminSql } from '../src/lib/db.mjs';
import { validateMonitorConfig, COLLECTORS } from '../src/lib/collectors/registry.mjs';

const sql = adminSql({ max: 1 });

// What to monitor comes from the environment; nothing points at a real host by default.
//
//   TRUST_MONITOR_PUBLIC       public hostnames for TLS and security-header checks
//                              e.g. example.com,www.example.com
//   TRUST_MONITOR_HOSTS        hosts whose open ports are probed over plain TCP
//   TRUST_MONITOR_SSH_HOSTS    hosts this machine can reach over SSH (or `localhost`, which
//                              runs the checks locally with no SSH at all)
//   TRUST_MONITOR_BACKUP_HOST  host holding the nightly backup set (SSH or localhost)
//   TRUST_MONITOR_BACKUP_ROOT  directory of dated backup folders on it (default /var/backups)
//
// Each is a comma-separated list. A monitor whose inputs are not set is skipped and the
// summary says so, rather than seeding a monitor that records `error` every night — a
// monitor that is permanently red is a monitor everyone learns to scroll past.
//
// Hosts that cannot be reached inbound at all are the case for the collector agent: a
// process running ON each host reports its own posture outward and needs no inbound SSH.
// See the note at the top of collectors/ssh.mjs.
//
//   node scripts/seed-monitors.mjs <tenant-slug>

const list = (name) =>
  (process.env[name] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const PUBLIC_HOSTS = list('TRUST_MONITOR_PUBLIC');
const PROBE_HOSTS = list('TRUST_MONITOR_HOSTS');
const SSH_HOSTS = list('TRUST_MONITOR_SSH_HOSTS');
const BACKUP_HOST = process.env.TRUST_MONITOR_BACKUP_HOST?.trim() || '';
const BACKUP_ROOT = process.env.TRUST_MONITOR_BACKUP_ROOT?.trim() || '/var/backups';

const slug = process.argv[2] ?? process.env.TRUST_TENANT;
if (!slug) {
  console.error('Name the organisation: node scripts/seed-monitors.mjs <tenant-slug>');
  process.exit(2);
}

const MONITORS = [
  {
    key: 'tls-public-estate',
    needs: PUBLIC_HOSTS.length,
    control: 'CRY-TLS-TRANSIT',
    title: 'TLS enforcement across public endpoints',
    kind: 'tls_endpoint',
    schedule: 'daily',
    severity: 'high',
    config: { hosts: PUBLIC_HOSTS, port: 443, min_days_remaining: 21 },
  },
  {
    key: 'backups',
    needs: BACKUP_HOST,
    control: 'OPS-BACKUP-RESTORE',
    title: 'Nightly backups cover every live database',
    kind: 'backup_recoverable',
    schedule: 'daily',
    severity: 'critical',
    config: { host: BACKUP_HOST, backup_root: BACKUP_ROOT, max_age_hours: 36, integrity_sample: 3 },
  },
  {
    key: 'port-exposure-fleet',
    needs: PROBE_HOSTS.length,
    control: 'NET-BOUNDARY',
    title: 'No database or management port answers from outside',
    kind: 'port_exposure',
    schedule: 'daily',
    severity: 'critical',
    config: {
      hosts: PROBE_HOSTS,
      expected_open: [443],
      vantage_label: 'the machine running the collector (not an internet vantage point)',
    },
  },
  {
    key: 'ssh-hardening-fleet',
    needs: SSH_HOSTS.length,
    control: 'EP-ENDPOINT-HARDENING',
    title: 'SSH daemons refuse password authentication',
    kind: 'ssh_hardening',
    schedule: 'weekly',
    severity: 'high',
    config: { hosts: SSH_HOSTS },
  },
  {
    key: 'capacity-fleet',
    needs: SSH_HOSTS.length,
    control: 'OPS-MONITORING',
    title: 'Hosts have disk and memory headroom',
    kind: 'capacity_headroom',
    schedule: 'daily',
    severity: 'medium',
    config: { hosts: SSH_HOSTS, max_disk_pct: 85, min_mem_available_pct: 10 },
  },
  {
    key: 'http-headers-public',
    needs: PUBLIC_HOSTS.length,
    control: 'CM-SDLC',
    title: 'Public sites send the browser security headers',
    kind: 'http_security_headers',
    schedule: 'daily',
    severity: 'medium',
    config: { urls: PUBLIC_HOSTS.map((h) => `https://${h}`) },
  },
  {
    key: 'dependency-vulns',
    control: 'OPS-VULN-MGMT',
    title: 'Dependency vulnerabilities remediated within SLA',
    kind: 'dependency_vulns',
    schedule: 'daily',
    severity: 'high',
    // Audits this app's own dependencies. Point it at your deployed apps' directories by
    // editing the monitor once the collector runs where they are checked out.
    config: { directories: [process.cwd()], sla_days: { critical: 7, high: 30, moderate: 90 } },
  },
  {
    key: 'patch-currency',
    needs: SSH_HOSTS.length,
    control: 'OPS-VULN-MGMT',
    title: 'Hosts have no pending security updates',
    kind: 'patch_currency',
    schedule: 'daily',
    severity: 'high',
    config: { hosts: SSH_HOSTS, max_security_updates: 0 },
  },
  {
    key: 'asset-inventory',
    control: 'DP-ASSET-INVENTORY',
    title: 'Asset inventory is complete, owned and current',
    kind: 'asset_inventory',
    schedule: 'weekly',
    severity: 'high',
    config: { max_age_days: 90, min_assets: 10 },
  },
  {
    key: 'restore-drill',
    needs: BACKUP_HOST,
    control: 'OPS-BACKUP-RESTORE',
    title: 'Backups are restore-tested on a rotation and the restores succeed',
    kind: 'restore_drill',
    schedule: 'daily',
    severity: 'critical',
    // Two monitors on one control, deliberately: backup_recoverable proves a fresh,
    // intact dump exists, restore_drill proves it comes back. A dump can pass the first
    // and still restore with errors.
    config: {
      host: BACKUP_HOST,
      summary_path: '/var/lib/restore-drill/latest.json',
      backup_root: BACKUP_ROOT,
      max_age_hours: 48,
      // A rotation under a nightly size budget takes a few weeks to cover every dump.
      // 35 days gives the cycle room to complete without the monitor crying wolf, and is
      // still well inside an annual restore-test expectation.
      max_coverage_days: 35,
    },
  },
  {
    key: 'audit-integrity',
    control: 'OPS-AUDIT-LOGGING',
    title: 'Audit log verifies and is still being written',
    kind: 'audit_integrity',
    schedule: 'daily',
    severity: 'critical',
    config: { max_silence_hours: 168 },
  },
];

const notConfigured = MONITORS.filter((m) => 'needs' in m && !m.needs).map((m) => m.key);
const SEEDED = MONITORS.filter((m) => !('needs' in m) || m.needs);

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = ${slug}`;
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);

  // Validate everything before writing anything: a half-applied set would leave some
  // controls looking monitored and others not, with no indication which.
  const problems = [];
  for (const m of SEEDED) {
    if (!COLLECTORS.has(m.kind)) {
      problems.push(`${m.key}: no collector for kind '${m.kind}'`);
      continue;
    }
    const v = validateMonitorConfig(m.kind, m.config);
    if (!v.ok) problems.push(`${m.key}: ${v.reason}`);
  }
  if (problems.length) {
    throw new Error(`monitor config is not valid:\n    ${problems.join('\n    ')}`);
  }

  let bound = 0;
  const skipped = [];
  for (const m of SEEDED) {
    const [control] = await sql`
      SELECT id FROM controls WHERE tenant_id = ${tenant.id} AND key = ${m.control}`;
    if (!control) {
      skipped.push(`${m.key} (no control ${m.control})`);
      continue;
    }
    await sql`
      INSERT INTO monitors (tenant_id, control_id, key, title, kind, config, schedule, severity)
      VALUES (${tenant.id}, ${control.id}, ${m.key}, ${m.title}, ${m.kind},
              ${sql.json(m.config)}, ${m.schedule}, ${m.severity})
      ON CONFLICT (tenant_id, key) DO UPDATE
        SET control_id = EXCLUDED.control_id, title = EXCLUDED.title, kind = EXCLUDED.kind,
            schedule = EXCLUDED.schedule, severity = EXCLUDED.severity`;
    // NOTE: `config` is deliberately NOT updated on conflict. It is operator-owned - hosts,
    // URLs and thresholds get tuned for a specific estate - and a re-seed silently reverting
    // that is how a monitor ends up pointed at the wrong thing while still looking healthy.
    // Exactly the rule the asset importer applies to classification.
    console.log(`  ${m.key.padEnd(22)} ${m.kind.padEnd(20)} ${m.schedule.padEnd(8)} -> ${m.control}`);
    bound++;
  }

  console.log(`\n${bound} monitor(s) bound.`);
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
  if (notConfigured.length) {
    console.log(`Not configured (set the TRUST_MONITOR_* variables): ${notConfigured.join(', ')}`);
  }

  const unmonitored = await sql`
    SELECT c.key, c.title FROM controls c
    WHERE c.tenant_id = ${tenant.id}
      AND NOT EXISTS (SELECT 1 FROM monitors m WHERE m.control_id = c.id AND m.enabled)
    ORDER BY c.key`;
  // Counted over DISTINCT controls, not monitors: two monitors can evidence one control
  // (patch_currency and dependency_vulns both support OPS-VULN-MGMT), so adding the monitor
  // count to the unmonitored count overstates the denominator.
  const [{ total }] = await sql`
    SELECT count(*)::int AS total FROM controls WHERE tenant_id = ${tenant.id}`;
  const covered = total - unmonitored.length;
  console.log(
    `\nAutomated coverage: ${covered} of ${total} controls ` +
      `(${Math.round((covered / total) * 100)}%). The other ${unmonitored.length} must be ` +
      `evidenced by hand each period.`,
  );
} catch (err) {
  console.error('\nFailed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
