import { route, jsonBody, NotFoundError } from '@/lib/api';
import { ValidationError, tx } from '@/lib/queries';
import { validateMonitorConfig } from '@/lib/collectors-meta';

export const dynamic = 'force-dynamic';

const SCHEDULES = ['hourly', 'daily', 'weekly', 'monthly'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

/**
 * PATCH /api/monitors/:key   { title?, config?, schedule?, severity?, enabled? }
 *
 * The collector `kind` is deliberately immutable. Changing it would leave a run history
 * whose rows were produced by two different measurements under one identity, and a series
 * you cannot interpret is worse than two short ones.
 */
export const PATCH = route(async (session, req, ctx) => {
  const { key } = await ctx.params;
  const body = await jsonBody(req);

  const allowed = new Set(['title', 'config', 'schedule', 'severity', 'enabled']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    if (unknown.includes('kind')) {
      throw new ValidationError(
        'kind cannot be changed — the run history would mix two different measurements under ' +
          'one identity. Create a new monitor and disable this one.',
      );
    }
    throw new ValidationError(
      `unsupported field(s): ${unknown.join(', ')}. Writable: ${[...allowed].join(', ')}`,
    );
  }
  if (body.schedule !== undefined && !SCHEDULES.includes(body.schedule as string)) {
    throw new ValidationError(`schedule must be one of ${SCHEDULES.join(', ')}`);
  }
  if (body.severity !== undefined && !SEVERITIES.includes(body.severity as string)) {
    throw new ValidationError(`severity must be one of ${SEVERITIES.join(', ')}`);
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    throw new ValidationError('enabled must be a boolean');
  }

  return tx(session, async (t) => {
    const [existing] = await t<{ id: string; kind: string; enabled: boolean }[]>`
      SELECT id, kind, enabled FROM monitors WHERE key = ${key}`;
    if (!existing) throw new NotFoundError(`no monitor with key '${key}'`);

    // Config is validated against the collector this monitor already uses.
    if (body.config !== undefined) {
      const valid = validateMonitorConfig(existing.kind, body.config);
      if (!valid.ok) throw new ValidationError(valid.reason);
    }

    const [updated] = await t<
      { key: string; title: string; schedule: string; severity: string; enabled: boolean }[]
    >`
      UPDATE monitors SET
        title    = ${body.title === undefined ? t`title` : (body.title as string)},
        config   = ${body.config === undefined ? t`config` : t.json(body.config as Record<string, never>)},
        schedule = ${body.schedule === undefined ? t`schedule` : (body.schedule as string)},
        severity = ${body.severity === undefined ? t`severity` : (body.severity as string)},
        enabled  = ${body.enabled === undefined ? t`enabled` : (body.enabled as boolean)}
      WHERE id = ${existing.id}
      RETURNING key, title, schedule, severity, enabled`;

    await t`
      INSERT INTO audit_events
        (tenant_id, actor_user_id, actor_label, action, object_type, object_id, payload)
      VALUES (${session.tenantId}, ${session.userId}, ${session.userEmail},
              'monitor.updated', 'monitor', ${key}, ${t.json(body as Record<string, never>)})`;

    return { ok: true, monitor: updated };
  });
}, { write: true });

/**
 * DELETE /api/monitors/:key
 *
 * Only possible while the monitor has no run history. Once it has collected anything those
 * runs are evidence, and `monitor_runs` is append-only with a RESTRICT key back to the
 * monitor — so the database would refuse this anyway. Checking here turns that into an
 * explanation rather than a foreign-key error, and points at the right action: disable it.
 */
export const DELETE = route(async (session, _req, ctx) => {
  const { key } = await ctx.params;

  return tx(session, async (t) => {
    const [monitor] = await t<{ id: string }[]>`SELECT id FROM monitors WHERE key = ${key}`;
    if (!monitor) throw new NotFoundError(`no monitor with key '${key}'`);

    const [{ runs }] = await t<{ runs: number }[]>`
      SELECT count(*)::int AS runs FROM monitor_runs WHERE monitor_id = ${monitor.id}`;
    if (runs > 0) {
      throw new ValidationError(
        `'${key}' has ${runs} recorded run(s), which are evidence and cannot be removed. ` +
          `Disable the monitor instead: PATCH with { "enabled": false }.`,
      );
    }

    await t`DELETE FROM monitors WHERE id = ${monitor.id}`;
    await t`
      INSERT INTO audit_events
        (tenant_id, actor_user_id, actor_label, action, object_type, object_id, payload)
      VALUES (${session.tenantId}, ${session.userId}, ${session.userEmail},
              'monitor.deleted', 'monitor', ${key}, ${t.json({ had_runs: 0 })})`;

    return { ok: true, deleted: key };
  });
}, { write: true });
