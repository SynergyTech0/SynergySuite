// Collector: audit_integrity
//
// Recomputes the tenant's hash chain, and checks that the log is still being written to.
//
// TWO FAILURES, NOT ONE.
//
// A broken chain means someone altered or removed an event — the loud failure. But a chain
// that verifies perfectly because nothing has been written for three weeks is the quiet one,
// and it is worse: the control looks green while audit logging has silently stopped. Both
// are checked here, and the second is why `sequence_gap` and `newest_event_age_hours` are
// recorded rather than just a boolean.
//
// Running this on a schedule also produces the thing an assessor actually wants for CC7.2
// and §164.312(b): not "the log is tamper-evident" as an assertion, but a dated series of
// verifications showing it was checked and intact throughout the observation window.

import { createHash } from 'node:crypto';

export const kind = 'audit_integrity';
export const version = '0.1.0';
export const title = 'Audit log verifies, and is still being written';
export const description =
  'Recomputes the tenant hash chain from the first event to the last and checks the sequence for gaps, then checks that events are still arriving. A chain that verifies because logging stopped is a failure, not a pass.';
export const defaultSeverity = 'critical';
export const requiresHostAccess = false;
export const selfReferential = true;
export const suggestedControls = ['OPS-AUDIT-LOGGING', 'GOV-INTERNAL-AUDIT'];

export function validateConfig(config) {
  if (config && typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  const age = config?.max_silence_hours ?? 168;
  if (typeof age !== 'number' || age <= 0) {
    return { ok: false, reason: 'max_silence_hours must be a positive number' };
  }
  return { ok: true };
}

export async function run(config, ctx) {
  if (!ctx?.sql || !ctx?.tenantId) {
    return { status: 'error', message: 'collector was not given a database context', observed: {} };
  }
  const maxSilenceHours = config?.max_silence_hours ?? 168;

  // Recomputed server-side from the stored rows, not read from a cached flag. An integrity
  // claim nobody re-derives is just a nicer-sounding assertion.
  const broken = await ctx.sql`SELECT * FROM verify_audit_chain(${ctx.tenantId})`;

  const [stats] = await ctx.sql`
    SELECT count(*)::int          AS events,
           min(seq)::int          AS min_seq,
           max(seq)::int          AS max_seq,
           max(created_at)        AS newest,
           min(created_at)        AS oldest
    FROM audit_events WHERE tenant_id = ${ctx.tenantId}`;

  const [recent] = await ctx.sql`
    SELECT count(*)::int AS n FROM audit_events
    WHERE tenant_id = ${ctx.tenantId} AND created_at > now() - ${`${maxSilenceHours} hours`}::interval`;

  const events = stats.events ?? 0;
  // seq is assigned by a trigger as max+1 per tenant, so a contiguous run from 1 to max is
  // expected. A gap means rows left by a route the trigger does not control.
  const expected = events === 0 ? 0 : (stats.max_seq ?? 0) - (stats.min_seq ?? 0) + 1;
  const sequenceGap = events !== expected;

  const newestAgeHours = stats.newest
    ? (Date.now() - new Date(stats.newest).getTime()) / 3_600_000
    : null;

  const observed = {
    events,
    seq_range: events ? [stats.min_seq, stats.max_seq] : null,
    sequence_contiguous: !sequenceGap,
    chain_intact: broken.length === 0,
    break: broken.length ? { at_seq: Number(broken[0].broken_at), expected: broken[0].expected, found: broken[0].found } : null,
    newest_event_age_hours: newestAgeHours === null ? null : Number(newestAgeHours.toFixed(1)),
    max_silence_hours: maxSilenceHours,
    events_in_window: recent.n,
    oldest_event: stats.oldest ?? null,
    checked_at: new Date().toISOString(),
  };

  if (events === 0) {
    return {
      status: 'error',
      message: 'no audit events recorded at all — nothing to verify',
      observed,
      content_hash: hash(observed),
    };
  }

  const problems = [];
  if (broken.length) {
    problems.push(
      `chain broken at sequence ${broken[0].broken_at} — every event after it is unreliable`,
    );
  }
  if (sequenceGap) {
    problems.push(`sequence has gaps: ${events} rows spanning ${stats.min_seq}..${stats.max_seq}`);
  }
  if (recent.n === 0) {
    problems.push(
      `no events in ${maxSilenceHours}h — the chain verifies because logging stopped, which is not a pass`,
    );
  }

  return {
    status: problems.length ? 'fail' : 'pass',
    message: problems.length
      ? problems.join('; ')
      : `${events} events, sequence ${stats.min_seq}..${stats.max_seq} contiguous, chain recomputed intact, newest ${newestAgeHours.toFixed(1)}h old`,
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
