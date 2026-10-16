// Collector: endpoint_threats
//
// Open threat alerts and critical vulnerabilities across the computers Synergy Devices manages:
// whether detections are being triaged and whether the worst advisories are being patched.
//
// Like endpoint_compliance, an empty fleet is an error: no alerts from no computers is
// silence, not safety. Vulnerability counts only cover devices Devices has checked against
// OSV; the observation records how many that was.

import { createHash } from 'node:crypto';
import { FeedError, readPosture, validDays } from './devices-feed.mjs';

export const kind = 'endpoint_threats';
export const version = '0.1.0';
export const title = 'Endpoint threats are triaged and critical vulnerabilities patched';
export const description =
  'Reads the fleet summary from Synergy Devices: open critical and high threat alerts (and how long the oldest has been open), and how many computers have a critical vulnerability in installed software. Fails when critical alerts are open, high alerts are older than the allowed age, or more computers carry a critical vulnerability than allowed. An empty fleet is reported as an error, never a pass.';
export const defaultSeverity = 'critical';
export const suggestedControls = ['OPS-MALWARE', 'OPS-VULN-MGMT', 'IR-INCIDENT-RESPONSE'];

const nonNegInt = (v) => Number.isInteger(v) && v >= 0;

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!validDays(config)) return { ok: false, reason: 'active_days must be a whole number from 1 to 365' };
  for (const k of ['max_open_critical', 'max_high_age_days', 'max_critical_vuln_devices']) {
    if (config[k] !== undefined && !nonNegInt(config[k])) return { ok: false, reason: `${k} must be a non-negative whole number` };
  }
  return { ok: true };
}

export async function run(config, ctx = {}) {
  const days = config.active_days ?? 30;
  const maxCritical = config.max_open_critical ?? 0;
  const maxHighAge = config.max_high_age_days ?? 7;
  const maxVulnDevices = config.max_critical_vuln_devices ?? 0;
  let p;
  try {
    p = await readPosture(days, ctx.env);
  } catch (err) {
    return { status: 'error', message: err instanceof FeedError ? err.message : String(err.message), observed: { active_days: days } };
  }

  const observed = {
    active_days: days,
    limits: { max_open_critical: maxCritical, max_high_age_days: maxHighAge, max_critical_vuln_devices: maxVulnDevices },
    devices: p.devices,
    alerts_open: p.alerts_open,
    oldest_open_days: p.oldest_open_days,
    vulnerabilities: p.vulnerabilities,
    generated_at: p.generated_at,
  };
  const content_hash = createHash('sha256').update(JSON.stringify(observed)).digest('hex');

  if (p.devices === 0) {
    return { status: 'error', message: `no computers checked in to Devices in the last ${days} days`, observed };
  }

  const problems = [];
  if (p.alerts_open.critical > maxCritical) problems.push(`${p.alerts_open.critical} critical alert(s) open`);
  const highAge = p.oldest_open_days.high;
  if (p.alerts_open.high && highAge !== null && highAge > maxHighAge) problems.push(`a high alert has been open ${highAge} days`);
  if (p.vulnerabilities.critical_devices > maxVulnDevices) {
    problems.push(`${p.vulnerabilities.critical_devices} computer(s) with a critical vulnerability`);
  }
  const summary =
    `${p.devices} computers; open alerts: ${p.alerts_open.critical} critical, ${p.alerts_open.high} high; ` +
    `${p.vulnerabilities.checked_devices} checked for vulnerabilities`;
  return {
    status: problems.length ? 'fail' : 'pass',
    message: problems.length ? `${problems.join('; ')} (${summary})` : summary,
    observed,
    content_hash,
  };
}
