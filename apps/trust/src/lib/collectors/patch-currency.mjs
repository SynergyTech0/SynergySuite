// Collector: patch_currency
//
// Pending security updates and outstanding reboots per host.
//
// Reboot-required is reported as a first-class finding because a kernel or libc update that
// has been installed but not activated gives exactly the comfortable illusion this product
// exists to dispel: the package manager says patched, the running system is not. On a host
// with long uptime that gap can be months wide.

import { createHash } from 'node:crypto';
import { sshExec, SshError } from './ssh.mjs';

export const kind = 'patch_currency';
export const version = '0.1.0';
export const title = 'Hosts have no pending security updates';
export const description =
  'Simulates an upgrade on each host to count pending security updates without installing anything, and reports whether a reboot is outstanding. An installed-but-not-activated kernel update is reported separately, because the package manager calls that patched while the running system is not.';
export const defaultSeverity = 'high';
export const requiresHostAccess = true;
export const suggestedControls = ['OPS-VULN-MGMT', 'EP-ENDPOINT-HARDENING'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
    return { ok: false, reason: 'hosts must be a non-empty array' };
  }
  const max = config.max_security_updates ?? 0;
  if (typeof max !== 'number' || max < 0) {
    return { ok: false, reason: 'max_security_updates must be a non-negative number' };
  }
  return { ok: true };
}

export async function run(config) {
  const hosts = config.hosts;
  const maxSecurity = config.max_security_updates ?? 0;

  const results = {};
  const breaches = [];
  const rebootPending = [];
  const unreachable = [];

  for (const host of hosts) {
    let out;
    try {
      out = await sshExec({
        host,
        user: config.user,
        keyPath: config.key_path,
        // -s simulates: nothing is downloaded, nothing is installed. Read-only by design.
        command: [
          'apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep -c "^Inst.*-security" || true',
          'apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep -c "^Inst" || true',
          '[ -f /var/run/reboot-required ] && echo REBOOT || echo NOREBOOT',
          'uptime -s 2>/dev/null || echo unknown',
        ].join('; echo ---; '),
        timeoutMs: config.timeout_ms ?? 45_000,
      });
    } catch (err) {
      unreachable.push({ host, error: err instanceof SshError ? err.message : String(err.message) });
      results[host] = { reachable: false };
      continue;
    }

    const [sec, total, reboot, bootedAt] = out.split('---').map((s) => s.trim());
    const securityUpdates = Number(sec) || 0;
    const allUpdates = Number(total) || 0;
    const needsReboot = reboot === 'REBOOT';

    results[host] = {
      reachable: true,
      security_updates: securityUpdates,
      total_updates: allUpdates,
      reboot_required: needsReboot,
      booted_at: bootedAt || null,
      uptime_days: bootedAt && bootedAt !== 'unknown'
        ? Number(((Date.now() - Date.parse(bootedAt + 'Z')) / 86_400_000).toFixed(0))
        : null,
    };

    if (securityUpdates > maxSecurity) {
      breaches.push({ host, security_updates: securityUpdates, limit: maxSecurity });
    }
    if (needsReboot) rebootPending.push(host);
  }

  const observed = {
    hosts,
    max_security_updates: maxSecurity,
    breaches,
    reboot_pending: rebootPending,
    unreachable,
    results,
    checked_at: new Date().toISOString(),
  };

  if (unreachable.length === hosts.length) {
    return {
      status: 'error',
      message: `could not check updates on any of ${hosts.length} host(s)`,
      observed,
    };
  }

  const parts = [];
  if (breaches.length) {
    parts.push(
      `${breaches.length} host(s) with pending security updates: ` +
        breaches.map((b) => `${b.host} (${b.security_updates})`).join(', '),
    );
  }
  if (rebootPending.length) {
    parts.push(
      `${rebootPending.length} host(s) need a reboot to activate installed updates: ${rebootPending.join(', ')}`,
    );
  }
  if (unreachable.length) parts.push(`${unreachable.length} host(s) unreachable`);

  const checked = hosts.length - unreachable.length;
  return {
    status: breaches.length || rebootPending.length ? 'fail' : unreachable.length ? 'error' : 'pass',
    message: parts.length
      ? parts.join('; ')
      : `${checked}/${hosts.length} host(s) fully patched with no reboot outstanding`,
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
