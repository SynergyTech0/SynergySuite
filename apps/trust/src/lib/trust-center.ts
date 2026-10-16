// The public trust centre.
//
// This module is the ONLY place tenant data crosses into an unauthenticated surface, so it
// is written defensively: it builds the public payload explicitly, field by field, rather
// than filtering a richer object down. A deny-list is one forgotten field away from a leak;
// an allow-list is one forgotten field away from an omission.
//
// It runs on the owner connection because there is no session to scope to — the caller is
// an anonymous visitor. Every query therefore carries its own explicit tenant predicate,
// and the tenant is resolved from the public slug of an ENABLED trust centre, never from
// anything the visitor supplies directly.

import { sharedSql } from './queries';

export type PublicTrustCenter = {
  organisation: string;
  headline: string | null;
  intro: string | null;
  securityContact: string | null;
  updatedAt: Date;
  frameworks: { name: string; status: string; targetDate: string | null }[];
  controlSummary: { implemented: number; total: number } | null;
  policies: { title: string; approvedAt: Date | null }[];
  subprocessors: { name: string; category: string | null; processesPersonalData: boolean }[];
};

const STATUS_LABEL: Record<string, string> = {
  scoping: 'Scoping',
  implementing: 'Implementation in progress',
  audit_ready: 'Readiness complete, audit not yet begun',
  under_audit: 'Audit in progress',
  certified: 'Report issued',
  lapsed: 'Lapsed',
};

export async function publicTrustCenter(slug: string): Promise<PublicTrustCenter | null> {
  const sql = sharedSql();

  const [tc] = await sql<
    {
      tenant_id: string; organisation: string; headline: string | null; intro: string | null;
      security_contact: string | null; updated_at: Date;
      show_frameworks: boolean; show_control_counts: boolean;
      show_policies: boolean; show_subprocessors: boolean;
    }[]
  >`
    SELECT t.tenant_id, te.name AS organisation, t.headline, t.intro, t.security_contact,
           t.updated_at, t.show_frameworks, t.show_control_counts,
           t.show_policies, t.show_subprocessors
    FROM trust_centers t
    JOIN tenants te ON te.id = t.tenant_id
    WHERE t.public_slug = ${slug} AND t.enabled AND te.status = 'active'`;
  // A disabled trust centre is indistinguishable from one that does not exist. Saying
  // "this exists but is switched off" would confirm the organisation is a customer.
  if (!tc) return null;

  const frameworks = tc.show_frameworks
    ? (
        await sql<{ name: string; status: string; target_date: string | null }[]>`
          SELECT f.name, tf.status, tf.target_date
          FROM trust_center_frameworks tcf
          JOIN frameworks f ON f.id = tcf.framework_id
          JOIN tenant_frameworks tf
            ON tf.framework_id = tcf.framework_id AND tf.tenant_id = tcf.tenant_id
          WHERE tcf.tenant_id = ${tc.tenant_id}
          ORDER BY f.name`
      ).map((f) => ({
        name: f.name,
        status: STATUS_LABEL[f.status] ?? f.status,
        targetDate: f.target_date,
      }))
    : [];

  // A COUNT only. Which controls are outstanding is exactly the map an attacker wants, and
  // publishing it would make the trust centre a liability rather than an asset.
  let controlSummary: PublicTrustCenter['controlSummary'] = null;
  if (tc.show_control_counts) {
    const [row] = await sql<{ implemented: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'implemented')::int AS implemented,
             count(*) FILTER (WHERE status <> 'not_applicable')::int AS total
      FROM controls WHERE tenant_id = ${tc.tenant_id}`;
    controlSummary = { implemented: row.implemented, total: row.total };
  }

  // Titles and approval dates only. The body of a policy routinely names systems, people
  // and procedures, none of which belongs on a public page.
  const policies = tc.show_policies
    ? await sql<{ title: string; approvedAt: Date | null }[]>`
        SELECT p.title, pv.approved_at AS "approvedAt"
        FROM policies p
        LEFT JOIN LATERAL (
          SELECT approved_at FROM policy_versions v
          WHERE v.policy_id = p.id AND v.approved_at IS NOT NULL
          ORDER BY v.version DESC LIMIT 1
        ) pv ON true
        WHERE p.tenant_id = ${tc.tenant_id} AND p.status = 'approved'
        ORDER BY p.title`
    : [];

  // GDPR Art.28 expects a controller to be able to tell data subjects who processes their
  // data, so subprocessors are the one third-party detail it is right to publish.
  const subprocessors = tc.show_subprocessors
    ? await sql<{ name: string; category: string | null; processesPersonalData: boolean }[]>`
        SELECT name, category, processes_personal_data AS "processesPersonalData"
        FROM vendors
        WHERE tenant_id = ${tc.tenant_id} AND is_subprocessor
        ORDER BY name`
    : [];

  return {
    organisation: tc.organisation,
    headline: tc.headline,
    intro: tc.intro,
    securityContact: tc.security_contact,
    updatedAt: tc.updated_at,
    frameworks,
    controlSummary,
    policies,
    subprocessors,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Operator side
// ───────────────────────────────────────────────────────────────────────────

export type TrustCenterSettings = {
  enabled: boolean;
  public_slug: string;
  headline: string | null;
  intro: string | null;
  security_contact: string | null;
  show_frameworks: boolean;
  show_control_counts: boolean;
  show_policies: boolean;
  show_subprocessors: boolean;
  framework_ids: string[];
};

export async function getSettings(tenantId: string): Promise<TrustCenterSettings | null> {
  const sql = sharedSql();
  const [tc] = await sql<TrustCenterSettings[]>`
    SELECT enabled, public_slug, headline, intro, security_contact,
           show_frameworks, show_control_counts, show_policies, show_subprocessors
    FROM trust_centers WHERE tenant_id = ${tenantId}`;
  if (!tc) return null;
  const ids = await sql<{ framework_id: string }[]>`
    SELECT framework_id FROM trust_center_frameworks WHERE tenant_id = ${tenantId}`;
  return { ...tc, framework_ids: ids.map((r) => r.framework_id) };
}

export class TrustCenterError extends Error {}

export async function saveSettings(
  tenantId: string,
  patch: Partial<TrustCenterSettings>,
  actor: { userId: string; label: string },
) {
  const sql = sharedSql();

  if (patch.public_slug !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(patch.public_slug)) {
      throw new TrustCenterError(
        'public URL must be lowercase letters, digits and hyphens (3-50 characters)',
      );
    }
    const [clash] = await sql<{ tenant_id: string }[]>`
      SELECT tenant_id FROM trust_centers
      WHERE public_slug = ${patch.public_slug} AND tenant_id <> ${tenantId}`;
    if (clash) throw new TrustCenterError('that public URL is already taken');
  }

  const [existing] = await sql<{ tenant_id: string }[]>`
    SELECT tenant_id FROM trust_centers WHERE tenant_id = ${tenantId}`;
  if (!existing) {
    if (!patch.public_slug) {
      throw new TrustCenterError('a public URL is required to create a trust centre');
    }
    await sql`
      INSERT INTO trust_centers (tenant_id, public_slug, updated_by)
      VALUES (${tenantId}, ${patch.public_slug}, ${actor.userId})`;
  }

  await sql`
    UPDATE trust_centers SET
      enabled             = ${patch.enabled === undefined ? sql`enabled` : patch.enabled},
      public_slug         = ${patch.public_slug === undefined ? sql`public_slug` : patch.public_slug},
      headline            = ${patch.headline === undefined ? sql`headline` : patch.headline},
      intro               = ${patch.intro === undefined ? sql`intro` : patch.intro},
      security_contact    = ${patch.security_contact === undefined ? sql`security_contact` : patch.security_contact},
      show_frameworks     = ${patch.show_frameworks === undefined ? sql`show_frameworks` : patch.show_frameworks},
      show_control_counts = ${patch.show_control_counts === undefined ? sql`show_control_counts` : patch.show_control_counts},
      show_policies       = ${patch.show_policies === undefined ? sql`show_policies` : patch.show_policies},
      show_subprocessors  = ${patch.show_subprocessors === undefined ? sql`show_subprocessors` : patch.show_subprocessors},
      updated_by          = ${actor.userId},
      updated_at          = now()
    WHERE tenant_id = ${tenantId}`;

  if (patch.framework_ids) {
    await sql`DELETE FROM trust_center_frameworks WHERE tenant_id = ${tenantId}`;
    for (const id of patch.framework_ids) {
      // Only frameworks the tenant has actually adopted may be published, so a trust centre
      // cannot advertise work that was never started.
      await sql`
        INSERT INTO trust_center_frameworks (tenant_id, framework_id)
        SELECT ${tenantId}, ${id}
        WHERE EXISTS (SELECT 1 FROM tenant_frameworks
                      WHERE tenant_id = ${tenantId} AND framework_id = ${id})
        ON CONFLICT DO NOTHING`;
    }
  }

  // Publishing is an outward-facing change, so it is recorded as one.
  await sql`
    INSERT INTO audit_events
      (tenant_id, actor_user_id, actor_label, action, object_type, object_id, payload)
    VALUES (${tenantId}, ${actor.userId}, ${actor.label}, 'trust_center.updated',
            'trust_center', ${tenantId}, ${sql.json(patch as Record<string, never>)})`;

  return getSettings(tenantId);
}
