// Access verification: suite sign-in, first-user bootstrap, invitations, read-only seats
// and tenant isolation. Runs against a server and a FRESH database (catalog seeded, no
// organisations yet), because the first check is what happens to the very first user.
//
//   createdb trust_access && DATABASE_URL=.../trust_access node scripts/migrate.mjs
//   DATABASE_URL=.../trust_access node scripts/seed.mjs
//   DATABASE_URL=.../trust_access PORT=3671 npm start              (production mode)
//   DATABASE_URL=.../trust_access TRUST_BASE=http://127.0.0.1:3671 npm run verify:access
//
// Every request carries the identity headers the suite gateway would set. If the server has
// PROXY_SHARED_SECRET, give this script the same value.

import { adminSql, withTenant } from '../src/lib/db.mjs';

const BASE = process.env.TRUST_BASE ?? 'http://127.0.0.1:3670';
const SECRET = process.env.PROXY_SHARED_SECRET ?? '';
const COMPANY = process.env.TRUST_COMPANY_NAME?.trim() || 'My Company';

const FIRST = 'first-owner@example.com';
const STRANGER = 'stranger@example.org';
const AUDITOR = 'Auditor@Example.org'; // mixed case on purpose: matching is by lowercased email
const OTHER = 'other-owner@example.net';

const sql = adminSql({ max: 2 });
let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, observed: string) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}\n          ${observed}`);
  } else {
    failures.push(`${name} — ${observed}`);
    console.log(`  FAIL  ${name}\n          ${observed}`);
  }
}

type Reply = { status: number; body: Record<string, any>; text: string; location: string | null };

async function call(
  path: string,
  as: string | null,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; secret?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: BASE };
  if (as) headers['x-auth-request-email'] = as;
  const secret = init.secret ?? SECRET;
  if (secret) headers['x-proxy-auth-secret'] = secret;
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...headers, ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
  });
  const text = await res.text();
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return { status: res.status, body, text, location: res.headers.get('location') };
}

try {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${BASE}. Start the server first (npm run build && npm start).\n`);
    process.exit(1);
  }

  const [{ members }] = await sql<{ members: number }[]>`
    SELECT count(*)::int AS members FROM tenant_members`;
  if (members !== 0) {
    console.error('\nverify-access needs a fresh database with no members yet; see the header comment.\n');
    process.exit(1);
  }

  console.log('\n=== 1. The first suite user becomes owner of a default organisation ===\n');

  const first = await call('/api/me', FIRST);
  check(
    'first user gets the owner role',
    first.status === 200 && first.body.tenant?.role === 'owner',
    `${first.status} · role=${first.body.tenant?.role} · user=${first.body.user?.email}`,
  );
  check(
    'the default organisation is named from TRUST_COMPANY_NAME',
    first.body.tenant?.name === COMPANY,
    `tenant name '${first.body.tenant?.name}' (expected '${COMPANY}')`,
  );
  const tenantA: string = first.body.tenant?.id;
  const [{ controls }] = await sql<{ controls: number }[]>`
    SELECT count(*)::int AS controls FROM controls WHERE tenant_id = ${tenantA}`;
  check(
    'the new organisation is provisioned with the control library',
    controls > 0,
    `${controls} controls instantiated`,
  );

  const page = await call('/', FIRST);
  check(
    'the owner sees the dashboard',
    page.status === 200 && page.text.includes(COMPANY) && page.text.includes('synergy-app-bar'),
    `${page.status} · page names the organisation and renders the suite app bar`,
  );

  console.log('\n=== 2. Later users without an invitation get no access ===\n');

  const stranger = await call('/api/me', STRANGER);
  check(
    'an uninvited suite user is refused by the API',
    stranger.status === 403 && stranger.body.auth === 'no_access',
    `${stranger.status} · auth=${stranger.body.auth}`,
  );
  const strangerPage = await call('/', STRANGER);
  check(
    'an uninvited suite user is sent to the no-access page',
    [303, 307, 308].includes(strangerPage.status) || strangerPage.text.includes('NEXT_REDIRECT'),
    `${strangerPage.status} · location=${strangerPage.location ?? '(streamed redirect)'}`,
  );
  const noAccess = await call('/no-access', STRANGER);
  check(
    'the no-access page tells them to ask an admin',
    noAccess.status === 200 && /ask an owner or admin/i.test(noAccess.text),
    `${noAccess.status}`,
  );
  const strangerData = await call('/api/controls', STRANGER);
  check(
    'an uninvited user reads no tenant data',
    strangerData.status === 403 && !strangerData.body.controls,
    `${strangerData.status} · ${strangerData.body.error ?? ''}`.slice(0, 120),
  );
  const [{ strangerMemberships }] = await sql<{ strangerMemberships: number }[]>`
    SELECT count(*)::int AS "strangerMemberships" FROM tenant_members m
    JOIN users u ON u.id = m.user_id WHERE u.email = ${STRANGER}`;
  check(
    'arriving does not create a membership or a second default organisation',
    strangerMemberships === 0,
    `${strangerMemberships} membership(s)`,
  );
  const [denied] = await sql`
    SELECT event FROM auth_events WHERE email = ${STRANGER} AND event = 'access.denied' LIMIT 1`;
  check('the denied access is logged', !!denied, denied ? 'access.denied recorded' : 'NOT logged');

  const anonymous = await call('/api/me', null);
  check('no identity headers means 401', anonymous.status === 401, `${anonymous.status}`);
  if (SECRET) {
    const forged = await call('/api/me', FIRST, { secret: 'not-the-secret' });
    check(
      'identity headers without the gateway secret are ignored',
      forged.status === 401,
      `${forged.status}`,
    );
  }

  console.log('\n=== 3. An invited email becomes a membership on first sign-in ===\n');

  const nonAdminAdd = await call('/api/members', STRANGER, {
    method: 'POST', body: { email: 'x@example.org', role: 'viewer' },
  });
  check('a non-member cannot add members', nonAdminAdd.status === 403, `${nonAdminAdd.status}`);

  const added = await call('/api/members', FIRST, {
    method: 'POST', body: { email: AUDITOR, role: 'auditor' },
  });
  check(
    'the owner adds an auditor by email',
    added.status === 200 && added.body.status === 'pending',
    `${added.status} · status=${added.body.status} · email=${added.body.email}`,
  );
  const auditor = await call('/api/me', AUDITOR.toLowerCase());
  check(
    'the invited email gets the membership on first arrival',
    auditor.status === 200 && auditor.body.tenant?.id === tenantA && auditor.body.tenant?.role === 'auditor',
    `${auditor.status} · role=${auditor.body.tenant?.role} · readOnly=${auditor.body.tenant?.readOnly}`,
  );
  const [claimed] = await sql`
    SELECT accepted_at FROM invitations WHERE email = ${AUDITOR.toLowerCase()} AND tenant_id = ${tenantA}`;
  check('the invitation is marked claimed', !!claimed?.accepted_at, `accepted_at=${claimed?.accepted_at?.toISOString?.()}`);

  console.log('\n=== 4. Read-only seats cannot write ===\n');

  const auditorWrite = await call('/api/controls/AC-MFA', AUDITOR.toLowerCase(), {
    method: 'PATCH', body: { status: 'implemented' },
  });
  check('the API refuses a write from an auditor', auditorWrite.status === 403, `${auditorWrite.status} · ${auditorWrite.body.error ?? ''}`.slice(0, 120));

  let roError = '';
  try {
    await withTenant(sql, tenantA, (tx) => tx`UPDATE controls SET notes = 'tampered' WHERE tenant_id = ${tenantA}`, {
      readOnly: true,
    });
  } catch (err) {
    roError = (err as Error).message;
  }
  check(
    'the read-only database role cannot write, whatever the app does',
    /read-only|permission denied/i.test(roError),
    roError ? `refused: ${roError.split('\n')[0]}` : 'the UPDATE SUCCEEDED',
  );
  const roRead = await withTenant(
    sql, tenantA,
    (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM controls`,
    { readOnly: true },
  );
  check('the read-only role can still read its own tenant', roRead[0].n === controls, `${roRead[0].n} controls visible`);

  console.log('\n=== 5. Tenants are isolated ===\n');

  const tenantB = await sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: string }[]>`SELECT trust_provision_tenant('verify-other', 'Other Org') AS id`;
    return id;
  });
  await sql`INSERT INTO invitations (tenant_id, email, role) VALUES (${tenantB}, ${OTHER}, 'owner')`;
  const other = await call('/api/me', OTHER);
  check('a second organisation has its own owner', other.status === 200 && other.body.tenant?.id === tenantB, `${other.status} · ${other.body.tenant?.name}`);

  const crossRead = await withTenant(
    sql, tenantA,
    (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM controls WHERE tenant_id = ${tenantB}`,
  );
  check(
    "a query scoped to tenant A that asks for tenant B's rows gets none",
    crossRead[0].n === 0,
    `${crossRead[0].n} rows from the other tenant`,
  );
  const unset = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE strust_app`;
    return tx<{ n: number }[]>`SELECT count(*)::int AS n FROM controls`;
  });
  check('with no tenant set, the app role sees nothing', unset[0].n === 0, `${unset[0].n} rows`);

  const cookieSwitch = await call('/api/me', FIRST, { headers: { cookie: `trust_tenant=${tenantB}` } });
  check(
    "a cookie naming someone else's organisation is ignored",
    cookieSwitch.status === 200 && cookieSwitch.body.tenant?.id === tenantA,
    `still acting in ${cookieSwitch.body.tenant?.name}`,
  );
  const badSwitch = await call('/api/tenant', FIRST, { method: 'POST', body: { tenantId: tenantB } });
  check('switching to a non-member organisation is refused', badSwitch.status === 403, `${badSwitch.status}`);

  // A member of both may switch, and the switch is checked against the database.
  await call('/api/members', OTHER, { method: 'POST', body: { email: FIRST, role: 'viewer' } });
  const goodSwitch = await call('/api/tenant', FIRST, { method: 'POST', body: { tenantId: tenantB } });
  check('a member of two organisations can switch between them', goodSwitch.status === 200 && goodSwitch.body.tenant?.role === 'viewer', `${goodSwitch.status} · role=${goodSwitch.body.tenant?.role}`);
  const afterSwitch = await call('/api/me', FIRST, { headers: { cookie: `trust_tenant=${tenantB}` } });
  check('after switching, the role is the one held there', afterSwitch.body.tenant?.role === 'viewer' && afterSwitch.body.tenant?.readOnly === true, `role=${afterSwitch.body.tenant?.role}`);

  console.log('\n=== 6. Removing a member ends access on the next request ===\n');

  const audUserId = auditor.body.user?.id;
  const removed = await call(`/api/members/${audUserId}`, FIRST, { method: 'DELETE' });
  const afterRemoval = await call('/api/me', AUDITOR.toLowerCase());
  check(
    'a removed member is refused immediately',
    removed.status === 200 && afterRemoval.status === 403,
    `delete ${removed.status} · next request ${afterRemoval.status}`,
  );
  const lastOwner = await call(`/api/members/${first.body.user?.id}`, FIRST, { method: 'PATCH', body: { role: 'admin' } });
  check('the last owner cannot demote themselves', lastOwner.status === 400 && /owner/i.test(lastOwner.body.error ?? ''), `${lastOwner.status} · ${lastOwner.body.error ?? ''}`);

  console.log('\n=== 7. Public surfaces need no sign-in ===\n');

  const missing = await call('/trust/does-not-exist', null);
  check('an unknown trust centre is a plain 404, not a sign-in demand', missing.status === 404, `${missing.status}`);
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    await tx`
      INSERT INTO trust_centers (tenant_id, enabled, public_slug, headline)
      VALUES (${tenantA}, true, 'verify-public', 'Security at a glance')
      ON CONFLICT (tenant_id) DO UPDATE SET enabled = true`;
  });
  const publicPage = await call('/trust/verify-public', null);
  check(
    'an enabled trust centre renders for an anonymous visitor',
    publicPage.status === 200 && publicPage.text.includes(COMPANY) && !publicPage.text.includes('synergy-app-bar'),
    `${publicPage.status} · names the organisation, no suite chrome`,
  );
  const agentNoToken = await call('/api/agent/assignments', null);
  check('the agent API answers 401 to a missing token, without a sign-in redirect', agentNoToken.status === 401, `${agentNoToken.status}`);

  console.log('\n' + '='.repeat(64));
  if (failures.length) {
    console.log(`FAILED — ${pass} passed, ${failures.length} failed:\n`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${pass} access checks passed.`);
  }
  console.log('='.repeat(64) + '\n');
} catch (err) {
  console.error('\nAccess verification aborted:\n', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
