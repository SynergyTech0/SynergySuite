// API verification against a running server.
//
// Asserts on payload values. A 200 proves the socket is open and nothing else, so every
// check here reads a specific number or string out of the response body. The suite is
// re-runnable: control statuses it changes are measured as deltas and reverted at the end.
//
//   npm run build && npm start      (in one shell; production mode, no DEV_USER_EMAIL)
//   npm run verify:api              (in another)
//
// Requests carry the identity headers the suite gateway would set. If the server has
// PROXY_SHARED_SECRET, give this script the same value so it can present it.

import { adminSql } from '../src/lib/db.mjs';
import { newToken, hashToken } from '../src/lib/crypto.mjs';
import { runMonitors } from '../src/lib/collect-runner.mjs';

// The organisation the suite runs against (scripts/seed.mjs --tenant <slug> provisions it).
const TENANT = process.env.TRUST_TENANT ?? 'example';

const SECTION9 = '\n=== 9. Collector agents ===\n';

const BASE = process.env.TRUST_BASE ?? 'http://127.0.0.1:3670';
const sql = adminSql({ max: 1 });

// A contributor seat: it can write but not administer, which is the surface this suite
// exercises. Access rules themselves are covered by verify-access.ts.
const USER = 'verify-api@example.com';
const IDENTITY = {
  'x-auth-request-email': USER,
  ...(process.env.PROXY_SHARED_SECRET ? { 'x-proxy-auth-secret': process.env.PROXY_SHARED_SECRET } : {}),
};
// Set once the fixture statuses are captured; invoked from finally so an abort restores.
let restoreFixtures = async () => {};

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

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      // Same-origin is enforced on every mutation, so Origin is not optional.
      origin: BASE,
      ...IDENTITY,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

try {
  // Fail fast with a useful message rather than 20 confusing connection errors.
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(
      `\nCannot reach ${BASE}. Start the server first:\n` +
        `  npm run build && npm start\n`,
    );
    process.exit(1);
  }

  // --- sign in ---------------------------------------------------------------
  // The fixture joins the way a real person does: an administrator adds their email, and
  // the membership appears on their first request through the gateway.
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = ${TENANT}`;
  if (!tenant) throw new Error(`tenant '${TENANT}' not found — run: node scripts/seed.mjs --tenant ${TENANT}`);
  await sql`UPDATE users SET status = 'active' WHERE email = ${USER}`;
  await sql`
    UPDATE invitations SET revoked_at = now()
    WHERE email = ${USER} AND accepted_at IS NULL AND revoked_at IS NULL`;
  await sql`
    INSERT INTO invitations (tenant_id, email, role)
    VALUES (${tenant.id}, ${USER}, 'contributor')`;
  const me = await api('/api/me');
  if (me.status !== 200 || me.body.tenant?.role !== 'contributor') {
    console.error('\nCould not sign in the fixture account:', me.status, me.body);
    process.exit(1);
  }
  console.log(`  signed in as ${USER} (contributor)`);

  console.log('\n=== 1. Readiness reflects adopted frameworks and selected scope ===\n');

  const readiness = await api('/api/readiness');
  const soc2 = readiness.body.frameworks?.find((f) => f.framework_key === 'soc2');
  check(
    'GET /api/readiness returns only adopted frameworks',
    readiness.status === 200 &&
      readiness.body.frameworks?.length === 1 &&
      !!soc2,
    `${readiness.status} · ${readiness.body.frameworks?.length} framework(s): ` +
      `${readiness.body.frameworks?.map((f) => f.framework_key).join(', ')}`,
  );

  // Scope is Common Criteria only. If the optional categories leaked in, this would be 61
  // and every percentage on the dashboard would be measuring something nobody signed up for.
  check(
    'SOC 2 scope is Common Criteria only (33, not all 61)',
    soc2?.total === 33,
    `in-scope total = ${soc2?.total} (expected 33: CC1..CC9)`,
  );

  const reqs = await api('/api/frameworks/soc2/requirements');
  check(
    'GET /api/frameworks/soc2/requirements agrees with the summary',
    reqs.status === 200 && reqs.body.count === soc2?.total,
    `requirements endpoint count = ${reqs.body.count}, summary total = ${soc2?.total}`,
  );

  const unadopted = await api('/api/frameworks/gdpr/requirements');
  check(
    'an unadopted framework 404s rather than returning an empty list',
    unadopted.status === 404,
    `${unadopted.status} · ${unadopted.body.error ?? ''}`.slice(0, 150),
  );

  console.log('\n=== 2. Controls and cross-framework mappings ===\n');

  // Expected count comes from the catalog rather than a literal, so adding a control
  // template cannot leave this suite asserting a stale number.
  const { readFile } = await import('node:fs/promises');
  const libraryUrl = new URL('../db/catalog/controls.json', import.meta.url);
  const expectedControls = JSON.parse(await readFile(libraryUrl, 'utf8')).templates.length;

  const ctls = await api('/api/controls');
  check(
    'GET /api/controls returns the whole seeded library',
    ctls.status === 200 && ctls.body.count === expectedControls,
    `${ctls.status} · ${ctls.body.count} controls (catalog declares ${expectedControls})`,
  );

  const mfa = await api('/api/controls/AC-MFA');
  const mfaFrameworks = [...new Set((mfa.body.mappings ?? []).map((m) => m.framework_key))].sort();
  check(
    'one control maps across all four frameworks',
    mfa.status === 200 && mfaFrameworks.length === 4,
    `AC-MFA → ${mfaFrameworks.join(', ')} (${mfa.body.mappings?.length} requirements)`,
  );

  const missing = await api('/api/controls/NOPE-404');
  check(
    'unknown control key 404s',
    missing.status === 404,
    `${missing.status} · ${missing.body.error ?? ''}`.slice(0, 120),
  );

  console.log('\n=== 3. Validation refuses what the schema would refuse ===\n');

  const badNa = await api('/api/controls/AC-MFA', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'not_applicable' }),
  });
  check(
    'not_applicable without a rationale is a 400, not a 500',
    badNa.status === 400 && /rationale/i.test(badNa.body.error ?? ''),
    `${badNa.status} · ${(badNa.body.error ?? '').slice(0, 110)}`,
  );

  const badStatus = await api('/api/controls/AC-MFA', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'totally_done' }),
  });
  check(
    'an invalid status is rejected',
    badStatus.status === 400,
    `${badStatus.status} · ${(badStatus.body.error ?? '').slice(0, 110)}`,
  );

  const badField = await api('/api/controls/AC-MFA', {
    method: 'PATCH',
    body: JSON.stringify({ implemented: true }),
  });
  check(
    'an unknown field is rejected rather than silently ignored',
    badField.status === 400 && /unsupported/i.test(badField.body.error ?? ''),
    `${badField.status} · ${(badField.body.error ?? '').slice(0, 110)}`,
  );

  console.log('\n=== 4. Partial coverage does not count as implemented ===\n');

  // Capture what these controls are set to now, so the suite can put them back exactly.
  const FIXTURES = ['AC-MFA', 'AC-RBAC-LEAST-PRIV', 'CRY-TLS-TRANSIT'];
  const priorStatus = new Map();
  for (const key of FIXTURES) {
    priorStatus.set(key, (await api(`/api/controls/${key}`)).body.control.status);
  }
  restoreFixtures = async () => {
    for (const [key, prior] of priorStatus) {
      await api(`/api/controls/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: prior }),
      }).catch(() => {});
    }
  };

  // AC-MFA covers CC6.1 and CC6.6 only PARTIALLY. Implementing it must NOT mark either
  // requirement implemented — several partial controls can still leave a real gap, which is
  // the whole reason coverage is graded.
  const before = (await api('/api/readiness')).body.frameworks[0].counts.implemented;
  await api('/api/controls/AC-MFA', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'implemented' }),
  });
  const afterPartial = (await api('/api/readiness')).body.frameworks[0].counts.implemented;
  check(
    'implementing a partial-coverage control moves nothing to implemented',
    afterPartial === before,
    `implemented count ${before} → ${afterPartial} after AC-MFA (partial on CC6.1, CC6.6)`,
  );

  // AC-RBAC-LEAST-PRIV has FULL coverage of CC6.3, so CC6.3 specifically should flip.
  //
  // Asserted on that requirement's own status rather than on a global count: a tenant with
  // real work already done would shift the count for reasons unrelated to this control, and
  // a test that only passes against a pristine database is a test that stops being run.
  const cc63Before = (await api('/api/frameworks/soc2/requirements')).body.requirements
    .find((r) => r.requirement_key === 'CC6.3');
  await api('/api/controls/AC-RBAC-LEAST-PRIV', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'implemented' }),
  });
  const cc63After = (await api('/api/frameworks/soc2/requirements')).body.requirements
    .find((r) => r.requirement_key === 'CC6.3');
  check(
    'implementing a full-coverage control makes its requirement implemented',
    cc63Before?.status !== 'implemented' && cc63After?.status === 'implemented',
    cc63Before?.status === 'implemented'
      ? 'CC6.3 was ALREADY implemented before the test - baseline not clean, assertion inconclusive'
      : `CC6.3 ${cc63Before?.status} → ${cc63After?.status} after implementing AC-RBAC-LEAST-PRIV`,
  );

  const cc63 = (await api('/api/frameworks/soc2/requirements')).body.requirements.find(
    (r) => r.requirement_key === 'CC6.3',
  );
  check(
    'CC6.3 is implemented but NOT audit ready (no evidence)',
    cc63?.status === 'implemented' && cc63?.audit_ready === false,
    `CC6.3 status=${cc63?.status} audit_ready=${cc63?.audit_ready} latest_evidence=${cc63?.latest_evidence}`,
  );

  console.log('\n=== 5. Collection produces evidence, and evidence makes a control auditable ===\n');

  const evBefore = (await api('/api/evidence?limit=500')).body.count;
  const run = await api('/api/monitors/tls-public-estate/run', { method: 'POST' });
  check(
    'POST /api/monitors/:key/run measures the real endpoints',
    run.status === 200 && run.body.results?.[0]?.status === 'pass',
    `${run.status} · ${run.body.results?.[0]?.status} · ${run.body.results?.[0]?.message}`,
  );

  const evAfter = await api('/api/evidence?limit=500');
  check(
    'the run appended exactly one evidence row with a sha256',
    evAfter.body.count === evBefore + 1 &&
      /^[0-9a-f]{64}$/.test(evAfter.body.evidence?.[0]?.content_hash ?? ''),
    `${evBefore} → ${evAfter.body.count} rows; newest hash ` +
      `${(evAfter.body.evidence?.[0]?.content_hash ?? '').slice(0, 24)}…`,
  );

  const unknownMonitor = await api('/api/monitors/does-not-exist/run', { method: 'POST' });
  check(
    'running an unknown monitor 404s',
    unknownMonitor.status === 404,
    `${unknownMonitor.status} · ${(unknownMonitor.body.error ?? '').slice(0, 110)}`,
  );

  // CRY-TLS-TRANSIT has full coverage of CC6.7 and now has fresh evidence, so marking it
  // implemented should make it the first AUDIT-READY requirement — the end-to-end claim.
  await api('/api/controls/CRY-TLS-TRANSIT', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'implemented' }),
  });
  const cc67 = (await api('/api/frameworks/soc2/requirements')).body.requirements.find(
    (r) => r.requirement_key === 'CC6.7',
  );
  check(
    'implemented + fresh evidence = audit ready',
    cc67?.status === 'implemented' && cc67?.audit_ready === true,
    `CC6.7 status=${cc67?.status} audit_ready=${cc67?.audit_ready} evidence=${cc67?.latest_evidence}`,
  );

  const summary = (await api('/api/readiness')).body.frameworks[0];
  check(
    'audit-ready count is lower than implemented count',
    summary.audit_ready < summary.counts.implemented,
    `implemented=${summary.counts.implemented} audit_ready=${summary.audit_ready} ` +
      `(implemented ${Math.round(summary.implemented_pct * 100)}% vs ` +
      `audit-ready ${Math.round(summary.audit_ready_pct * 100)}%)`,
  );

  console.log('\n=== 6. Every mutation is in the hash-chained audit log ===\n');

  const audit = await api('/api/audit?limit=200');
  const updates = (audit.body.events ?? []).filter((e) => e.action === 'control.updated');
  check(
    'control updates were recorded',
    updates.length >= 3,
    `${updates.length} control.updated events; newest: ` +
      `${updates[0]?.object_id} ${JSON.stringify(updates[0]?.payload?.to ?? null)}`,
  );
  check(
    'the audit chain verifies intact after all writes',
    audit.body.intact === true,
    audit.body.intact
      ? `intact across ${audit.body.count} events`
      : `BROKEN at seq ${audit.body.break?.broken_at}`,
  );
  check(
    'monitor runs are attributed to the collector, not a user',
    (audit.body.events ?? []).some((e) => e.action === 'monitor.run' && /^collector:/.test(e.actor_label ?? '')),
    `actor labels seen: ${[...new Set((audit.body.events ?? []).map((e) => e.actor_label))].slice(0, 4).join(', ')}`,
  );

  console.log('\n=== 7. Monitors endpoint reports only registered collectors ===\n');

  const mons = await api('/api/monitors');
  check(
    'collector kinds are derived from the runtime registry',
    mons.status === 200 &&
      mons.body.collector_kinds?.length >= 1 &&
      mons.body.collector_kinds.every((k) => k.kind && k.version),
    `${mons.body.collector_kinds?.map((k) => `${k.kind}@${k.version}`).join(', ')}`,
  );
  check(
    'monitor health includes a measured-vs-failed breakdown',
    typeof mons.body.monitors?.[0]?.errors_30d === 'number' &&
      typeof mons.body.monitors?.[0]?.fails_30d === 'number',
    `${mons.body.monitors?.[0]?.key}: runs_30d=${mons.body.monitors?.[0]?.runs_30d} ` +
      `fails=${mons.body.monitors?.[0]?.fails_30d} not-measured=${mons.body.monitors?.[0]?.errors_30d}`,
  );

  console.log('\n=== 8. Monitor administration ===\n');

  const TEMP = 'verify-temp-monitor';
  await api(`/api/monitors/${TEMP}`, { method: 'DELETE' });

  const badConfig = await api('/api/monitors', {
    method: 'POST',
    body: JSON.stringify({
      key: TEMP, title: 'Temp', kind: 'tls_endpoint',
      control_key: 'CRY-TLS-TRANSIT', config: { hosts: [] },
    }),
  });
  check(
    'creating a monitor with config its collector rejects is a 400',
    badConfig.status === 400 && /hosts/i.test(badConfig.body.error ?? ''),
    `${badConfig.status} · ${(badConfig.body.error ?? '').slice(0, 76)}`,
  );

  const badKey = await api('/api/monitors', {
    method: 'POST',
    body: JSON.stringify({
      key: 'Bad Key!', title: 'Temp', kind: 'tls_endpoint',
      control_key: 'CRY-TLS-TRANSIT', config: { hosts: ['example.com'] },
    }),
  });
  check(
    'an invalid monitor identifier is refused',
    badKey.status === 400 && /lowercase/i.test(badKey.body.error ?? ''),
    `${badKey.status} · ${(badKey.body.error ?? '').slice(0, 76)}`,
  );

  const created = await api('/api/monitors', {
    method: 'POST',
    body: JSON.stringify({
      key: TEMP, title: 'Temporary verification monitor', kind: 'tls_endpoint',
      control_key: 'CRY-TLS-TRANSIT', schedule: 'weekly',
      config: { hosts: ['example.com'], min_days_remaining: 1 },
    }),
  });
  check(
    'a valid monitor is created',
    created.status === 200 && created.body.monitor?.key === TEMP,
    `${created.status} · ${created.body.monitor?.key}`,
  );

  const dupe = await api('/api/monitors', {
    method: 'POST',
    body: JSON.stringify({
      key: TEMP, title: 'Dupe', kind: 'tls_endpoint',
      control_key: 'CRY-TLS-TRANSIT', config: { hosts: ['example.com'] },
    }),
  });
  check(
    'a duplicate monitor identifier is refused',
    dupe.status === 400 && /already exists/i.test(dupe.body.error ?? ''),
    `${dupe.status} · ${(dupe.body.error ?? '').slice(0, 70)}`,
  );

  // Changing the collector would leave one run history produced by two different
  // measurements, which is a series nobody can interpret.
  const changeKind = await api(`/api/monitors/${TEMP}`, {
    method: 'PATCH',
    body: JSON.stringify({ kind: 'port_exposure' }),
  });
  check(
    'the collector kind cannot be changed, and the refusal explains why',
    changeKind.status === 400 && /run history/i.test(changeKind.body.error ?? ''),
    `${changeKind.status} · ${(changeKind.body.error ?? '').slice(0, 96)}`,
  );

  const deletable = await api(`/api/monitors/${TEMP}`, { method: 'DELETE' });
  check(
    'a monitor with no run history can be deleted',
    deletable.status === 200,
    `${deletable.status} · deleted ${deletable.body.deleted}`,
  );

  // A monitor that HAS collected cannot be deleted: those runs are evidence, and
  // monitor_runs is append-only with a RESTRICT key back to the monitor.
  const protectedDelete = await api('/api/monitors/tls-public-estate', { method: 'DELETE' });
  check(
    'a monitor with evidence cannot be deleted, and is told to disable instead',
    protectedDelete.status === 400 &&
      /evidence/i.test(protectedDelete.body.error ?? '') &&
      /disable/i.test(protectedDelete.body.error ?? ''),
    `${protectedDelete.status} · ${(protectedDelete.body.error ?? '').slice(0, 96)}`,
  );

  // Disabling must actually stop collection, not merely grey out a row.
  await api('/api/monitors/tls-public-estate', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  });
  const whileDisabled = await api('/api/monitors/tls-public-estate/run', { method: 'POST' });
  check(
    'a disabled monitor will not run',
    whileDisabled.status === 404,
    `${whileDisabled.status} · ${(whileDisabled.body.error ?? '').slice(0, 70)}`,
  );
  await api('/api/monitors/tls-public-estate', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true }),
  });
  const reEnabled = await api('/api/monitors');
  check(
    're-enabling restores it',
    reEnabled.body.monitors?.find((m) => m.key === 'tls-public-estate')?.enabled === true,
    `enabled=${reEnabled.body.monitors?.find((m) => m.key === 'tls-public-estate')?.enabled}`,
  );

  console.log(SECTION9);

  // Agent endpoints use a bearer token, not a user session, so they carry no suite identity.
  async function agentApi(path, token, init = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text.slice(0, 160) }; }
    return { status: res.status, body: parsed };
  }

  const AGENT = 'verify-agent';
  const [tenantRow] = await sql`SELECT id FROM tenants WHERE slug = ${TENANT}`;
  const [ctl] = await sql`
    SELECT id FROM controls WHERE tenant_id = ${tenantRow.id} AND key = 'OPS-MONITORING'`;

  // The fixture monitor is REUSED, never deleted and recreated. Once it has run even once
  // its monitor_runs are evidence, and the RESTRICT key added in 008 refuses the delete -
  // correctly. A suite that insists on a clean slate would be demanding the product break
  // its own integrity guarantee to accommodate a test.
  await sql`
    INSERT INTO monitors (tenant_id, control_id, key, title, kind, config, schedule, severity)
    VALUES (${tenantRow.id}, ${ctl.id}, 'verify-agent-monitor', 'Agent verification monitor',
            'capacity_headroom', ${sql.json({ hosts: ['localhost'] })}, 'daily', 'low')
    ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`;

  // The agent is rotated each run so the token is fresh. Unbind the monitor first:
  // monitors.agent_id is RESTRICT too, so an agent owning a monitor cannot be removed.
  await sql`UPDATE monitors SET agent_id = NULL WHERE key = 'verify-agent-monitor'`;
  await sql`DELETE FROM agents WHERE name = ${AGENT}`;
  const agentToken = newToken();
  const [agentRow] = await sql`
    INSERT INTO agents (tenant_id, name, host_label, token_hash)
    VALUES (${tenantRow.id}, ${AGENT}, 'verification host', ${hashToken(agentToken)})
    RETURNING id`;
  await sql`
    UPDATE monitors SET agent_id = ${agentRow.id} WHERE key = 'verify-agent-monitor'`;

  const noToken = await agentApi('/api/agent/assignments', null);
  check('agent endpoint refuses a request with no token', noToken.status === 401,
    `${noToken.status} · ${(noToken.body.error ?? '').slice(0, 60)}`);

  const badToken = await agentApi('/api/agent/assignments', 'not-a-real-token');
  check('agent endpoint refuses an invalid token', badToken.status === 401,
    `${badToken.status} · ${(badToken.body.error ?? '').slice(0, 60)}`);

  const assigned = await agentApi('/api/agent/assignments', agentToken);
  check('an enrolled agent receives only its own assignments',
    assigned.status === 200 && assigned.body.assignments?.length === 1 &&
      assigned.body.assignments[0].key === 'verify-agent-monitor',
    `${assigned.status} · ${assigned.body.count} assignment(s): ${assigned.body.assignments?.map((a) => a.key).join(', ')}`);

  // The core trust boundary: an agent may submit observations, never author them.
  const foreign = await agentApi('/api/agent/report', agentToken, {
    method: 'POST',
    body: JSON.stringify({ results: [
      { monitor: 'tls-public-estate', status: 'pass', message: 'forged', observed: {}, content_hash: 'a'.repeat(64) },
      { monitor: 'verify-agent-monitor', status: 'pass', message: 'legitimate', observed: { ok: true }, content_hash: 'b'.repeat(64) },
    ] }),
  });
  check('an agent cannot report for a monitor it was not assigned',
    foreign.status === 200 && foreign.body.accepted === 1 &&
      foreign.body.rejected?.some((r) => r.monitor === 'tls-public-estate'),
    `accepted=${foreign.body.accepted}, rejected=${JSON.stringify(foreign.body.rejected?.[0] ?? null).slice(0, 80)}`);

  // A compromised agent must not be able to backdate a result into a closed audit window.
  const longAgo = new Date(Date.now() - 400 * 86400000).toISOString();
  await agentApi('/api/agent/report', agentToken, {
    method: 'POST',
    body: JSON.stringify({ results: [
      { monitor: 'verify-agent-monitor', status: 'pass', message: 'backdate attempt',
        observed: {}, content_hash: 'c'.repeat(64), started_at: longAgo },
    ] }),
  });
  // Newest first: monitor_runs is append-only, so every previous run of this suite has left
  // its own 'backdate attempt' row behind. Without an ORDER BY this picks an older one, whose
  // clamped timestamp has since aged past the window — a false failure that looks like a
  // broken clamp.
  const [backdated] = await sql`
    SELECT started_at FROM monitor_runs r JOIN monitors m ON m.id = r.monitor_id
    WHERE m.key = 'verify-agent-monitor' AND r.message = 'backdate attempt'
    ORDER BY r.created_at DESC LIMIT 1`;
  const ageHours = (Date.now() - new Date(backdated.started_at).getTime()) / 3600000;
  check('a backdated agent result is clamped, not trusted',
    ageHours < 7,
    `agent claimed 400 days ago; stored as ${ageHours.toFixed(1)}h ago (clamp is 6h)`);

  // Server-side collection must leave agent-owned monitors alone - it cannot reach them.
  const serverSide = await runMonitors(sql, tenantRow.id, {});
  check('the server-side runner skips agent-owned monitors',
    !serverSide.results.some((r) => r.key === 'verify-agent-monitor'),
    `server ran ${serverSide.results.length} monitor(s), none of them agent-owned`);

  await sql`UPDATE agents SET enabled = false, revoked_at = now() WHERE id = ${agentRow.id}`;
  const revoked = await agentApi('/api/agent/assignments', agentToken);
  check('a revoked agent token stops working immediately', revoked.status === 401,
    `${revoked.status} · ${(revoked.body.error ?? '').slice(0, 60)}`);

  // No cleanup of monitor_runs: they are append-only by design. The fixture monitor is
  // disabled instead, which is exactly what the product tells a user to do.
  await sql`UPDATE monitors SET enabled = false WHERE key = 'verify-agent-monitor'`;

  // --- restore ----------------------------------------------------------------
  // Restores each control to the status it actually had, captured up front. Reverting to a
  // hard-coded 'not_started' instead would silently erase real work every time the suite
  // ran — the test destroying the data it is meant to be checking.
  //
  // Also runs from the finally block: an abort anywhere after the fixtures are set would
  // otherwise leave them implemented, which is exactly what happened once and then made the
  // NEXT run fail for an unrelated-looking reason.
  await restoreFixtures();
  const after = await api('/api/readiness');
  const restored = after.body.frameworks[0].counts.implemented;
  const stillSet = await Promise.all(
    [...priorStatus.keys()].map(async (k) => (await api(`/api/controls/${k}`)).body.control.status),
  );
  check(
    'fixture controls restored to their original status',
    restored === before && stillSet.every((s, i) => s === [...priorStatus.values()][i]),
    `implemented count back to ${restored} (started at ${before}); ` +
      `statuses ${[...priorStatus.keys()].map((k, i) => `${k}=${stillSet[i]}`).join(', ')}`,
  );

  console.log('\n' + '='.repeat(64));
  if (failures.length) {
    console.log(`FAILED — ${pass} passed, ${failures.length} failed:\n`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${pass} API checks passed.`);
  }
  console.log('='.repeat(64) + '\n');
} catch (err) {
  console.error('\nAPI verification aborted:\n', err);
  process.exitCode = 1;
} finally {
  // Put any fixture controls back before anything else, even if the suite aborted.
  await restoreFixtures().catch(() => {});
  // Offboard the fixture the way the product does: drop the membership. Access ends on the
  // next request. The user row stays — it appears in the append-only access log.
  await sql`DELETE FROM tenant_members WHERE user_id IN (SELECT id FROM users WHERE email = ${USER})`
    .catch(() => {});
  await sql.end();
}
