// Read and write paths for the app. Every query runs through withTenant(), so RLS applies.

import type { Sql } from 'postgres';
import { adminSql, withTenant } from './db.mjs';

// Evidence older than this no longer supports an "audit ready" claim. SOC 2 Type II opines
// on operating effectiveness across a window, so a control implemented two years ago with
// nothing collected since is implemented but not evidenced - a distinction the UI keeps.
export const EVIDENCE_WINDOW_DAYS = 90;

// One pool for the process. Cached on globalThis so dev HMR does not leak pools.
const g = globalThis as unknown as { __strustPool?: Sql };
function pool(): Sql {
  return (g.__strustPool ??= adminSql({ max: 8 }));
}

/**
 * The shared pool, for callers that need the connection itself rather than a tenant-scoped
 * transaction (the collection runner opens its own scoped transactions internally).
 * Anything serving a request must still go through tx()/withTenant().
 */
export const sharedSql = pool;

/**
 * The tenant a query runs in, and whether the caller may write. Every exported query takes
 * this rather than a bare tenant id, so an auditor or viewer seat runs its READS through the
 * read-only Postgres role too — not merely having its writes refused by app code.
 */
export type TenantCtx = { tenantId: string; readOnly: boolean };

export function tx<T>(
  ctx: TenantCtx,
  fn: (t: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>,
) {
  return withTenant(pool(), ctx.tenantId, fn, { readOnly: ctx.readOnly });
}

// ---------------------------------------------------------------------------
// Requirement status — the single source the dashboard and detail pages share
// ---------------------------------------------------------------------------

export type ReqStatus =
  | 'implemented'
  | 'partial'
  | 'mapped_only'
  | 'unmapped'
  | 'not_applicable';

export type RequirementRow = {
  requirement_id: string;
  framework_key: string;
  framework_name: string;
  requirement_key: string;
  title: string;
  text: string;
  obligation: 'required' | 'addressable' | 'optional';
  section_key: string;
  section_title: string;
  root_key: string;
  root_title: string;
  ordinal: number;
  mapped: number;
  implemented: number;
  na: number;
  status: ReqStatus;
  latest_evidence: Date | null;
  audit_ready: boolean;
};

/**
 * In-scope requirements for the tenant, each with its derived implementation status.
 *
 * "In scope" means the requirement's top-level category is either non-selectable (SOC 2's
 * Common Criteria, ISO's clauses and Annex A) or has been explicitly selected into scope.
 * Counting optional categories nobody committed to would make every percentage meaningless.
 *
 * Only frameworks the tenant has actually adopted are returned.
 */
export async function requirementStatuses(
  ctx: TenantCtx,
  frameworkKey?: string,
): Promise<RequirementRow[]> {
  return tx(ctx, async (t) => {
    const rows = await t<RequirementRow[]>`
      WITH RECURSIVE roots AS (
        SELECT id, framework_id, id AS root_id, selectable
        FROM framework_sections WHERE parent_id IS NULL
        UNION ALL
        SELECT s.id, s.framework_id, r.root_id, r.selectable
        FROM framework_sections s JOIN roots r ON s.parent_id = r.id
      ),
      in_scope AS (
        SELECT q.id, q.framework_id, q.key, q.title, q.text, q.obligation, q.ordinal,
               q.section_id, ro.root_id
        FROM requirements q
        JOIN roots ro ON ro.id = q.section_id
        -- adopted frameworks only; tenant_frameworks is RLS-scoped
        WHERE EXISTS (SELECT 1 FROM tenant_frameworks tf WHERE tf.framework_id = q.framework_id)
          AND (
            ro.selectable = false
            OR EXISTS (
              SELECT 1 FROM tenant_framework_scope tfs
              JOIN tenant_frameworks tf2 ON tf2.id = tfs.tenant_framework_id
              WHERE tfs.section_id = ro.root_id AND tf2.framework_id = q.framework_id
            )
          )
      ),
      ev AS (
        SELECT control_id, max(collected_at) AS latest FROM evidence GROUP BY control_id
      ),
      agg AS (
        SELECT s.id AS requirement_id,
               count(m.control_id)                                               AS mapped,
               count(*) FILTER (WHERE c.status = 'implemented')                   AS implemented,
               count(*) FILTER (WHERE c.status = 'implemented' AND m.coverage = 'full')
                                                                                  AS full_impl,
               count(*) FILTER (WHERE c.status = 'not_applicable')                AS na,
               max(ev.latest)                                                     AS latest_evidence
        FROM in_scope s
        LEFT JOIN control_requirement_map m ON m.requirement_id = s.id
        LEFT JOIN controls c ON c.id = m.control_id
        LEFT JOIN ev ON ev.control_id = m.control_id
        GROUP BY s.id
      )
      SELECT s.id                AS requirement_id,
             f.key               AS framework_key,
             f.name              AS framework_name,
             s.key               AS requirement_key,
             s.title, s.text, s.obligation, s.ordinal,
             sec.key             AS section_key,
             sec.title           AS section_title,
             root.key            AS root_key,
             root.title          AS root_title,
             a.mapped::int, a.implemented::int, a.na::int,
             a.latest_evidence,
             CASE
               -- A requirement every mapped control declares inapplicable is N/A, not a gap.
               -- The constraint on controls.na_rationale guarantees each one is justified.
               WHEN a.mapped > 0 AND a.na = a.mapped          THEN 'not_applicable'
               WHEN a.mapped = 0                              THEN 'unmapped'
               -- 'implemented' requires an implemented control with FULL coverage. Several
               -- partial controls can leave a real gap, so they never add up to done.
               WHEN a.full_impl > 0                           THEN 'implemented'
               WHEN a.implemented > 0                         THEN 'partial'
               ELSE                                                'mapped_only'
             END AS status,
             (a.full_impl > 0
               AND a.latest_evidence IS NOT NULL
               AND a.latest_evidence > now() - ${`${EVIDENCE_WINDOW_DAYS} days`}::interval
             ) AS audit_ready
      FROM in_scope s
      JOIN agg a       ON a.requirement_id = s.id
      JOIN frameworks f ON f.id = s.framework_id
      JOIN framework_sections sec  ON sec.id = s.section_id
      JOIN framework_sections root ON root.id = s.root_id
      ${frameworkKey ? t`WHERE f.key = ${frameworkKey}` : t``}
      ORDER BY f.key, root.key, sec.ordinal, s.ordinal`;
    return rows;
  });
}

export type FrameworkSummary = {
  framework_key: string;
  framework_name: string;
  status: string;
  target_date: string | null;
  scope_note: string | null;
  total: number;
  counts: Record<ReqStatus, number>;
  audit_ready: number;
  /** Fraction implemented. The headline figure people quote. */
  implemented_pct: number;
  /** Fraction implemented AND evidenced inside the window. The figure that survives an audit. */
  audit_ready_pct: number;
};

export async function frameworkSummaries(ctx: TenantCtx): Promise<FrameworkSummary[]> {
  const [rows, adopted] = await Promise.all([
    requirementStatuses(ctx),
    tx(ctx, (t) => t<
      { key: string; name: string; status: string; target_date: string | null; scope_note: string | null }[]
    >`
      SELECT f.key, f.name, tf.status, tf.target_date, tf.scope_note
      FROM tenant_frameworks tf JOIN frameworks f ON f.id = tf.framework_id
      ORDER BY f.key`),
  ]);

  // Summaries are folded from the very rows the detail pages render, so a headline number
  // and the page behind it cannot drift apart.
  return adopted.map((a) => {
    const mine = rows.filter((r) => r.framework_key === a.key);
    const counts: Record<ReqStatus, number> = {
      implemented: 0, partial: 0, mapped_only: 0, unmapped: 0, not_applicable: 0,
    };
    let auditReady = 0;
    for (const r of mine) {
      counts[r.status]++;
      if (r.audit_ready) auditReady++;
    }
    // N/A requirements leave the denominator: a control you justifiably do not need should
    // neither help nor hurt the score.
    const denom = mine.length - counts.not_applicable;
    return {
      framework_key: a.key,
      framework_name: a.name,
      status: a.status,
      target_date: a.target_date,
      scope_note: a.scope_note,
      total: mine.length,
      counts,
      audit_ready: auditReady,
      implemented_pct: denom ? counts.implemented / denom : 0,
      audit_ready_pct: denom ? auditReady / denom : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export type ControlRow = {
  id: string;
  key: string;
  title: string;
  objective: string;
  category: string | null;
  status: 'not_started' | 'in_progress' | 'implemented' | 'not_applicable';
  na_rationale: string | null;
  notes: string | null;
  owner_name: string | null;
  mapped_requirements: number;
  frameworks: string[];
  evidence_count: number;
  latest_evidence: Date | null;
  monitor_count: number;
};

export async function controls(ctx: TenantCtx): Promise<ControlRow[]> {
  return tx(ctx, (t) => t<ControlRow[]>`
    SELECT c.id, c.key, c.title, c.objective, c.status, c.na_rationale, c.notes,
           ct.category,
           u.name AS owner_name,
           (SELECT count(*) FROM control_requirement_map m WHERE m.control_id = c.id)::int
             AS mapped_requirements,
           COALESCE((
             SELECT array_agg(DISTINCT f.key ORDER BY f.key)
             FROM control_requirement_map m
             JOIN requirements r ON r.id = m.requirement_id
             JOIN frameworks f ON f.id = r.framework_id
             WHERE m.control_id = c.id
           ), '{}') AS frameworks,
           (SELECT count(*) FROM evidence e WHERE e.control_id = c.id)::int AS evidence_count,
           (SELECT max(e.collected_at) FROM evidence e WHERE e.control_id = c.id)
             AS latest_evidence,
           (SELECT count(*) FROM monitors mo WHERE mo.control_id = c.id AND mo.enabled)::int
             AS monitor_count
    FROM controls c
    LEFT JOIN control_templates ct ON ct.id = c.template_id
    LEFT JOIN users u ON u.id = c.owner_user_id
    ORDER BY ct.category NULLS LAST, c.key`);
}

export type ControlDetail = {
  control: ControlRow & { guidance: string | null };
  mappings: {
    framework_key: string;
    framework_name: string;
    requirement_key: string;
    requirement_title: string;
    obligation: string;
    coverage: 'full' | 'partial' | 'supporting';
    rationale: string | null;
  }[];
  evidence: {
    id: string;
    kind: string;
    title: string;
    collected_at: Date;
    collector: string | null;
    collector_version: string | null;
    content_hash: string;
  }[];
  monitors: {
    id: string;
    key: string;
    title: string;
    kind: string;
    severity: string;
    enabled: boolean;
    last_status: string | null;
    last_run: Date | null;
    last_message: string | null;
  }[];
};

export async function controlDetail(
  ctx: TenantCtx,
  key: string,
): Promise<ControlDetail | null> {
  return tx(ctx, async (t) => {
    const [control] = await t<(ControlRow & { guidance: string | null })[]>`
      SELECT c.id, c.key, c.title, c.objective, c.status, c.na_rationale, c.notes,
             ct.category, ct.guidance,
             u.name AS owner_name,
             (SELECT count(*) FROM control_requirement_map m WHERE m.control_id = c.id)::int
               AS mapped_requirements,
             COALESCE((
               SELECT array_agg(DISTINCT f.key ORDER BY f.key)
               FROM control_requirement_map m
               JOIN requirements r ON r.id = m.requirement_id
               JOIN frameworks f ON f.id = r.framework_id
               WHERE m.control_id = c.id
             ), '{}') AS frameworks,
             (SELECT count(*) FROM evidence e WHERE e.control_id = c.id)::int AS evidence_count,
             (SELECT max(e.collected_at) FROM evidence e WHERE e.control_id = c.id)
               AS latest_evidence,
             (SELECT count(*) FROM monitors mo WHERE mo.control_id = c.id AND mo.enabled)::int
               AS monitor_count
      FROM controls c
      LEFT JOIN control_templates ct ON ct.id = c.template_id
      LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.key = ${key}`;
    if (!control) return null;

    const [mappings, evidence, monitors] = await Promise.all([
      t<ControlDetail['mappings']>`
        SELECT f.key AS framework_key, f.name AS framework_name,
               r.key AS requirement_key, r.title AS requirement_title,
               r.obligation, m.coverage, m.rationale
        FROM control_requirement_map m
        JOIN requirements r ON r.id = m.requirement_id
        JOIN frameworks f ON f.id = r.framework_id
        WHERE m.control_id = ${control.id}
        ORDER BY f.key, r.ordinal`,
      t<ControlDetail['evidence']>`
        SELECT id, kind, title, collected_at, collector, collector_version, content_hash
        FROM evidence WHERE control_id = ${control.id}
        ORDER BY collected_at DESC LIMIT 50`,
      t<ControlDetail['monitors']>`
        SELECT mo.id, mo.key, mo.title, mo.kind, mo.severity, mo.enabled,
               lr.status AS last_status, lr.started_at AS last_run, lr.message AS last_message
        FROM monitors mo
        LEFT JOIN LATERAL (
          SELECT status, started_at, message FROM monitor_runs mr
          WHERE mr.monitor_id = mo.id ORDER BY mr.started_at DESC LIMIT 1
        ) lr ON true
        WHERE mo.control_id = ${control.id}
        ORDER BY mo.key`,
    ]);

    return { control, mappings, evidence, monitors };
  });
}

const CONTROL_STATUSES = ['not_started', 'in_progress', 'implemented', 'not_applicable'] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export type ControlPatch = {
  status?: ControlStatus;
  na_rationale?: string | null;
  notes?: string | null;
};

export class ValidationError extends Error {}

/**
 * Updates a control and records the change in the hash-chained audit log, in one
 * transaction. A status change that is not auditable is not much use in a tool whose whole
 * value is an auditable record, so the two commit together or not at all.
 */
export async function updateControl(
  ctx: TenantCtx,
  key: string,
  patch: ControlPatch,
  actor: { userId: string; label: string },
): Promise<ControlRow> {
  if (patch.status && !CONTROL_STATUSES.includes(patch.status)) {
    throw new ValidationError(
      `status must be one of ${CONTROL_STATUSES.join(', ')} (got '${patch.status}')`,
    );
  }
  // Caught by a CHECK constraint too; rejecting here turns a 500 into a usable 400.
  if (patch.status === 'not_applicable' && !(patch.na_rationale ?? '').trim()) {
    throw new ValidationError(
      'marking a control not_applicable requires na_rationale — an unjustified N/A is the ' +
        'most common first-audit finding',
    );
  }

  return tx(ctx, async (t) => {
    const [before] = await t<{ id: string; status: string }[]>`
      SELECT id, status FROM controls WHERE key = ${key}`;
    if (!before) throw new ValidationError(`no control with key '${key}'`);

    const [after] = await t<{ id: string; status: string }[]>`
      UPDATE controls SET
        status       = COALESCE(${patch.status ?? null}, status),
        na_rationale = ${patch.na_rationale === undefined ? t`na_rationale` : patch.na_rationale},
        notes        = ${patch.notes === undefined ? t`notes` : patch.notes},
        updated_at   = now()
      WHERE id = ${before.id}
      RETURNING id, status`;

    // The acting user is named, not merely the surface the change arrived through. An audit
    // trail that records "api" rather than a person answers none of the questions an
    // auditor asks of it.
    await t`
      INSERT INTO audit_events
        (tenant_id, actor_user_id, actor_label, action, object_type, object_id, payload)
      VALUES (
        ${ctx.tenantId}, ${actor.userId}, ${actor.label}, 'control.updated', 'control', ${key},
        ${t.json({ from: before.status, to: after.status, patch })})`;

    const [row] = await t<ControlRow[]>`
      SELECT c.id, c.key, c.title, c.objective, c.status, c.na_rationale, c.notes,
             ct.category, u.name AS owner_name,
             (SELECT count(*) FROM control_requirement_map m WHERE m.control_id = c.id)::int
               AS mapped_requirements,
             COALESCE((SELECT array_agg(DISTINCT f.key ORDER BY f.key)
                       FROM control_requirement_map m
                       JOIN requirements r ON r.id = m.requirement_id
                       JOIN frameworks f ON f.id = r.framework_id
                       WHERE m.control_id = c.id), '{}') AS frameworks,
             (SELECT count(*) FROM evidence e WHERE e.control_id = c.id)::int AS evidence_count,
             (SELECT max(e.collected_at) FROM evidence e WHERE e.control_id = c.id) AS latest_evidence,
             (SELECT count(*) FROM monitors mo WHERE mo.control_id = c.id AND mo.enabled)::int
               AS monitor_count
      FROM controls c
      LEFT JOIN control_templates ct ON ct.id = c.template_id
      LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.id = ${before.id}`;
    return row;
  });
}

// ---------------------------------------------------------------------------
// Evidence, monitors, audit trail
// ---------------------------------------------------------------------------

export async function evidenceLedger(ctx: TenantCtx, limit = 100) {
  return tx(ctx, (t) => t<
    {
      id: string; kind: string; title: string; collected_at: Date; collector: string | null;
      collector_version: string | null; content_hash: string; control_key: string | null;
      control_title: string | null; supersedes_id: string | null;
    }[]
  >`
    SELECT e.id, e.kind, e.title, e.collected_at, e.collector, e.collector_version,
           e.content_hash, e.supersedes_id, c.key AS control_key, c.title AS control_title
    FROM evidence e LEFT JOIN controls c ON c.id = e.control_id
    ORDER BY e.collected_at DESC LIMIT ${limit}`);
}

export async function monitorHealth(ctx: TenantCtx) {
  return tx(ctx, (t) => t<
    {
      id: string; key: string; title: string; kind: string; severity: string; enabled: boolean;
      schedule: string; control_key: string; control_title: string;
      last_status: string | null; last_run: Date | null;
      last_message: string | null; runs_30d: number; fails_30d: number; errors_30d: number;
      next_due_at: Date | null; is_due: boolean; config: Record<string, unknown>;
    }[]
  >`
    SELECT mo.id, mo.key, mo.title, mo.kind, mo.severity, mo.enabled, mo.schedule, mo.config,
           c.key AS control_key, c.title AS control_title,
           lr.status AS last_status, lr.started_at AS last_run, lr.message AS last_message,
           -- Same cadence arithmetic the --due runner uses, so the UI and the scheduler
           -- cannot disagree about whether something has been collected recently enough.
           (lr.started_at + CASE mo.schedule
              WHEN 'hourly'  THEN interval '1 hour'
              WHEN 'daily'   THEN interval '1 day'
              WHEN 'weekly'  THEN interval '7 days'
              WHEN 'monthly' THEN interval '30 days'
              ELSE interval '1 day' END) AS next_due_at,
           (lr.started_at IS NULL OR lr.started_at < now() - CASE mo.schedule
              WHEN 'hourly'  THEN interval '1 hour'
              WHEN 'daily'   THEN interval '1 day'
              WHEN 'weekly'  THEN interval '7 days'
              WHEN 'monthly' THEN interval '30 days'
              ELSE interval '1 day' END) AS is_due,
           (SELECT count(*) FROM monitor_runs r
             WHERE r.monitor_id = mo.id AND r.started_at > now() - interval '30 days')::int
             AS runs_30d,
           (SELECT count(*) FROM monitor_runs r
             WHERE r.monitor_id = mo.id AND r.status = 'fail'
               AND r.started_at > now() - interval '30 days')::int AS fails_30d,
           (SELECT count(*) FROM monitor_runs r
             WHERE r.monitor_id = mo.id AND r.status = 'error'
               AND r.started_at > now() - interval '30 days')::int AS errors_30d
    FROM monitors mo
    JOIN controls c ON c.id = mo.control_id
    LEFT JOIN LATERAL (
      SELECT status, started_at, message FROM monitor_runs mr
      WHERE mr.monitor_id = mo.id ORDER BY mr.started_at DESC LIMIT 1
    ) lr ON true
    ORDER BY mo.key`);
}

export async function monitorRuns(ctx: TenantCtx, monitorKey: string, limit = 60) {
  return tx(ctx, (t) => t<
    { id: string; status: string; started_at: Date; finished_at: Date | null; message: string | null; observed: unknown }[]
  >`
    SELECT r.id, r.status, r.started_at, r.finished_at, r.message, r.observed
    FROM monitor_runs r JOIN monitors mo ON mo.id = r.monitor_id
    WHERE mo.key = ${monitorKey}
    ORDER BY r.started_at DESC LIMIT ${limit}`);
}

export async function auditTrail(ctx: TenantCtx, limit = 100) {
  return tx(ctx, async (t) => {
    const [events, broken] = await Promise.all([
      t<
        { seq: string; action: string; object_type: string; object_id: string | null;
          actor_label: string | null; actor_name: string | null; payload: unknown;
          hash: string; prev_hash: string | null; created_at: Date }[]
      >`
        SELECT a.seq, a.action, a.object_type, a.object_id, a.actor_label,
               u.name AS actor_name, a.payload, a.hash, a.prev_hash, a.created_at
        FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.seq DESC LIMIT ${limit}`,
      // Recomputes the whole chain. Showing a verified-intact badge without re-deriving it
      // would be the same unverified claim this product exists to stop people making.
      t<{ broken_at: string; expected: string; found: string }[]>`
        SELECT * FROM verify_audit_chain(${ctx.tenantId})`,
    ]);
    return { events, intact: broken.length === 0, break: broken[0] ?? null };
  });
}

export async function dashboard(ctx: TenantCtx) {
  const [frameworks, mon, evidence, audit] = await Promise.all([
    frameworkSummaries(ctx),
    monitorHealth(ctx),
    evidenceLedger(ctx, 8),
    auditTrail(ctx, 8),
  ]);
  return { frameworks, monitors: mon, evidence, audit };
}
