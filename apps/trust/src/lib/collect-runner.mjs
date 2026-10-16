// Runs monitors and records the outcome. Shared by scripts/collect.mjs (cron / CLI) and the
// POST /api/monitors/:key/run route, so there is exactly one implementation of the recording
// path — two would be two chances to get the evidence trail wrong.

import { withTenant } from './db.mjs';
import { COLLECTORS } from './collectors/registry.mjs';

export { COLLECTORS };

/**
 * Selects monitors to run.
 *
 * `dueOnly` is what makes this continuous monitoring rather than a button. A Type II opinion
 * covers a window, so the series has to fill itself without anyone remembering; this is the
 * predicate a nightly cron uses to decide what has gone long enough since its last run.
 *
 * Due-ness is computed in SQL against the database's now() and the monitor's own cadence,
 * so two overlapping cron invocations cannot both decide the same monitor is due and record
 * it twice.
 */
// Agent-owned monitors are excluded from every server-side selection. The server cannot
// reach those hosts — that is precisely why an agent owns them — so running them here would
// record a nightly `error` that buries the agent's real result underneath it.
function selectMonitors(tx, { monitorKey, dueOnly }) {
  if (monitorKey) {
    return tx`SELECT id, key, title, kind, config, severity, schedule FROM monitors
              WHERE enabled AND agent_id IS NULL AND key = ${monitorKey}`;
  }
  if (dueOnly) {
    return tx`
      SELECT mo.id, mo.key, mo.title, mo.kind, mo.config, mo.severity, mo.schedule
      FROM monitors mo
      LEFT JOIN LATERAL (
        SELECT max(started_at) AS last_run FROM monitor_runs r WHERE r.monitor_id = mo.id
      ) lr ON true
      WHERE mo.enabled AND mo.agent_id IS NULL
        AND (lr.last_run IS NULL OR lr.last_run < now() - CASE mo.schedule
              WHEN 'hourly'  THEN interval '1 hour'
              WHEN 'daily'   THEN interval '1 day'
              WHEN 'weekly'  THEN interval '7 days'
              WHEN 'monthly' THEN interval '30 days'
              ELSE interval '1 day'
            END)
      ORDER BY mo.key`;
  }
  return tx`SELECT id, key, title, kind, config, severity, schedule FROM monitors
            WHERE enabled AND agent_id IS NULL ORDER BY key`;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {string} tenantId
 * @param {{ monitorKey?: string, dueOnly?: boolean }} [opts]
 */
export async function runMonitors(sql, tenantId, opts = {}) {
  const monitors = await withTenant(sql, tenantId, (tx) => selectMonitors(tx, opts));

  const results = [];
  let pass = 0, fail = 0, error = 0;

  for (const m of monitors) {
    const collector = COLLECTORS.get(m.kind);
    const startedAt = new Date();

    let outcome;
    if (!collector) {
      // An unregistered kind must surface as an error. Skipping it quietly leaves the
      // control looking monitored while nothing is watching it.
      outcome = {
        status: 'error',
        message: `no collector registered for kind '${m.kind}'`,
        observed: {},
      };
    } else {
      // Config is validated before every run, not only at save time: a collector can gain a
      // new requirement in a later version, and a monitor stored under the old rules would
      // otherwise fail somewhere deep inside run() with a confusing message.
      const valid = collector.validateConfig(m.config);
      if (!valid.ok) {
        outcome = {
          status: 'error',
          message: `monitor config is not valid for ${m.kind}: ${valid.reason}`,
          observed: { config_error: valid.reason },
        };
      } else {
        try {
          // Self-referential collectors read Trust's own tables, so they get the
          // pool and the tenant id. They are trusted system code, not tenant input.
          outcome = await collector.run(m.config, { tenantId, sql });
        } catch (err) {
          outcome = { status: 'error', message: `collector threw: ${err.message}`, observed: {} };
        }
      }
    }

    await withTenant(sql, tenantId, async (tx) => {
      let evidenceId = null;
      // Only a real observation becomes evidence. An error produces a monitor_run — so the
      // gap in the series is visible — but no evidence row, because nothing was measured.
      if (outcome.content_hash) {
        const [ev] = await tx`
          INSERT INTO evidence
            (tenant_id, control_id, kind, title, collected_at, collector, collector_version,
             content_hash, content_type, payload)
          SELECT ${tenantId}, mo.control_id, 'automated',
                 ${`${m.title} — ${startedAt.toISOString().slice(0, 10)}`},
                 ${startedAt}, ${m.kind}, ${collector?.version ?? 'unknown'},
                 ${outcome.content_hash}, 'application/json', ${tx.json(outcome.observed)}
          FROM monitors mo WHERE mo.id = ${m.id}
          RETURNING id`;
        evidenceId = ev?.id ?? null;
      }

      await tx`
        INSERT INTO monitor_runs
          (tenant_id, monitor_id, started_at, finished_at, status, message, observed, evidence_id)
        VALUES (${tenantId}, ${m.id}, ${startedAt}, now(), ${outcome.status},
                ${outcome.message}, ${tx.json(outcome.observed)}, ${evidenceId})`;

      await tx`
        INSERT INTO audit_events
          (tenant_id, actor_label, action, object_type, object_id, payload)
        VALUES (${tenantId}, ${`collector:${m.kind}`}, 'monitor.run', 'monitor', ${m.id},
                ${tx.json({ status: outcome.status, message: outcome.message })})`;
    });

    results.push({ key: m.key, kind: m.kind, status: outcome.status, message: outcome.message });
    if (outcome.status === 'pass') pass++;
    else if (outcome.status === 'fail') fail++;
    else error++;
  }

  return { results, pass, fail, error };
}
