import { route, jsonBody, requireString } from '@/lib/api';
import { monitorHealth, ValidationError, tx } from '@/lib/queries';
import { collectorCatalogue, validateMonitorConfig } from '@/lib/collectors-meta';

export const dynamic = 'force-dynamic';

/** GET /api/monitors — monitor health plus the collector kinds actually registered. */
export const GET = route(async (session) => {
  const items = await monitorHealth(session);
  return {
    count: items.length,
    due: items.filter((m) => m.is_due).length,
    monitors: items,
    // Derived from the runtime registry, so a kind cannot be advertised without code behind it.
    collector_kinds: collectorCatalogue(),
  };
});

const SCHEDULES = ['hourly', 'daily', 'weekly', 'monthly'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

/**
 * POST /api/monitors   { key, title, kind, control_key, config, schedule?, severity? }
 *
 * Config is validated against the collector before anything is written. A monitor saved with
 * a config its collector cannot use would record `error` every night until somebody read the
 * run history — a 400 here is worth a great deal more than a row in the table.
 */
export const POST = route(async (session, req) => {
  const body = await jsonBody(req);
  const key = requireString(body, 'key');
  const title = requireString(body, 'title');
  const kind = requireString(body, 'kind');
  const controlKey = requireString(body, 'control_key');
  const schedule = typeof body.schedule === 'string' ? body.schedule : 'daily';
  const severity = typeof body.severity === 'string' ? body.severity : null;

  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(key)) {
    throw new ValidationError(
      'key must be lowercase letters, digits and hyphens (3-50 characters)',
    );
  }
  if (!SCHEDULES.includes(schedule)) {
    throw new ValidationError(`schedule must be one of ${SCHEDULES.join(', ')}`);
  }
  if (severity && !SEVERITIES.includes(severity)) {
    throw new ValidationError(`severity must be one of ${SEVERITIES.join(', ')}`);
  }

  const config = body.config ?? {};
  const valid = validateMonitorConfig(kind, config);
  if (!valid.ok) throw new ValidationError(valid.reason);

  const collector = collectorCatalogue().find((c) => c.kind === kind);

  return tx(session, async (t) => {
    const [control] = await t<{ id: string }[]>`
      SELECT id FROM controls WHERE key = ${controlKey}`;
    if (!control) throw new ValidationError(`no control with key '${controlKey}'`);

    const [existing] = await t<{ key: string }[]>`SELECT key FROM monitors WHERE key = ${key}`;
    if (existing) throw new ValidationError(`a monitor named '${key}' already exists`);

    const [monitor] = await t<{ id: string; key: string }[]>`
      INSERT INTO monitors (tenant_id, control_id, key, title, kind, config, schedule, severity)
      VALUES (${session.tenantId}, ${control.id}, ${key}, ${title}, ${kind},
              ${t.json(config as Record<string, never>)}, ${schedule},
              ${severity ?? collector?.defaultSeverity ?? 'medium'})
      RETURNING id, key`;

    await t`
      INSERT INTO audit_events
        (tenant_id, actor_user_id, actor_label, action, object_type, object_id, payload)
      VALUES (${session.tenantId}, ${session.userId}, ${session.userEmail},
              'monitor.created', 'monitor', ${key},
              ${t.json({ kind, control: controlKey, schedule })})`;

    return { ok: true, monitor };
  });
}, { write: true });
