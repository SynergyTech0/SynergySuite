// Read-only SSH execution for host collectors.
//
// ─────────────────────────────────────────────────────────────────────────────────────
//  CREDENTIAL CUSTODY — read before extending this.
//
//  Running commands on a customer's hosts from the vendor's server means the vendor holds
//  keys into customer infrastructure. For a single-tenant or self-hosted deployment that is
//  fine for a single organisation. For SaaS it is not: the right shape is an agent the
//  customer installs, which collects locally and posts signed results back, or a read-only
//  cloud API role. Collectors that need host access declare `requiresHostAccess`, so the
//  product can refuse to offer them on a hosted plan rather than quietly asking a customer
//  for root.
//
//  Everything here is read-only by construction: the command is built from a fixed template
//  in the collector, never from tenant-supplied strings, and there is no interactive shell.
// ─────────────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';

export class SshError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SshError';
    this.code = code;
  }
}

/**
 * Runs one command over SSH and returns its stdout.
 *
 * Throws SshError on any non-zero exit or timeout. Collectors turn that into an `error`
 * status rather than a `fail` — not being able to reach a host tells you nothing about
 * whether the control is operating.
 */
/**
 * Runs a command where the collector already is, with no transport at all.
 *
 * This is what makes an agent possible. A collector running ON the host it measures does
 * not need SSH, credentials, or an inbound port — the same command, the same parsing, the
 * same observation, minus the entire reason host collectors were a custody problem.
 */
function localExec(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new SshError(`local command timed out after ${timeoutMs}ms`, 'timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SshError(`could not run locally: ${err.message}`, 'spawn_failed'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new SshError(`local command exited ${code}: ${stderr.trim().split('\n')[0]}`, 'exit_' + code));
    });
  });
}

export function sshExec(opts) {
  const {
    host,
    user = 'root',
    keyPath = process.env.STRUST_SSH_KEY,
    command,
    timeoutMs = 20_000,
  } = opts;

  // `localhost` is the agent's signal that it is already on the machine in question.
  // Collectors need no change to support an agent: the transport disappears beneath them.
  if (host === 'localhost' || host === '127.0.0.1' || host === null) {
    return localExec(command, timeoutMs);
  }

  if (!host) throw new SshError('no host configured', 'no_host');
  if (!keyPath) {
    throw new SshError(
      'no SSH key configured — set STRUST_SSH_KEY or the monitor\'s key_path',
      'no_key',
    );
  }

  const args = [
    '-i', keyPath,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ConnectTimeout=${Math.ceil(timeoutMs / 2000)}`,
    `${user}@${host}`,
    command,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new SshError(`timed out after ${timeoutMs}ms connecting to ${host}`, 'timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SshError(`could not start ssh: ${err.message}`, 'spawn_failed'));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        reject(
          new SshError(
            `ssh to ${host} exited ${code}: ${stderr.trim().split('\n')[0] || 'no stderr'}`,
            'exit_' + code,
          ),
        );
      }
    });
  });
}

/** Runs the same command across several hosts, never letting one failure hide the others. */
export async function sshExecAll(hosts, buildCommand, opts = {}) {
  const results = {};
  for (const host of hosts) {
    try {
      results[host] = { ok: true, stdout: await sshExec({ ...opts, host, command: buildCommand(host) }) };
    } catch (err) {
      results[host] = { ok: false, error: err.message, code: err.code ?? 'unknown' };
    }
  }
  return results;
}
