// Assigns owners to assets.
//
//   node scripts/assign-asset-owners.mjs --owner you@example.com [--apply] <tenant-slug>
//   node scripts/assign-asset-owners.mjs --rules rules.json --apply <tenant-slug>
//
// ISO A.5.9 wants an inventory "including owners" — a named person accountable for each
// asset's classification, patching and access. This records that.
//
// WHAT IT WILL NOT DO
//
// It will not invent an owner. If an asset genuinely has nobody accountable for it, the
// honest record is that it has nobody, and the collector should keep failing until a person
// is named. Assigning a placeholder to turn a control green is the exact failure this
// product exists to prevent.
//
// A rules file maps patterns to owners, so a growing team can divide the estate:
//   [{ "match": "emr|clinical|phi", "owner": "clinical-lead@example.com" },
//    { "match": "^db:",             "owner": "platform@example.com" }]
// First matching rule wins; anything unmatched falls to --owner, or is left unowned if none.

import { readFileSync } from 'node:fs';
import { adminSql } from '../src/lib/db.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ownerEmail = args.includes('--owner') ? args[args.indexOf('--owner') + 1] : null;
const rulesPath = args.includes('--rules') ? args[args.indexOf('--rules') + 1] : null;
const slug =
  args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--owner' && args[i - 1] !== '--rules');

if (!slug) {
  console.error('Name the organisation: node scripts/assign-asset-owners.mjs --owner <email> <tenant-slug>');
  process.exit(2);
}
if (!ownerEmail && !rulesPath) {
  console.error('Need --owner <email> and/or --rules <file>.');
  process.exit(2);
}

const sql = adminSql({ max: 1 });

try {
  const [tenant] = await sql`SELECT id, name FROM tenants WHERE slug = ${slug}`;
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);

  // Owners must be members of the tenant. An "owner" who cannot sign in and has no
  // relationship to the organisation is a name in a field, not accountability.
  // A suspended account is excluded because that person has been removed from the
  // organisation. Someone added by email who has not opened Trust yet is not a member until
  // they do; add them with scripts/add-member.mjs after their first visit, or wait.
  const members = await sql`
    SELECT u.id, lower(u.email) AS email, u.name, m.role, u.status
    FROM tenant_members m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenant.id} AND u.status <> 'suspended'`;
  const byEmail = new Map(members.map((m) => [m.email, m]));

  const rules = rulesPath ? JSON.parse(readFileSync(rulesPath, 'utf8')) : [];
  for (const r of rules) {
    if (!byEmail.has(String(r.owner).toLowerCase())) {
      throw new Error(`rule owner '${r.owner}' is not a member of ${tenant.name}`);
    }
  }
  const fallback = ownerEmail ? byEmail.get(ownerEmail.toLowerCase()) : null;
  if (ownerEmail && !fallback) {
    throw new Error(
      `'${ownerEmail}' is not a member of ${tenant.name}. ` +
        `Members: ${[...byEmail.keys()].join(', ') || '(none)'}`,
    );
  }

  const assets = await sql`
    SELECT key, name, kind, classification, owner_user_id
    FROM assets WHERE tenant_id = ${tenant.id} ORDER BY key`;

  const plan = [];
  for (const a of assets) {
    if (a.owner_user_id) continue; // never reassign an existing decision
    const rule = rules.find((r) => new RegExp(r.match, 'i').test(`${a.key} ${a.name}`));
    const owner = rule ? byEmail.get(String(rule.owner).toLowerCase()) : fallback;
    if (owner) plan.push({ asset: a, owner, via: rule ? `rule /${rule.match}/` : 'fallback' });
  }

  const perOwner = {};
  for (const p of plan) perOwner[p.owner.email] = (perOwner[p.owner.email] ?? 0) + 1;

  console.log(`\n${tenant.name}: ${assets.length} assets, ${plan.length} to assign\n`);
  for (const [email, n] of Object.entries(perOwner)) {
    const m = byEmail.get(email);
    const pending = m?.status !== 'active' ? '  (not active)' : '';
    console.log(`  ${email.padEnd(34)} ${String(n).padStart(3)} asset(s)${pending}`);
  }
  const unassignable = assets.filter((a) => !a.owner_user_id).length - plan.length;
  if (unassignable > 0) {
    console.log(`\n  ${unassignable} asset(s) match no rule and have no fallback — left UNOWNED.`);
    console.log('  That is deliberate: an unowned asset should keep failing the control until');
    console.log('  a person is actually named for it.');
  }

  if (!APPLY) {
    console.log('\n  (dry run — re-run with --apply)\n');
  } else {
    for (const p of plan) {
      await sql`
        UPDATE assets SET owner_user_id = ${p.owner.id}
        WHERE tenant_id = ${tenant.id} AND key = ${p.asset.key} AND owner_user_id IS NULL`;
    }
    await sql`
      INSERT INTO audit_events (tenant_id, actor_label, action, object_type, object_id, payload)
      VALUES (${tenant.id}, 'operator:assign-asset-owners', 'asset.owner_assigned', 'asset',
              'bulk', ${sql.json({ assigned: plan.length, per_owner: perOwner })})`;
    console.log(`\n  ${plan.length} assigned.\n`);
  }

  // Concentration is reported whether or not anything was assigned. One person owning the
  // whole estate satisfies A.5.9 and simultaneously IS a finding: no segregation of duties
  // (A.5.3, CC6.3) and a key-person dependency. Better that this product says so than that
  // an assessor discovers it.
  const [{ owners }] = await sql`
    SELECT count(DISTINCT owner_user_id)::int AS owners
    FROM assets WHERE tenant_id = ${tenant.id} AND owner_user_id IS NOT NULL`;
  if (owners === 1 && assets.length > 10) {
    console.log('  NOTE: a single person now owns every asset. That satisfies the inventory');
    console.log('  requirement and is accurate for a sole-operator organisation, but an');
    console.log('  assessor will read it as a key-person dependency with no segregation of');
    console.log('  duties (ISO A.5.3, SOC 2 CC6.3). Worth recording as an accepted risk with');
    console.log('  a named rationale rather than leaving it to be raised as a finding.\n');
  }
} catch (err) {
  console.error('\nFailed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
