// Collector: ssh_hardening
//
// Asserts the EFFECTIVE sshd configuration on each host, not the contents of a file.
//
// `sshd -T` prints the configuration the daemon actually resolved — after Include
// directives, Match blocks, distribution drop-ins and built-in defaults. Grepping
// sshd_config instead is the classic way to get this wrong: the setting you are looking at
// may be overridden two files later, or may not be set at all and silently taking a default
// that happens to be the opposite of what you assumed.

import { createHash } from 'node:crypto';
import { sshExec, SshError } from './ssh.mjs';

export const kind = 'ssh_hardening';
export const version = '0.1.0';
export const title = 'SSH daemons refuse passwords and empty logins';
export const description =
  'Reads the effective sshd configuration (sshd -T, so Includes and Match blocks are already resolved) on each host and checks the security-relevant settings against a required baseline.';
export const defaultSeverity = 'high';
export const requiresHostAccess = true;
export const suggestedControls = ['AC-MFA', 'NET-BOUNDARY', 'EP-ENDPOINT-HARDENING'];

// Each entry: the setting, the values we accept, and why it matters. The rationale travels
// into the evidence so a reviewer reading it later does not have to reconstruct the intent.
const BASELINE = [
  {
    key: 'passwordauthentication',
    accept: ['no'],
    why: 'Password auth exposes every account to credential stuffing and brute force.',
  },
  {
    key: 'permitemptypasswords',
    accept: ['no'],
    why: 'An empty password is no authentication at all.',
  },
  {
    key: 'permitrootlogin',
    accept: ['no', 'prohibit-password', 'without-password', 'forced-commands-only'],
    why: 'Root must not be reachable with a password; key-only or disabled is acceptable.',
  },
  {
    key: 'pubkeyauthentication',
    accept: ['yes'],
    why: 'Key authentication is the replacement for passwords, so it has to be on.',
  },
  {
    key: 'kbdinteractiveauthentication',
    accept: ['no'],
    why: 'Keyboard-interactive is a second route to password prompts if left enabled.',
  },
];

// Checked and reported, but not failed on: defensible either way depending on how the host
// is used. Separating them keeps the pass/fail signal meaningful.
const ADVISORY = [
  { key: 'x11forwarding', prefer: 'no', why: 'X11 forwarding widens the trust boundary of a session.' },
  { key: 'maxauthtries', prefer: '<=4', why: 'Fewer attempts per connection slows online guessing.' },
];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
    return { ok: false, reason: 'hosts must be a non-empty array' };
  }
  return { ok: true };
}

export async function run(config) {
  const hosts = config.hosts;
  const results = {};
  const violations = [];
  const advisories = [];
  const unreachable = [];

  for (const host of hosts) {
    let out;
    try {
      out = await sshExec({
        host,
        user: config.user,
        keyPath: config.key_path,
        command: 'sshd -T 2>/dev/null || /usr/sbin/sshd -T',
        timeoutMs: config.timeout_ms ?? 20_000,
      });
    } catch (err) {
      unreachable.push({ host, error: err instanceof SshError ? err.message : String(err.message) });
      results[host] = { reachable: false };
      continue;
    }

    const settings = {};
    for (const line of out.split('\n')) {
      const idx = line.indexOf(' ');
      if (idx > 0) settings[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim().toLowerCase();
    }

    const hostFindings = {};
    for (const rule of BASELINE) {
      const value = settings[rule.key];
      const ok = value !== undefined && rule.accept.includes(value);
      hostFindings[rule.key] = { value: value ?? '(not reported)', ok, accept: rule.accept };
      if (!ok) violations.push({ host, setting: rule.key, value: value ?? '(not reported)', why: rule.why });
    }

    const hostAdvisory = {};
    for (const rule of ADVISORY) {
      const value = settings[rule.key];
      let ok;
      if (rule.prefer.startsWith('<=')) ok = Number(value) <= Number(rule.prefer.slice(2));
      else ok = value === rule.prefer;
      hostAdvisory[rule.key] = { value: value ?? '(not reported)', preferred: rule.prefer, ok };
      if (!ok) advisories.push({ host, setting: rule.key, value: value ?? '(not reported)', why: rule.why });
    }

    results[host] = { reachable: true, baseline: hostFindings, advisory: hostAdvisory };
  }

  const observed = {
    hosts,
    baseline: BASELINE.map((r) => ({ setting: r.key, accept: r.accept, why: r.why })),
    violations,
    advisories,
    unreachable,
    results,
    checked_at: new Date().toISOString(),
  };

  // Could not read any host: nothing was measured, so this is not a pass and not a failure.
  if (unreachable.length === hosts.length) {
    return {
      status: 'error',
      message: `could not read sshd configuration on any of ${hosts.length} host(s): ${unreachable
        .map((u) => u.host)
        .join(', ')}`,
      observed,
    };
  }

  const reachable = hosts.length - unreachable.length;
  const problems = [];
  if (violations.length) {
    problems.push(
      `${violations.length} baseline violation(s): ` +
        violations.map((v) => `${v.host} ${v.setting}=${v.value}`).join(', '),
    );
  }
  // A host that could not be read is an error condition even when the others passed —
  // reporting "all good" over a partial sample is exactly the overstatement to avoid.
  if (unreachable.length) {
    problems.push(`${unreachable.length} host(s) unreadable: ${unreachable.map((u) => u.host).join(', ')}`);
  }

  return {
    status: violations.length ? 'fail' : unreachable.length ? 'error' : 'pass',
    message: problems.length
      ? problems.join('; ')
      : `${reachable}/${hosts.length} host(s) meet the sshd baseline` +
        (advisories.length ? `; ${advisories.length} advisory item(s)` : ''),
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
