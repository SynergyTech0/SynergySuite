// Collector agents: enrolment, authentication, assignment and reporting.
//
// The trust model, which is the whole point:
//
//   An agent token authenticates a SUBMITTER, not an author. The agent is told what to
//   measure and may only report against monitors bound to it. It cannot create a monitor,
//   change a config, report for a different host, or write evidence against a control it
//   was not assigned. Everything it sends is checked against the server's own record of
//   what that agent owns.
//
// This matters because an agent runs on a customer machine, and a machine on the far end of
// an outbound connection is not a trusted peer. If the host is compromised, the worst the
// token buys is false observations about the monitors that host already owned — bad, and
// visible in the chain, but bounded.

import { sharedSql } from './queries';
import { newToken, hashToken } from './crypto.mjs';
import { withTenant } from './db.mjs';

export class AgentError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AgentError';
  }
}

export type AgentIdentity = {
  agentId: string;
  tenantId: string;
  name: string;
  hostLabel: string;
};

/**
 * Resolves a bearer token to an agent.
 *
 * Deliberately returns the same error for unknown, revoked and disabled: an agent token is
 * guessed, not typed by a person, so there is nothing to be gained from distinguishing them
 * and something to be lost.
 */
export async function authenticateAgent(authorization: string | null): Promise<AgentIdentity> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
  if (!token) throw new AgentError('agent token required', 'no_token');

  const sql = sharedSql();
  const [agent] = await sql<
    { id: string; tenant_id: string; name: string; host_label: string }[]
  >`
    SELECT id, tenant_id, name, host_label FROM agents
    WHERE token_hash = ${hashToken(token)}
      AND enabled AND revoked_at IS NULL`;
  if (!agent) throw new AgentError('agent token is not valid', 'bad_token');

  await sql`UPDATE agents SET last_seen_at = now() WHERE id = ${agent.id}`;
  return {
    agentId: agent.id,
    tenantId: agent.tenant_id,
    name: agent.name,
    hostLabel: agent.host_label,
  };
}

export async function recordAgentVersion(agentId: string, version: string | null) {
  if (!version) return;
  const sql = sharedSql();
  await sql`UPDATE agents SET version = ${version} WHERE id = ${agentId}`;
}

/** The monitors this agent is bound to, with the config it should run. */
export async function assignmentsFor(agent: AgentIdentity) {
  const sql = sharedSql();
  return withTenant(sql, agent.tenantId, (tx) =>
    tx<
      { key: string; title: string; kind: string; config: Record<string, unknown>; schedule: string }[]
    >`
      SELECT key, title, kind, config, schedule
      FROM monitors
      WHERE agent_id = ${agent.agentId} AND enabled
      ORDER BY key`,
  );
}

export type AgentResult = {
  monitor: string;
  status: 'pass' | 'fail' | 'error' | 'skipped';
  message: string;
  observed: Record<string, unknown>;
  content_hash?: string;
  started_at?: string;
};

const STATUSES = ['pass', 'fail', 'error', 'skipped'];

/**
 * Records results submitted by an agent.
 *
 * Every result is matched against a monitor BOUND TO THIS AGENT before anything is written.
 * A result naming a monitor the agent does not own is rejected and counted, not silently
 * dropped — a silent drop would let a misconfigured agent look like it was reporting while
 * nothing landed.
 */
export async function ingestAgentResults(agent: AgentIdentity, results: AgentResult[]) {
  const sql = sharedSql();

  const owned = new Map(
    (await assignmentsFor(agent)).map((m) => [m.key, m]),
  );

  const accepted: string[] = [];
  const rejected: { monitor: string; reason: string }[] = [];

  for (const r of results) {
    if (!r || typeof r.monitor !== 'string') {
      rejected.push({ monitor: String(r?.monitor ?? '(missing)'), reason: 'malformed result' });
      continue;
    }
    if (!owned.has(r.monitor)) {
      rejected.push({
        monitor: r.monitor,
        reason: 'not assigned to this agent, or not enabled',
      });
      continue;
    }
    if (!STATUSES.includes(r.status)) {
      rejected.push({ monitor: r.monitor, reason: `status must be one of ${STATUSES.join(', ')}` });
      continue;
    }

    // The agent proposes a start time, but it is clamped: a clock that is wrong — or a
    // compromised agent backdating a result into a closed audit window — must not be able
    // to rewrite when something was observed.
    const proposed = r.started_at ? Date.parse(r.started_at) : NaN;
    const now = Date.now();
    const startedAt = Number.isFinite(proposed)
      ? new Date(Math.min(Math.max(proposed, now - 6 * 3600_000), now))
      : new Date(now);

    await withTenant(sql, agent.tenantId, async (tx) => {
      const [monitor] = await tx<{ id: string; control_id: string; title: string }[]>`
        SELECT id, control_id, title FROM monitors
        WHERE key = ${r.monitor} AND agent_id = ${agent.agentId}`;
      if (!monitor) {
        rejected.push({ monitor: r.monitor, reason: 'monitor disappeared mid-ingest' });
        return;
      }

      let evidenceId: string | null = null;
      // Same rule as the server-side runner: only a measured outcome becomes evidence.
      if (r.content_hash) {
        const [ev] = await tx<{ id: string }[]>`
          INSERT INTO evidence
            (tenant_id, control_id, kind, title, collected_at, collector, collector_version,
             content_hash, content_type, payload)
          VALUES (${agent.tenantId}, ${monitor.control_id}, 'automated',
                  ${`${monitor.title} — ${startedAt.toISOString().slice(0, 10)}`},
                  ${startedAt}, ${owned.get(r.monitor)!.kind},
                  ${`agent:${agent.name}`}, ${r.content_hash}, 'application/json',
                  ${tx.json((r.observed ?? {}) as Record<string, never>)})
          RETURNING id`;
        evidenceId = ev?.id ?? null;
      }

      await tx`
        INSERT INTO monitor_runs
          (tenant_id, monitor_id, started_at, finished_at, status, message, observed, evidence_id)
        VALUES (${agent.tenantId}, ${monitor.id}, ${startedAt}, now(), ${r.status},
                ${String(r.message ?? '').slice(0, 2000)},
                ${tx.json((r.observed ?? {}) as Record<string, never>)}, ${evidenceId})`;

      // Attribution names the agent, not just the collector kind. Which machine reported a
      // result is part of the evidence.
      await tx`
        INSERT INTO audit_events
          (tenant_id, actor_label, action, object_type, object_id, payload)
        VALUES (${agent.tenantId}, ${`agent:${agent.name}`}, 'monitor.run', 'monitor',
                ${monitor.id}, ${tx.json({ status: r.status, message: r.message, host: agent.hostLabel })})`;

      accepted.push(r.monitor);
    });
  }

  await sql`UPDATE agents SET last_report_at = now() WHERE id = ${agent.agentId}`;
  return { accepted, rejected };
}

// ───────────────────────────────────────────────────────────────────────────
// Enrolment (operator side)
// ───────────────────────────────────────────────────────────────────────────

export async function createAgent(opts: {
  tenantId: string;
  name: string;
  hostLabel: string;
  createdBy: string;
}) {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(opts.name)) {
    throw new AgentError(
      'agent name must be lowercase letters, digits and hyphens (3-40 characters)',
      'bad_name',
    );
  }
  const sql = sharedSql();
  const token = newToken();

  const [agent] = await sql<{ id: string }[]>`
    INSERT INTO agents (tenant_id, name, host_label, token_hash, created_by)
    VALUES (${opts.tenantId}, ${opts.name}, ${opts.hostLabel}, ${hashToken(token)}, ${opts.createdBy})
    ON CONFLICT (tenant_id, name) DO NOTHING
    RETURNING id`;
  if (!agent) throw new AgentError(`an agent named '${opts.name}' already exists`, 'duplicate');

  // Returned once. Only the hash is stored, so a lost token means enrolling a new agent.
  return { id: agent.id, token };
}

export async function listAgents(tenantId: string, readOnly: boolean) {
  const sql = sharedSql();
  return withTenant(
    sql,
    tenantId,
    (tx) =>
      tx<
        {
          id: string; name: string; host_label: string; version: string | null;
          enabled: boolean; last_seen_at: Date | null; last_report_at: Date | null;
          created_at: Date; revoked_at: Date | null; monitors: number;
        }[]
      >`
      SELECT a.id, a.name, a.host_label, a.version, a.enabled,
             a.last_seen_at, a.last_report_at, a.created_at, a.revoked_at,
             (SELECT count(*) FROM monitors m WHERE m.agent_id = a.id)::int AS monitors
      FROM agents a ORDER BY a.name`,
    { readOnly },
  );
}

export async function revokeAgent(tenantId: string, agentId: string) {
  const sql = sharedSql();
  return withTenant(sql, tenantId, async (tx) => {
    const [row] = await tx<{ name: string }[]>`
      UPDATE agents SET enabled = false, revoked_at = now()
      WHERE id = ${agentId} AND revoked_at IS NULL
      RETURNING name`;
    if (!row) throw new AgentError('no such agent, or it is already revoked', 'not_found');
    return row.name;
  });
}
