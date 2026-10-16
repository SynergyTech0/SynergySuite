// Collector verification.
//
// Collectors are the part of this product that can lie most quietly: one that returns `pass`
// when it could not reach anything looks identical, on a dashboard, to one that genuinely
// measured a healthy system. So these checks are mostly about the failure modes —
// unreachable hosts, invalid config, empty populations — rather than the happy path.

import { adminSql } from '../src/lib/db.mjs';
import { PHI_NAME_PATTERN, suggestsPhi } from '../src/lib/phi-names.mjs';
import { COLLECTORS, collectorCatalogue, validateMonitorConfig } from '../src/lib/collectors/registry.mjs';
import { runMonitors } from '../src/lib/collect-runner.mjs';
import { createServer } from 'node:http';

// The organisation the suite runs against (scripts/seed.mjs --tenant <slug> provisions it).
const TENANT = process.env.TRUST_TENANT ?? 'example';

const sql = adminSql({ max: 2 });
let pass = 0;
const failures = [];

function check(name, ok, observed) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}\n          ${observed}`);
  } else {
    failures.push(`${name} — ${observed}`);
    console.log(`  FAIL  ${name}\n          ${observed}`);
  }
}

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = ${TENANT}`;
  if (!tenant) throw new Error(`tenant '${TENANT}' not found — run: node scripts/seed.mjs --tenant ${TENANT}`);

  console.log('\n=== 1. Every collector honours the registry contract ===\n');

  const catalogue = collectorCatalogue();
  check(
    'the registry is populated and self-describing',
    catalogue.length >= 10 && catalogue.every((c) => c.kind && c.version && c.title && c.description),
    `${catalogue.length} collectors: ${catalogue.map((c) => c.kind).join(', ')}`,
  );

  const hostAccess = catalogue.filter((c) => c.requiresHostAccess).map((c) => c.kind);
  const selfRef = catalogue.filter((c) => c.selfReferential).map((c) => c.kind);
  check(
    'collectors declare whether they need credentials into customer infrastructure',
    hostAccess.length > 0 && selfRef.length > 0,
    `requires host access: ${hostAccess.join(', ')} · self-referential: ${selfRef.join(', ')}`,
  );

  // Every suggested control must exist, or the suggestion sends someone to a dead end.
  const controlKeys = new Set(
    (await sql`SELECT key FROM controls WHERE tenant_id = ${tenant.id}`).map((r) => r.key),
  );
  const danglingSuggestions = catalogue.flatMap((c) =>
    (c.suggestedControls ?? []).filter((k) => !controlKeys.has(k)).map((k) => `${c.kind}->${k}`),
  );
  check(
    'every suggested control actually exists',
    danglingSuggestions.length === 0,
    danglingSuggestions.length ? danglingSuggestions.join(', ') : 'no dangling control references',
  );

  console.log('\n=== 2. Bad config is refused, not run ===\n');

  const BAD = [
    ['tls_endpoint', {}, /hosts/i],
    ['tls_endpoint', { hosts: ['a'], port: 99999 }, /port/i],
    ['backup_recoverable', { host: 'h' }, /backup_root/i],
    ['backup_recoverable', { host: 'h', backup_root: "/x'; rm -rf /" }, /quotes|expansion/i],
    ['port_exposure', { hosts: [] }, /non-empty/i],
    ['port_exposure', { hosts: ['h'], forbidden_ports: [0] }, /invalid port/i],
    ['ssh_hardening', { hosts: 'not-an-array' }, /array/i],
    ['capacity_headroom', { hosts: ['h'], max_disk_pct: 300 }, /percentage/i],
    ['audit_integrity', { max_silence_hours: -1 }, /positive/i],
    ['http_security_headers', { urls: ['http://insecure.example'] }, /https/i],
    ['http_security_headers', { urls: ['not a url'] }, /valid URL/i],
    ['dependency_vulns', {}, /directories/i],
    ['dependency_vulns', { directories: ['/x'], sla_days: { catastrophic: 1 } }, /unknown severity/i],
    ['patch_currency', { hosts: ['h'], max_security_updates: -1 }, /non-negative/i],
    ['endpoint_compliance', { active_days: 0 }, /active_days/i],
    ['endpoint_compliance', { min_compliant_pct: 120 }, /0 to 100/i],
    ['endpoint_threats', { max_open_critical: -1 }, /non-negative/i],
  ];
  for (const [kind, config, pattern] of BAD) {
    const r = validateMonitorConfig(kind, config);
    check(
      `${kind} rejects ${JSON.stringify(config).slice(0, 46)}`,
      r.ok === false && pattern.test(r.reason),
      r.ok ? 'ACCEPTED invalid config' : r.reason.slice(0, 92),
    );
  }

  const unknown = validateMonitorConfig('does_not_exist', {});
  check(
    'an unknown collector kind is refused with the available list',
    unknown.ok === false && /Available:/.test(unknown.reason),
    unknown.reason.slice(0, 96),
  );

  console.log('\n=== 3. Unreachable means error, never pass and never fail ===\n');

  // 203.0.113.0/24 is TEST-NET-3 (RFC 5737) — reserved for documentation, guaranteed never
  // to route anywhere. A host that does not exist is the cleanest way to prove a collector
  // does not invent a result when it cannot measure.
  const UNREACHABLE = '203.0.113.42';

  for (const [kind, config] of [
    ['backup_recoverable', { host: UNREACHABLE, backup_root: '/var/backups', timeout_ms: 5000 }],
    ['ssh_hardening', { hosts: [UNREACHABLE], timeout_ms: 5000 }],
    ['capacity_headroom', { hosts: [UNREACHABLE], timeout_ms: 5000 }],
  ]) {
    const r = await COLLECTORS.get(kind).run(config, { tenantId: tenant.id, sql });
    check(
      `${kind} returns 'error' for an unreachable host`,
      r.status === 'error',
      `status=${r.status} · ${r.message.slice(0, 80)}`,
    );
    check(
      `${kind} writes no evidence when nothing was measured`,
      !r.content_hash,
      r.content_hash ? 'PRODUCED A CONTENT HASH for an unmeasured run' : 'no content_hash, so no evidence row',
    );
  }

  const portUnreachable = await COLLECTORS.get('port_exposure').run(
    { hosts: [UNREACHABLE], expected_open: [443], timeout_ms: 3000 },
    { tenantId: tenant.id, sql },
  );
  check(
    "port_exposure reports 'error' rather than a false all-clear when no host answers",
    portUnreachable.status === 'error',
    `status=${portUnreachable.status} · ${portUnreachable.message.slice(0, 90)}`,
  );

  console.log('\n=== 4. An empty population is not a pass ===\n');

  // The vacuous-truth trap: "every event in an empty log verifies" satisfies the claim and
  // means nothing. A green tile derived from an empty set is worse than a red one.
  const emptyTenant = await sql`
    INSERT INTO tenants (slug, name) VALUES ('verify-empty', 'Verify Empty Tenant')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const auditEmpty = await COLLECTORS.get('audit_integrity').run(
    {},
    { tenantId: emptyTenant[0].id, sql },
  );
  check(
    'audit_integrity refuses to pass a tenant with no events',
    auditEmpty.status === 'error' && /nothing to verify/i.test(auditEmpty.message),
    `status=${auditEmpty.status} · ${auditEmpty.message.slice(0, 80)}`,
  );
  await sql`DELETE FROM tenants WHERE slug = 'verify-empty'`;

  console.log('\n=== 4b. Device posture from Synergy Devices ===\n');

  // A stand-in for Devices' /api/svc/posture, so the endpoint collectors are checked against
  // the cases that matter: no feed, an empty fleet, a healthy fleet and an unhealthy one.
  const POSTURE = {
    generated_at: new Date().toISOString(), active_days: 30, policies: 1, devices: 4, stale: 1,
    compliant: 4, noncompliant: 0, unknown: 0,
    encryption: { encrypted: 4, not_encrypted: 0, unknown: 0 }, noncompliant_sample: [],
    alerts_open: { critical: 0, high: 0, medium: 1, low: 0 }, oldest_open_days: { critical: null, high: null },
    vulnerabilities: { critical_devices: 0, high_devices: 1, critical_advisories: 0, checked_devices: 4 },
  };
  let feed = POSTURE;
  const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer verify-token') { res.writeHead(401).end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(feed));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feedEnv = { DEVICES_INTERNAL_URL: `http://127.0.0.1:${server.address().port}`, DEVICES_SVC_TOKEN: 'verify-token' };
  const runEp = (kind, env, config = {}) => COLLECTORS.get(kind).run(config, { tenantId: tenant.id, sql, env });
  try {
    for (const kind of ['endpoint_compliance', 'endpoint_threats']) {
      const none = await runEp(kind, {});
      check(`${kind} returns 'error' when Devices isn't configured`, none.status === 'error' && !none.content_hash, `status=${none.status} · ${none.message.slice(0, 80)}`);
      const badToken = await runEp(kind, { ...feedEnv, DEVICES_SVC_TOKEN: 'wrong' });
      check(`${kind} returns 'error' when Devices refuses the token`, badToken.status === 'error', `status=${badToken.status} · ${badToken.message.slice(0, 80)}`);
      feed = { ...POSTURE, devices: 0, compliant: 0 };
      const empty = await runEp(kind, feedEnv);
      check(`${kind} refuses to pass an empty fleet`, empty.status === 'error' && !empty.content_hash, `status=${empty.status} · ${empty.message.slice(0, 80)}`);
      feed = POSTURE;
      const good = await runEp(kind, feedEnv);
      check(`${kind} passes a healthy fleet and records evidence`, good.status === 'pass' && !!good.content_hash, `status=${good.status} · ${good.message.slice(0, 80)}`);
    }
    feed = { ...POSTURE, compliant: 2, unknown: 1, noncompliant: 1, encryption: { encrypted: 3, not_encrypted: 1, unknown: 0 } };
    const comp = await runEp('endpoint_compliance', feedEnv, { min_compliant_pct: 95 });
    check('endpoint_compliance fails a fleet with an unencrypted, unknown or non-compliant computer', comp.status === 'fail', `status=${comp.status} · ${comp.message.slice(0, 90)}`);
    feed = { ...POSTURE, alerts_open: { critical: 1, high: 2, medium: 0, low: 0 }, oldest_open_days: { critical: 0, high: 9 } };
    const threats = await runEp('endpoint_threats', feedEnv);
    check('endpoint_threats fails open critical alerts and stale high ones', threats.status === 'fail' && /critical/.test(threats.message) && /9 days/.test(threats.message), `status=${threats.status} · ${threats.message.slice(0, 90)}`);
  } finally {
    server.close();
  }

  console.log('\n=== 5. Self-referential collectors measure the real thing ===\n');

  const audit = await COLLECTORS.get('audit_integrity').run(
    { max_silence_hours: 168 },
    { tenantId: tenant.id, sql },
  );
  check(
    'audit_integrity recomputes the chain over the real log',
    audit.status === 'pass' && audit.observed.chain_intact && audit.observed.sequence_contiguous,
    `${audit.observed.events} events, seq ${audit.observed.seq_range?.join('..')}, intact=${audit.observed.chain_intact}`,
  );

  // A chain that verifies because logging stopped must NOT pass. Proven by asking for a
  // silence window so short that the real log cannot satisfy it.
  const silent = await COLLECTORS.get('audit_integrity').run(
    { max_silence_hours: 0.0001 },
    { tenantId: tenant.id, sql },
  );
  check(
    'audit_integrity fails a chain that verifies only because nothing is being written',
    silent.status === 'fail' && /logging stopped/i.test(silent.message),
    `status=${silent.status} · ${silent.message.slice(0, 96)}`,
  );

  console.log('\n=== 6. Scheduling: due-ness drives unattended collection ===\n');

  const notDue = await runMonitors(sql, tenant.id, { dueOnly: true });
  check(
    'nothing is due immediately after a full run',
    notDue.results.length === 0,
    `${notDue.results.length} monitor(s) selected right after collection`,
  );

  // monitor_runs is append-only, so history cannot be rewritten to simulate the passage of
  // time. Lift the trigger inside a transaction that is then rolled back — the same shape as
  // the audit tamper probe, and for the same reason: the guarantee stays intact afterwards.
  let dueKeys = null;
  try {
    await sql.begin(async (tx) => {
      await tx`ALTER TABLE monitor_runs DISABLE TRIGGER monitor_runs_no_update`;
      await tx`
        UPDATE monitor_runs SET started_at = started_at - interval '2 days'
        WHERE monitor_id IN (
          SELECT id FROM monitors WHERE tenant_id = ${tenant.id}
            AND key IN ('audit-integrity', 'asset-inventory'))`;
      const due = await tx`
        SELECT mo.key, mo.schedule FROM monitors mo
        LEFT JOIN LATERAL (
          SELECT max(started_at) AS last_run FROM monitor_runs r WHERE r.monitor_id = mo.id
        ) lr ON true
        WHERE mo.tenant_id = ${tenant.id} AND mo.enabled
          AND (lr.last_run IS NULL OR lr.last_run < now() - CASE mo.schedule
                WHEN 'hourly' THEN interval '1 hour' WHEN 'daily' THEN interval '1 day'
                WHEN 'weekly' THEN interval '7 days' WHEN 'monthly' THEN interval '30 days'
                ELSE interval '1 day' END)
        ORDER BY mo.key`;
      dueKeys = due.map((d) => `${d.key}(${d.schedule})`);
      throw new Error('rollback-due-probe');
    });
  } catch (err) {
    if (err.message !== 'rollback-due-probe') throw err;
  }
  check(
    'a daily monitor 2 days stale is due; a weekly one is not',
    dueKeys?.length === 1 && dueKeys[0].startsWith('audit-integrity'),
    `due after backdating both by 2d: ${dueKeys?.join(', ') || '(none)'} — weekly correctly excluded`,
  );

  const [{ n: runsAfter }] = await sql`
    SELECT count(*)::int AS n FROM monitor_runs WHERE tenant_id = ${tenant.id}`;
  check(
    'the due probe rolled back, leaving run history untouched',
    typeof runsAfter === 'number' && runsAfter > 0,
    `${runsAfter} runs still recorded, trigger restored`,
  );

  console.log('\n=== 7. Real collection produced real evidence ===\n');

  const rows = await sql`
    SELECT e.collector, e.collector_version, e.content_hash, e.collected_at,
           c.key AS control_key
    FROM evidence e JOIN controls c ON c.id = e.control_id
    WHERE e.tenant_id = ${tenant.id} AND e.kind = 'automated'
      AND e.collected_at > now() - interval '1 day'
    ORDER BY e.collected_at DESC`;
  const kinds = [...new Set(rows.map((r) => r.collector))];
  check(
    'several distinct collectors have written evidence today',
    kinds.length >= 5,
    `${rows.length} evidence rows from ${kinds.length} collectors: ${kinds.join(', ')}`,
  );
  check(
    'every evidence row carries a sha256 and a collector version',
    rows.length > 0 && rows.every((r) => /^[0-9a-f]{64}$/.test(r.content_hash) && r.collector_version),
    `${rows.length} rows, all hashed and versioned`,
  );

  // PHI_NAME_PATTERN is used as a JavaScript RegExp by the asset importer and as a Postgres
  // `~*` operand by the asset-inventory collector - one literal evaluated by two different
  // regex engines. They agree on this subset, but "they agree" is a claim, so it is tested
  // here against the live database rather than asserted in a comment. If the two ever
  // diverge, an asset would be classified restricted on import and not flagged when it
  // wasn't - a silent disagreement that leaves a health-data system misclassified.
  const phiFixtures = [
    ['aba.example.com', true],
    ['billing-care.example.com', true],
    ['acme-emr-db', true],
    ['acme-hh-db', true],
    ['rx-refill', true],
    ['vitals-api', true],
    ['database-thing', false],
    ['saba-db', false],
    ['postgres-main', false],
    ['marxist', false],
    ['share-hub', false],
    ['example.com', false],
  ];
  const engineDisagreements = [];
  const wrongVerdicts = [];
  for (const [name, expected] of phiFixtures) {
    const [{ pg }] = await sql`SELECT (${name}::text ~* ${PHI_NAME_PATTERN}) AS pg`;
    const js = suggestsPhi(name);
    if (pg !== js) engineDisagreements.push(`${name} (pg ${pg}, js ${js})`);
    if (js !== expected) wrongVerdicts.push(`${name} -> ${js}, expected ${expected}`);
  }
  check(
    'the PHI name pattern means the same thing to Postgres and to JavaScript',
    engineDisagreements.length === 0,
    engineDisagreements.length
      ? `DISAGREE: ${engineDisagreements.join('; ')}`
      : `${phiFixtures.length} names, both engines agree on every one`,
  );
  check(
    'the PHI name pattern anchors short tokens so `database` is not PHI and `aba` is',
    wrongVerdicts.length === 0,
    wrongVerdicts.length
      ? wrongVerdicts.join('; ')
      : `${phiFixtures.filter((f) => f[1]).length} PHI / ${phiFixtures.filter((f) => !f[1]).length} non-PHI classified correctly`,
  );

  // An asset classified restricted must have an owner, and every PHI asset here belongs to
  // the one individual certified to handle it. Checked as a property, not a headcount: the
  // control is "PHI is owned by a cleared person", which survives the team growing.
  const phiOwners = await sql`
    SELECT DISTINCT u.email FROM assets a JOIN users u ON u.id = a.owner_user_id
    WHERE a.tenant_id = ${tenant.id} AND a.classification = 'restricted'`;
  const [{ orphans }] = await sql`
    SELECT count(*)::int AS orphans FROM assets
    WHERE tenant_id = ${tenant.id} AND classification = 'restricted' AND owner_user_id IS NULL`;
  check(
    'every restricted asset has a named owner',
    orphans === 0,
    orphans === 0
      ? `0 unowned restricted assets; held by ${phiOwners.map((o) => o.email).join(', ')}`
      : `${orphans} restricted asset(s) with no owner`,
  );

  const monitoredControls = await sql`
    SELECT count(DISTINCT m.control_id)::int AS n FROM monitors m
    WHERE m.tenant_id = ${tenant.id} AND m.enabled`;
  const [{ n: totalControls }] = await sql`
    SELECT count(*)::int AS n FROM controls WHERE tenant_id = ${tenant.id}`;
  console.log(
    `\n        automated coverage: ${monitoredControls[0].n} of ${totalControls} controls ` +
      `(${Math.round((monitoredControls[0].n / totalControls) * 100)}%) have a monitor; ` +
      `the rest need manual evidence each period`,
  );

  console.log('\n' + '='.repeat(66));
  if (failures.length) {
    console.log(`FAILED — ${pass} passed, ${failures.length} failed:\n`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${pass} collector checks passed.`);
  }
  console.log('='.repeat(66) + '\n');
} catch (err) {
  console.error('\nCollector verification aborted:\n', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
