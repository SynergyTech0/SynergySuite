// Adds a member to an organisation by email, from the command line.
//
//   node scripts/add-member.mjs <tenant-slug> <email> <role> ["Full Name"] ["Job title"]
//
// The same thing the Members page does: someone who already uses Trust joins at once;
// anyone else joins the next time they open Trust through the suite sign-in. It also records
// the person in the personnel register, because accountability is an organisational fact —
// an asset register should be able to name a new COO before they first open Trust.

import { adminSql } from '../src/lib/db.mjs';

const [slug, email, role, fullName, jobTitle] = process.argv.slice(2);
const VALID = ['owner', 'admin', 'contributor', 'auditor', 'viewer'];

if (!slug || !email || !role) {
  console.error('Usage: node scripts/add-member.mjs <tenant> <email> <role> ["Name"] ["Title"]');
  process.exit(2);
}
if (!VALID.includes(role)) {
  console.error(`role must be one of ${VALID.join(', ')}`);
  process.exit(2);
}

const sql = adminSql({ max: 1 });

try {
  const [tenant] = await sql`SELECT id, name FROM tenants WHERE slug = ${slug}`;
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);
  const normalised = email.trim().toLowerCase();

  const status = await sql.begin(async (tx) => {
    // personnel and audit_events are tenant-scoped under FORCE RLS.
    await tx`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    const [user] = await tx`SELECT id FROM users WHERE lower(email) = ${normalised}`;

    await tx`
      UPDATE invitations SET revoked_at = now()
      WHERE tenant_id = ${tenant.id} AND email = ${normalised}
        AND accepted_at IS NULL AND revoked_at IS NULL`;
    const [inv] = await tx`
      INSERT INTO invitations (tenant_id, email, role)
      VALUES (${tenant.id}, ${normalised}, ${role})
      RETURNING id`;

    if (user) {
      await tx`
        INSERT INTO tenant_members (tenant_id, user_id, role)
        VALUES (${tenant.id}, ${user.id}, ${role})
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
      await tx`
        UPDATE invitations SET accepted_at = now(), accepted_user_id = ${user.id}
        WHERE id = ${inv.id}`;
    }

    // The personnel register is what CC1.1/CC1.4 and ISO A.6 are tested against; a member
    // row alone records access, not the employment relationship behind it.
    const [person] = await tx`
      SELECT id FROM personnel WHERE tenant_id = ${tenant.id} AND lower(email) = ${normalised}`;
    if (!person) {
      await tx`
        INSERT INTO personnel (tenant_id, user_id, full_name, email, role_title, status)
        VALUES (${tenant.id}, ${user?.id ?? null}, ${fullName || normalised}, ${normalised},
                ${jobTitle || null}, 'active')`;
    }

    await tx`
      INSERT INTO auth_events (event, email, tenant_id, detail)
      VALUES ('member.added', ${normalised}, ${tenant.id},
              ${tx.json({ role, via: 'add-member.mjs', status: user ? 'joined' : 'pending' })})`;
    return user ? 'joined' : 'pending';
  });

  console.log(
    status === 'joined'
      ? `\n${normalised} is now ${role} of ${tenant.name}.\n`
      : `\n${normalised} will join ${tenant.name} as ${role} the next time they open Trust.\n`,
  );
} catch (err) {
  console.error('\nFailed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
