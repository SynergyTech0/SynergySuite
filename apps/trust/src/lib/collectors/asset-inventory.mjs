// Collector: asset_inventory
//
// ISO A.5.9 does not ask for a list of systems. It asks for an inventory of information and
// associated assets "including owners" — and the HIPAA risk analysis is only as complete as
// the inventory it was run against. So a list on its own does not satisfy anything.
//
// This checks the two properties that make an inventory usable:
//
//   OWNERSHIP  An asset with no owner has nobody to answer for its classification, its
//              patching, or its access review. It is the asset most likely to be the one
//              nobody noticed was exposed.
//   FRESHNESS  An inventory that stopped being refreshed is a snapshot of a system that no
//              longer exists, and it decays silently — nothing breaks, it just stops being
//              true.
//
// It will fail on a freshly imported inventory, because imported assets have no owner. That
// is correct and it is the point: the import is the easy half.

import { createHash } from 'node:crypto';
import { PHI_NAME_PATTERN } from '../phi-names.mjs';

export const kind = 'asset_inventory';
export const version = '0.1.0';
export const title = 'Asset inventory is complete, owned and current';
export const description =
  'Checks the tenant asset register for coverage, named owners and freshness. An inventory without owners does not satisfy ISO A.5.9, and a stale one quietly stops describing the estate.';
export const defaultSeverity = 'high';
export const requiresHostAccess = false;
export const selfReferential = true;
export const suggestedControls = ['DP-ASSET-INVENTORY', 'GOV-RISK-ASSESSMENT'];

export function validateConfig(config) {
  if (config && typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  const days = config?.max_age_days ?? 90;
  if (typeof days !== 'number' || days <= 0) {
    return { ok: false, reason: 'max_age_days must be a positive number' };
  }
  const min = config?.min_assets ?? 1;
  if (typeof min !== 'number' || min < 1) {
    return { ok: false, reason: 'min_assets must be at least 1' };
  }
  // Kinds that must carry an owner. Defaults to everything of consequence.
  if (config?.owned_kinds !== undefined && !Array.isArray(config.owned_kinds)) {
    return { ok: false, reason: 'owned_kinds must be an array of asset kinds' };
  }
  return { ok: true };
}

export async function run(config, ctx) {
  if (!ctx?.sql || !ctx?.tenantId) {
    return { status: 'error', message: 'collector was not given a database context', observed: {} };
  }
  const maxAgeDays = config?.max_age_days ?? 90;
  const minAssets = config?.min_assets ?? 1;
  const ownedKinds = config?.owned_kinds ?? ['database', 'host', 'endpoint'];

  const assets = await ctx.sql`
    SELECT a.key, a.name, a.kind, a.classification, a.created_at,
           (a.owner_user_id IS NOT NULL) AS has_owner
    FROM assets a WHERE a.tenant_id = ${ctx.tenantId}`;

  // An empty register is not a pass. "All zero assets have owners" is true and worthless.
  if (assets.length < minAssets) {
    const observed = { total: assets.length, min_assets: minAssets, checked_at: new Date().toISOString() };
    return {
      status: 'error',
      message:
        assets.length === 0
          ? 'the asset register is empty — nothing to measure, and an empty register is not evidence of a small estate'
          : `only ${assets.length} asset(s) recorded, below the minimum of ${minAssets}`,
      observed,
      content_hash: hash(observed),
    };
  }

  const inScope = assets.filter((a) => ownedKinds.includes(a.kind));
  const unowned = inScope.filter((a) => !a.has_owner);
  const restricted = assets.filter((a) => a.classification === 'restricted');
  const restrictedUnowned = restricted.filter((a) => !a.has_owner);

  // Freshness measured from the newest row: a register nobody has added to in months is
  // either a perfectly static estate or an abandoned process, and the second is far likelier.
  const newest = assets.reduce(
    (max, a) => (new Date(a.created_at) > max ? new Date(a.created_at) : max),
    new Date(0),
  );
  const ageDays = (Date.now() - newest.getTime()) / 86_400_000;

  const byKind = {};
  const byClass = {};
  for (const a of assets) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    byClass[a.classification] = (byClass[a.classification] ?? 0) + 1;
  }

  // Ownership CONCENTRATION travels with the evidence. One person owning the whole estate
  // satisfies A.5.9 and is simultaneously a key-person dependency with no segregation of
  // duties (A.5.3, CC6.3). Recording it here means the control passes honestly rather than
  // passing in a way that hides the thing an assessor will ask about first.
  const ownerCounts = await ctx.sql`
    SELECT u.email, count(*)::int AS owned
    FROM assets a JOIN users u ON u.id = a.owner_user_id
    WHERE a.tenant_id = ${ctx.tenantId}
    GROUP BY u.email ORDER BY owned DESC`;
  const topShare = ownerCounts.length
    ? ownerCounts[0].owned / assets.filter((a) => a.has_owner).length
    : 0;

  const observed = {
    total: assets.length,
    by_kind: byKind,
    by_classification: byClass,
    owned_kinds: ownedKinds,
    in_scope_for_ownership: inScope.length,
    unowned_count: unowned.length,
    // Named, not just counted: an auditor sampling this needs to pick rows.
    unowned_sample: unowned.slice(0, 15).map((a) => ({ key: a.key, kind: a.kind, classification: a.classification })),
    restricted_total: restricted.length,
    restricted_unowned: restrictedUnowned.map((a) => a.key),
    newest_entry_age_days: Number(ageDays.toFixed(1)),
    max_age_days: maxAgeDays,
    distinct_owners: ownerCounts.length,
    ownership_concentration: Object.fromEntries(ownerCounts.map((o) => [o.email, o.owned])),
    single_owner_dependency: ownerCounts.length === 1 && assets.length > 10,
    largest_owner_share: Number((topShare * 100).toFixed(0)),
    checked_at: new Date().toISOString(),
  };

  // Standing check for the gap that had to be found by hand once: an asset whose NAME
  // suggests regulated data but whose classification does not. That is worse than an
  // unowned asset — it is owned, it looks handled, and the safeguards it needs were never
  // scoped.
  const suspects = await ctx.sql`
    SELECT key, name, classification FROM assets
    WHERE tenant_id = ${ctx.tenantId} AND classification <> 'restricted'
      AND name ~* ${PHI_NAME_PATTERN}
    ORDER BY name`;
  observed.phi_suspect_not_restricted = suspects.map((x) => ({
    key: x.key, classification: x.classification,
  }));

  const problems = [];
  if (suspects.length) {
    problems.push(
      `${suspects.length} asset(s) have PHI-suggestive names but are not classified restricted: ` +
        suspects.slice(0, 5).map((x) => `${x.name} (${x.classification})`).join(', '),
    );
  }
  if (unowned.length) {
    const pct = Math.round((unowned.length / inScope.length) * 100);
    problems.push(
      `${unowned.length} of ${inScope.length} in-scope assets (${pct}%) have no named owner`,
    );
  }
  // Called out separately: an unowned asset holding regulated data is the worst case.
  if (restrictedUnowned.length) {
    problems.push(
      `${restrictedUnowned.length} RESTRICTED asset(s) have no owner: ${restrictedUnowned
        .map((a) => a.key)
        .join(', ')}`,
    );
  }
  if (ageDays > maxAgeDays) {
    problems.push(`newest entry is ${ageDays.toFixed(0)}d old (limit ${maxAgeDays}d) — the register may have stopped being refreshed`);
  }

  return {
    status: problems.length ? 'fail' : 'pass',
    message: problems.length
      ? problems.join('; ')
      : `${assets.length} assets inventoried, all ${inScope.length} in-scope assets owned, ` +
        `newest entry ${ageDays.toFixed(0)}d old` +
        (observed.single_owner_dependency
          ? ` — note: one person owns all of them, a key-person dependency an assessor will raise`
          : ` across ${ownerCounts.length} owners`),
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
