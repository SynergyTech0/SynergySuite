// Collector: dependency_vulns
//
// Known vulnerabilities in dependencies, aged against a severity-based remediation deadline.
//
// HOW THE AGEING WORKS, AND WHY IT IS HONEST
//
// `npm audit` reports what is vulnerable today. It cannot tell you how long it has been
// that way, and a remediation SLA is meaningless without that — "3 critical findings" says
// nothing about whether anyone is working on them.
//
// So first-seen comes from this collector's OWN evidence history. The ledger is append-only
// and every run records the exact set of advisory keys observed, which makes the earliest
// run containing an advisory the date it appeared. That is a real measurement derived from
// immutable records, not a timestamp someone could edit.
//
// The honest consequence: on the first run everything is new, so everything is inside its
// SLA and the control passes. That is correct — we genuinely do not know it was there
// yesterday — and the observation records `first_run: true` so a reviewer can see why.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const kind = 'dependency_vulns';
export const version = '0.1.0';
export const title = 'Dependency vulnerabilities are remediated within SLA';
export const description =
  'Runs the package manager audit in each configured directory and ages every advisory against a severity-based deadline. First-seen dates come from this collector’s own append-only evidence history, so the clock cannot be reset by editing anything.';
export const defaultSeverity = 'high';
export const requiresHostAccess = false;
export const suggestedControls = ['OPS-VULN-MGMT', 'CM-SDLC'];

const DEFAULT_SLA_DAYS = { critical: 7, high: 30, moderate: 90, low: 180 };

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.directories) || config.directories.length === 0) {
    return { ok: false, reason: 'directories must be a non-empty array of paths to audit' };
  }
  for (const d of config.directories) {
    if (typeof d !== 'string' || !d.trim()) return { ok: false, reason: 'each directory must be a non-empty string' };
  }
  if (config.sla_days !== undefined) {
    if (typeof config.sla_days !== 'object' || config.sla_days === null) {
      return { ok: false, reason: 'sla_days must be an object keyed by severity' };
    }
    for (const [sev, days] of Object.entries(config.sla_days)) {
      if (!(sev in DEFAULT_SLA_DAYS)) {
        return { ok: false, reason: `unknown severity '${sev}' (expected ${Object.keys(DEFAULT_SLA_DAYS).join(', ')})` };
      }
      if (typeof days !== 'number' || days <= 0) {
        return { ok: false, reason: `sla_days.${sev} must be a positive number` };
      }
    }
  }
  return { ok: true };
}

function npmAudit(cwd, timeoutMs) {
  return new Promise((resolve) => {
    // `npm audit` exits non-zero when it finds anything, so the exit code is not an error
    // signal here — only a failure to produce parseable JSON is.
    const child = spawn('npm', ['audit', '--json'], {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: `audit timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `could not run npm: ${err.message}` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve({ ok: true, report: JSON.parse(stdout) });
      } catch {
        resolve({
          ok: false,
          error: `audit produced no parseable JSON: ${(stderr || stdout).trim().split('\n')[0]?.slice(0, 120)}`,
        });
      }
    });
  });
}

/** Stable identity for an advisory across runs, so ageing survives version churn. */
function advisoryKey(dir, pkg, via) {
  const source = typeof via === 'object' && via?.source ? String(via.source) : null;
  return source ? `${dir}::${pkg}::${source}` : `${dir}::${pkg}::${typeof via === 'string' ? via : 'unknown'}`;
}

export async function run(config, ctx) {
  const directories = config.directories;
  const sla = { ...DEFAULT_SLA_DAYS, ...(config.sla_days ?? {}) };
  const timeoutMs = config.timeout_ms ?? 120_000;

  const advisories = [];
  const auditFailures = [];

  for (const dir of directories) {
    const result = await npmAudit(dir, timeoutMs);
    if (!result.ok) {
      auditFailures.push({ directory: dir, error: result.error });
      continue;
    }
    const vulns = result.report?.vulnerabilities ?? {};
    for (const [pkg, entry] of Object.entries(vulns)) {
      const vias = Array.isArray(entry.via) ? entry.via : [entry.via];
      // A `via` that is just a package name is a transitive path to another advisory that
      // is itself reported; counting it again would inflate the numbers.
      const direct = vias.filter((v) => typeof v === 'object' && v !== null);
      const sources = direct.length ? direct : [null];
      for (const via of sources) {
        advisories.push({
          key: advisoryKey(dir, pkg, via ?? entry.severity),
          directory: dir,
          package: pkg,
          severity: String(via?.severity ?? entry.severity ?? 'unknown').toLowerCase(),
          title: via?.title ?? `vulnerability in ${pkg}`,
          url: via?.url ?? null,
          fix_available: !!entry.fixAvailable,
        });
      }
    }
  }

  // Could not audit anything: nothing was measured.
  if (auditFailures.length === directories.length) {
    return {
      status: 'error',
      message: `could not audit any directory: ${auditFailures.map((f) => `${f.directory} (${f.error})`).join('; ')}`,
      observed: { directories, audit_failures: auditFailures, checked_at: new Date().toISOString() },
    };
  }

  // First-seen from this collector's own append-only history.
  const firstSeen = new Map();
  let priorRuns = 0;
  if (ctx?.sql && ctx?.tenantId) {
    const history = await ctx.sql`
      SELECT collected_at, payload->'advisory_keys' AS keys
      FROM evidence
      WHERE tenant_id = ${ctx.tenantId} AND collector = ${kind}
      ORDER BY collected_at ASC`;
    priorRuns = history.length;
    for (const row of history) {
      const keys = Array.isArray(row.keys) ? row.keys : [];
      for (const k of keys) {
        if (!firstSeen.has(k)) firstSeen.set(k, new Date(row.collected_at));
      }
    }
  }

  const now = Date.now();
  const aged = advisories.map((a) => {
    const seen = firstSeen.get(a.key) ?? new Date(now);
    const ageDays = (now - seen.getTime()) / 86_400_000;
    const limit = sla[a.severity] ?? sla.low;
    return {
      ...a,
      first_seen: seen.toISOString(),
      age_days: Number(ageDays.toFixed(1)),
      sla_days: limit,
      breached: ageDays > limit,
    };
  });

  const breached = aged.filter((a) => a.breached);
  const bySeverity = Object.fromEntries(
    ['critical', 'high', 'moderate', 'low'].map((s) => [s, aged.filter((a) => a.severity === s).length]),
  );

  const observed = {
    directories,
    sla_days: sla,
    first_run: priorRuns === 0,
    prior_runs: priorRuns,
    total_advisories: aged.length,
    by_severity: bySeverity,
    breached,
    advisories: aged,
    // The flat key list is what the next run reads to compute first-seen. Keeping it
    // separate from the detail keeps that lookup cheap and stable.
    advisory_keys: aged.map((a) => a.key),
    audit_failures: auditFailures,
    checked_at: new Date().toISOString(),
  };

  const parts = [];
  if (breached.length) {
    parts.push(
      `${breached.length} advisory(ies) past their remediation deadline: ` +
        breached
          .slice(0, 4)
          .map((b) => `${b.package} (${b.severity}, ${b.age_days}d > ${b.sla_days}d)`)
          .join(', ') +
        (breached.length > 4 ? ` and ${breached.length - 4} more` : ''),
    );
  }
  if (auditFailures.length) {
    parts.push(`${auditFailures.length} directory(ies) could not be audited`);
  }

  const summary =
    aged.length === 0
      ? `no known vulnerabilities across ${directories.length} directory(ies)`
      : `${aged.length} advisory(ies) open, all within SLA (${Object.entries(bySeverity)
          .filter(([, n]) => n > 0)
          .map(([s, n]) => `${n} ${s}`)
          .join(', ')})`;

  return {
    status: breached.length ? 'fail' : auditFailures.length ? 'error' : 'pass',
    message: parts.length ? parts.join('; ') : summary,
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
