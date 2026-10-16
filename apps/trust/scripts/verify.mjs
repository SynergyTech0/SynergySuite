// Verification. Asserts on actual values, never on exit codes.
//
// Each check prints what it observed so a pass is readable as evidence rather than taken on
// trust. The negative checks matter most: an append-only table that accepts an UPDATE, or
// an RLS policy that lets a tenant read a neighbour, both fail by returning success.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminSql } from '../src/lib/db.mjs';

// The organisation the suite runs against (scripts/seed.mjs --tenant <slug> provisions it).
const TENANT = process.env.TRUST_TENANT ?? 'example';

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, '..', 'db', 'catalog');
const load = async (f) => JSON.parse(await readFile(join(catalogDir, f), 'utf8'));

const sql = adminSql({ max: 1 });
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

// Asserts that `fn` throws, and that the message looks like the expected refusal.
async function mustReject(name, fn, expectFragment) {
  try {
    await fn();
    check(name, false, 'the operation SUCCEEDED when it should have been refused');
  } catch (err) {
    const msg = err.message.split('\n')[0];
    check(
      name,
      expectFragment ? msg.toLowerCase().includes(expectFragment.toLowerCase()) : true,
      `refused: ${msg}`,
    );
  }
}

try {
  console.log('\n=== 1. Framework catalog seeded completely ===\n');

  for (const file of ['soc2.json', 'iso27001.json', 'hipaa.json', 'gdpr.json']) {
    const fw = await load(file);
    const [row] = await sql`
      SELECT
        (SELECT count(*) FROM framework_sections s
          JOIN frameworks f ON f.id = s.framework_id WHERE f.key = ${fw.key}) AS sections,
        (SELECT count(*) FROM requirements r
          JOIN frameworks f ON f.id = r.framework_id WHERE f.key = ${fw.key}) AS requirements`;
    const okS = Number(row.sections) === fw.sections.length;
    const okR = Number(row.requirements) === fw.requirements.length;
    check(
      `${fw.key} catalog matches source`,
      okS && okR,
      `db has ${row.sections} sections / ${row.requirements} requirements; ` +
        `catalog declares ${fw.sections.length} / ${fw.requirements.length}`,
    );
  }

  console.log('\n=== 2. Every control mapping resolved (no silent drops) ===\n');

  const lib = await load('controls.json');
  const declared = lib.templates.reduce((n, t) => n + t.maps.length, 0);
  const [{ count: stored }] = await sql`SELECT count(*) FROM control_template_requirement_map`;
  check(
    'template mappings stored == declared',
    Number(stored) === declared,
    `${stored} stored, ${declared} declared in controls.json`,
  );

  console.log('\n=== 3. The unified control model actually unifies ===\n');

  const spread = await sql`
    SELECT f.key AS framework, count(*) AS n
    FROM control_templates t
    JOIN control_template_requirement_map m ON m.template_id = t.id
    JOIN requirements r ON r.id = m.requirement_id
    JOIN frameworks f ON f.id = r.framework_id
    WHERE t.key = 'AC-MFA'
    GROUP BY f.key ORDER BY f.key`;
  check(
    'one control (AC-MFA) reaches all four frameworks',
    spread.length === 4,
    spread.map((r) => `${r.framework}:${r.n}`).join('  ') || '(no mappings found)',
  );

  // The product claim under test: adopting the library moves coverage in every framework
  // at once. Printed per framework so the number is inspectable, not asserted in the dark.
  const coverage = await sql`
    SELECT f.key AS framework,
           count(DISTINCT r.id) FILTER (WHERE m.requirement_id IS NOT NULL) AS covered,
           count(DISTINCT r.id) AS total
    FROM frameworks f
    JOIN requirements r ON r.framework_id = f.id
    LEFT JOIN control_template_requirement_map m ON m.requirement_id = r.id
    GROUP BY f.key ORDER BY f.key`;
  for (const c of coverage) {
    const pct = ((Number(c.covered) / Number(c.total)) * 100).toFixed(0);
    console.log(
      `        ${c.framework.padEnd(10)} library touches ${String(c.covered).padStart(3)} of ` +
        `${String(c.total).padStart(3)} requirements (${pct}%)`,
    );
  }

  console.log('\n=== 4. Evidence and audit log are append-only ===\n');

  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = ${TENANT}`;
  const [ctl] = await sql`
    SELECT id FROM controls WHERE tenant_id = ${tenant.id} AND key = 'CRY-TLS-TRANSIT'`;

  const [ev] = await sql`
    INSERT INTO evidence
      (tenant_id, control_id, kind, title, collected_at, collector, collector_version,
       content_hash, payload)
    VALUES (${tenant.id}, ${ctl.id}, 'automated', 'TLS probe — verify run',
            now(), 'verify.mjs', '0.1.0',
            encode(digest('verify-fixture', 'sha256'), 'hex'),
            ${sql.json({ fixture: true })})
    RETURNING id, content_hash`;
  check('evidence row inserts', !!ev.id, `id ${ev.id.slice(0, 8)}… hash ${ev.content_hash.slice(0, 16)}…`);

  await mustReject(
    'UPDATE on evidence is refused',
    () => sql`UPDATE evidence SET title = 'tampered' WHERE id = ${ev.id}`,
    'append-only',
  );
  await mustReject(
    'DELETE on evidence is refused',
    () => sql`DELETE FROM evidence WHERE id = ${ev.id}`,
    'append-only',
  );

  console.log('\n=== 5. Audit chain links, and a break is detectable ===\n');

  for (const action of ['control.adopted', 'evidence.collected', 'policy.approved']) {
    await sql`
      INSERT INTO audit_events (tenant_id, actor_label, action, object_type, object_id, payload)
      VALUES (${tenant.id}, 'verify.mjs', ${action}, 'verify', 'fixture',
              ${sql.json({ action })})`;
  }

  const chain = await sql`
    SELECT seq, prev_hash, hash FROM audit_events
    WHERE tenant_id = ${tenant.id} ORDER BY seq`;
  const linked = chain.every((e, i) =>
    i === 0 ? e.prev_hash === null : e.prev_hash === chain[i - 1].hash,
  );
  check(
    'each event carries its predecessor hash',
    linked && chain.length >= 3,
    `${chain.length} events, seq ${chain[0]?.seq}..${chain.at(-1)?.seq}, links consistent: ${linked}`,
  );

  const intactRows = await sql`SELECT * FROM verify_audit_chain(${tenant.id})`;
  check(
    'verify_audit_chain reports an intact chain',
    intactRows.length === 0,
    intactRows.length === 0 ? 'no break found' : `break at seq ${intactRows[0].broken_at}`,
  );

  // Prove the detector detects. Tamper with the trigger lifted, inside a transaction that
  // is then rolled back — otherwise "intact chain" only shows that nothing tried to break
  // it, which is a much weaker claim than the one being made.
  const target = chain[1].seq;
  let detectedAt = null;
  try {
    await sql.begin(async (tx) => {
      await tx`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`;
      await tx`
        UPDATE audit_events SET payload = ${tx.json({ action: 'tampered' })}
        WHERE tenant_id = ${tenant.id} AND seq = ${target}`;
      const broken = await tx`SELECT * FROM verify_audit_chain(${tenant.id})`;
      detectedAt = broken.length ? Number(broken[0].broken_at) : null;
      throw new Error('rollback-tamper-probe');
    });
  } catch (err) {
    if (err.message !== 'rollback-tamper-probe') throw err;
  }
  check(
    'a tampered payload breaks the chain at the right event',
    detectedAt === Number(target),
    `tampered seq ${target}; verify_audit_chain flagged ${detectedAt}`,
  );

  const [{ count: stillThere }] = await sql`
    SELECT count(*) FROM audit_events WHERE tenant_id = ${tenant.id}`;
  check(
    'tamper probe rolled back cleanly',
    Number(stillThere) === chain.length,
    `${stillThere} events after rollback, ${chain.length} before`,
  );

  console.log('\n=== 6. Tenant isolation holds for the application role ===\n');

  const [other] = await sql`
    INSERT INTO tenants (slug, name) VALUES ('probe-tenant', 'Isolation Probe Ltd')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  await sql`
    INSERT INTO controls (tenant_id, key, title, objective, status)
    VALUES (${other.id}, 'PROBE-1', 'Probe control', 'Should never be visible to the example tenant', 'not_started')
    ON CONFLICT (tenant_id, key) DO NOTHING`;

  const isolation = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE strust_app`;
    await tx`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    const [mine] = await tx`SELECT count(*) AS n FROM controls`;
    const [theirs] = await tx`SELECT count(*) AS n FROM controls WHERE tenant_id = ${other.id}`;
    const [whoami] = await tx`SELECT current_user AS u`;
    return { mine: Number(mine.n), theirs: Number(theirs.n), user: whoami.u };
  });
  check(
    'app role sees only its own tenant',
    isolation.theirs === 0 && isolation.mine > 0,
    `as ${isolation.user}: ${isolation.mine} own controls visible, ` +
      `${isolation.theirs} of the other tenant's visible (must be 0)`,
  );

  // No tenant set at all must yield nothing, not everything.
  const unscoped = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE strust_app`;
    const [r] = await tx`SELECT count(*) AS n FROM controls`;
    return Number(r.n);
  });
  check(
    'app role with no tenant set is fail-closed',
    unscoped === 0,
    `${unscoped} rows visible with app.tenant_id unset (must be 0)`,
  );

  // The owner connection deliberately bypasses RLS. Stating it as a verified fact keeps
  // anyone from later "fixing" a bug by pointing the app at this connection.
  const [{ n: adminSees }] = await sql`SELECT count(*) AS n FROM controls`;
  check(
    'owner connection bypasses RLS (expected, and why the app must not use it)',
    Number(adminSees) > isolation.mine,
    `owner sees ${adminSees} controls across all tenants vs ${isolation.mine} for the scoped app role`,
  );

  console.log('\n=== 7. Constraints that encode regulatory facts ===\n');

  await mustReject(
    'vendor touching PHI without a signed BAA is rejected',
    () => sql`
      INSERT INTO vendors (tenant_id, name, processes_phi, baa_status)
      VALUES (${tenant.id}, 'Probe Transcription Co', true, 'pending')`,
    'phi_requires_baa',
  );

  await mustReject(
    'control marked not_applicable without a rationale is rejected',
    () => sql`
      INSERT INTO controls (tenant_id, key, title, objective, status)
      VALUES (${tenant.id}, 'PROBE-NA', 'Probe', 'Probe', 'not_applicable')`,
    'na_needs_rationale',
  );

  await mustReject(
    'international transfer without a named safeguard is rejected',
    () => sql`
      INSERT INTO processing_activities
        (tenant_id, name, purpose, lawful_basis, retention, transfers_outside_eea)
      VALUES (${tenant.id}, 'Probe', 'Probe', 'contract', '1 year', true)`,
    'transfer_needs_safeguard',
  );

  await mustReject(
    'Type II audit without an observation period is rejected',
    () => sql`
      INSERT INTO audits (tenant_id, framework_id, kind)
      SELECT ${tenant.id}, id, 'type_2' FROM frameworks WHERE key = 'soc2'`,
    'window_kinds_need_period',
  );

  await mustReject(
    'policy version made effective without approval is rejected',
    () => sql`
      INSERT INTO policies (tenant_id, key, title) VALUES (${tenant.id}, 'probe-pol', 'Probe')
      RETURNING id`.then(
      ([p]) => sql`
        INSERT INTO policy_versions
          (tenant_id, policy_id, version, body_md, content_hash, effective_at)
        VALUES (${tenant.id}, ${p.id}, 1, '# probe', 'deadbeef', now())`,
    ),
    'effective_needs_approval',
  );

  // --- cleanup of probe fixtures (owner connection; evidence/audit rows stay by design) --
  await sql`DELETE FROM controls WHERE tenant_id = ${other.id}`;
  await sql`DELETE FROM policies WHERE tenant_id = ${tenant.id} AND key = 'probe-pol'`;
  await sql`DELETE FROM tenants WHERE slug = 'probe-tenant'`;

  console.log('\n' + '='.repeat(64));
  if (failures.length) {
    console.log(`FAILED — ${pass} passed, ${failures.length} failed:\n`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${pass} checks passed.`);
  }
  console.log('='.repeat(64) + '\n');
} catch (err) {
  console.error('\nVerification aborted with an unexpected error:\n', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
