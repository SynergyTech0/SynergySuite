// Collector: endpoint_compliance
//
// Share of active computers meeting their Devices compliance policies, and how many have no
// disk encryption. Devices evaluates the policies from what osquery reports on each machine;
// this records the fleet result as evidence.
//
// An empty fleet is an error, not a pass: "every one of zero devices is compliant" says
// nothing about the computers people actually use. A device whose state can't be read yet
// counts against the target, because unknown is not compliant.

import { createHash } from 'node:crypto';
import { FeedError, readPosture, validDays } from './devices-feed.mjs';

export const kind = 'endpoint_compliance';
export const version = '0.1.0';
export const title = 'Computers meet the device compliance policies';
export const description =
  'Reads the fleet summary from Synergy Devices: of the computers that checked in within the window, how many meet every enabled compliance policy (disk encryption, firewall, antivirus, screen lock, updates, OS version and the rest), and how many have no disk encryption. Devices whose state is unknown count as not compliant. An empty fleet is reported as an error, never a pass.';
export const defaultSeverity = 'high';
export const suggestedControls = ['EP-ENDPOINT-HARDENING', 'CRY-ENCRYPT-REST'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!validDays(config)) return { ok: false, reason: 'active_days must be a whole number from 1 to 365' };
  const pct = config.min_compliant_pct ?? 100;
  if (typeof pct !== 'number' || pct < 0 || pct > 100) return { ok: false, reason: 'min_compliant_pct must be 0 to 100' };
  const enc = config.max_unencrypted ?? 0;
  if (!Number.isInteger(enc) || enc < 0) return { ok: false, reason: 'max_unencrypted must be a non-negative whole number' };
  return { ok: true };
}

export async function run(config, ctx = {}) {
  const days = config.active_days ?? 30;
  const minPct = config.min_compliant_pct ?? 100;
  const maxUnencrypted = config.max_unencrypted ?? 0;
  let p;
  try {
    p = await readPosture(days, ctx.env);
  } catch (err) {
    return { status: 'error', message: err instanceof FeedError ? err.message : String(err.message), observed: { active_days: days } };
  }

  const observed = {
    active_days: days,
    min_compliant_pct: minPct,
    max_unencrypted: maxUnencrypted,
    policies: p.policies,
    devices: p.devices,
    stale: p.stale,
    compliant: p.compliant,
    noncompliant: p.noncompliant,
    unknown: p.unknown,
    encryption: p.encryption,
    noncompliant_sample: p.noncompliant_sample,
    generated_at: p.generated_at,
  };
  const content_hash = createHash('sha256').update(JSON.stringify(observed)).digest('hex');

  if (p.devices === 0) {
    return { status: 'error', message: `no computers checked in to Devices in the last ${days} days`, observed };
  }
  if (p.policies === 0) {
    return { status: 'error', message: 'Devices has no enabled compliance policy, so nothing was measured', observed };
  }

  const pct = Math.round((p.compliant / p.devices) * 1000) / 10;
  observed.compliant_pct = pct;
  const parts = [`${p.compliant} of ${p.devices} computers compliant (${pct}%)`];
  if (p.unknown) parts.push(`${p.unknown} not yet reporting enough to judge`);
  if (p.encryption.not_encrypted) parts.push(`${p.encryption.not_encrypted} without disk encryption`);
  if (p.stale) parts.push(`${p.stale} more not seen in ${days} days`);
  const failing = pct < minPct || p.encryption.not_encrypted > maxUnencrypted;
  return { status: failing ? 'fail' : 'pass', message: parts.join('; '), observed, content_hash };
}
