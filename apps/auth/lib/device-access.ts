import { q, now } from './db';
import { audit } from './audit';
import type { User } from './users';

/*
 * Conditional access: sign-in is refused while any of the person's devices fails the compliance
 * policies in Devices, like Intune's "require device to be marked as compliant".
 *
 * Checked when an app asks for sign-in (OIDC authorize, SAML SSO) and when a session renews its
 * tokens (refresh_token grant, about hourly through the suite's sign-in proxy), so a device that
 * falls out of compliance locks its owner out within the hour. Auth asks Devices over the internal
 * network (DEVICES_INTERNAL_URL, Bearer DEVICES_SVC_TOKEN). If Devices can't be reached, sign-in is
 * allowed and the miss is audited: a Devices outage shouldn't lock everyone out of the suite.
 *
 * Modes: off; report (audits who would be blocked, blocks no one); enforce. People with no
 * device in Devices are allowed or blocked by `no_device`. Exempt people are never checked.
 * The Auth admin console signs in without this check, so an admin can always turn it off.
 */

export type ComplianceMode = 'off' | 'report' | 'enforce';
export type DeviceCompliance = { mode: ComplianceMode; no_device: 'allow' | 'block'; exempt: string[] };
export const DEFAULT_COMPLIANCE: DeviceCompliance = { mode: 'off', no_device: 'allow', exempt: [] };

export type AccessDevice = {
  id: string;
  name: string;
  platform: string;
  compliance: 'compliant' | 'noncompliant' | 'unknown';
  failing: { label: string; detail: string }[];
  last_seen: string;
};

export type AccessResult =
  | { allowed: true; reason: 'off' | 'exempt' | 'compliant' | 'no_device' | 'unreachable' | 'report' }
  | { allowed: false; reason: 'noncompliant' | 'no_device'; devices: AccessDevice[] };

const emails = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/))
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => e.includes('@'));

export function parseCompliance(v: unknown): DeviceCompliance {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const mode = o.mode === 'report' || o.mode === 'enforce' ? o.mode : 'off';
  return { mode, no_device: o.no_device === 'block' ? 'block' : 'allow', exempt: [...new Set(emails(o.exempt))] };
}

export async function getCompliance(): Promise<DeviceCompliance> {
  const [row] = await q<{ value: unknown }>(`SELECT value FROM sa_settings WHERE key = $1::text`, ['device_compliance']);
  return parseCompliance(typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value);
}

export async function setCompliance(c: DeviceCompliance): Promise<void> {
  await q(`DELETE FROM sa_settings WHERE key = $1::text`, ['device_compliance']);
  await q(`INSERT INTO sa_settings (key, value, updated_ms) VALUES ($1::text, $2::jsonb, $3::bigint)`,
    ['device_compliance', JSON.stringify(c), now()]);
}

/** Which devices block sign-in: the non-compliant ones. "Unknown" (not reported yet) doesn't block. */
export function decide(c: DeviceCompliance, email: string, devices: AccessDevice[] | null): AccessResult {
  if (c.mode === 'off') return { allowed: true, reason: 'off' };
  if (c.exempt.includes(email.toLowerCase())) return { allowed: true, reason: 'exempt' };
  if (devices === null) return { allowed: true, reason: 'unreachable' };
  const bad = devices.filter((d) => d.compliance === 'noncompliant');
  const verdict: AccessResult = bad.length
    ? { allowed: false, reason: 'noncompliant', devices: bad }
    : devices.length === 0 && c.no_device === 'block'
      ? { allowed: false, reason: 'no_device', devices: [] }
      : { allowed: true, reason: devices.length ? 'compliant' : 'no_device' };
  if (!verdict.allowed && c.mode === 'report') return { allowed: true, reason: 'report' };
  return verdict;
}

/** The person's devices from Devices, or null when Devices isn't set up or doesn't answer. */
export async function fetchDevices(email: string, env: NodeJS.ProcessEnv = process.env): Promise<AccessDevice[] | null> {
  const base = (env.DEVICES_INTERNAL_URL ?? '').replace(/\/$/, '');
  const token = env.DEVICES_SVC_TOKEN ?? '';
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base}/api/svc/access?email=${encodeURIComponent(email)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { devices?: AccessDevice[] };
    return Array.isArray(body.devices) ? body.devices : null;
  } catch {
    return null;
  }
}

/** The sign-in check, audited. `where` names what asked (an OIDC client or SAML SP). */
export async function checkDeviceAccess(user: Pick<User, 'email'>, where: string, req?: Request): Promise<AccessResult> {
  const c = await getCompliance();
  if (c.mode === 'off') return { allowed: true, reason: 'off' };
  const devices = c.exempt.includes(user.email.toLowerCase()) ? [] : await fetchDevices(user.email);
  const result = decide(c, user.email, devices);
  if (result.reason === 'unreachable') {
    await audit('device_access.unreachable', user.email, { where }, req);
  } else if (result.reason === 'report') {
    const would = decide({ ...c, mode: 'enforce' }, user.email, devices);
    await audit('device_access.would_block', user.email, { where, ...summary(would) }, req);
  } else if (!result.allowed) {
    await audit('device_access.blocked', user.email, { where, ...summary(result) }, req);
  }
  return result;
}

const summary = (r: AccessResult) =>
  !('devices' in r) ? {} : { reason: r.reason, devices: r.devices.map((d) => ({ name: d.name, failing: d.failing.map((f) => f.label) })) };

export function blockedPage(returnTo: string): string {
  return `/login/device-blocked?return_to=${encodeURIComponent(returnTo)}`;
}
