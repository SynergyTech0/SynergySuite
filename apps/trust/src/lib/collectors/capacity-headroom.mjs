// Collector: capacity_headroom
//
// Disk, memory and swap headroom per host. Maps to SOC 2 A1.1 (capacity) and ISO A.8.6.
//
// Swap is reported as a first-class finding rather than a footnote because on a densely
// packed host it is the difference between a slow host and a dead neighbour: with no swap,
// anything memory-hungry OOM-kills an unrelated service. "Memory
// looks fine" on a swapless box is a much weaker statement than on one with swap, and the
// evidence should say which it is.
//
// Available memory, not free memory. Linux spends free RAM on page cache by design, so
// `free` reads alarmingly low on a perfectly healthy machine; MemAvailable is the kernel's
// own estimate of what a new workload could actually claim.

import { createHash } from 'node:crypto';
import { sshExec, SshError } from './ssh.mjs';

export const kind = 'capacity_headroom';
export const version = '0.1.0';
export const title = 'Hosts have disk and memory headroom';
export const description =
  'Reads disk usage, available memory and swap on each host. Uses MemAvailable rather than free memory, and treats a swapless host as a distinct risk because an OOM there kills a neighbouring service rather than slowing the offender down.';
export const defaultSeverity = 'medium';
export const requiresHostAccess = true;
export const suggestedControls = ['OPS-MONITORING', 'OPS-BCDR'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
    return { ok: false, reason: 'hosts must be a non-empty array' };
  }
  for (const [key, def] of [['max_disk_pct', 85], ['min_mem_available_pct', 10]]) {
    const v = config[key] ?? def;
    if (typeof v !== 'number' || v < 0 || v > 100) {
      return { ok: false, reason: `${key} must be a percentage between 0 and 100` };
    }
  }
  return { ok: true };
}

export async function run(config) {
  const hosts = config.hosts;
  const maxDiskPct = config.max_disk_pct ?? 85;
  const minMemPct = config.min_mem_available_pct ?? 10;

  const results = {};
  const breaches = [];
  const swapless = [];
  const unreachable = [];

  for (const host of hosts) {
    let out;
    try {
      out = await sshExec({
        host,
        user: config.user,
        keyPath: config.key_path,
        command:
          "df -P / | tail -1 | awk '{print \"disk\", $2, $3, $4, $5}'; " +
          "awk '/MemTotal|MemAvailable|SwapTotal/{print tolower($1), $2}' /proc/meminfo",
        timeoutMs: config.timeout_ms ?? 20_000,
      });
    } catch (err) {
      unreachable.push({ host, error: err instanceof SshError ? err.message : String(err.message) });
      results[host] = { reachable: false };
      continue;
    }

    const mem = {};
    let disk = null;
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'disk') {
        disk = {
          total_kb: Number(parts[1]),
          used_kb: Number(parts[2]),
          available_kb: Number(parts[3]),
          used_pct: Number(String(parts[4]).replace('%', '')),
        };
      } else if (parts[0]?.endsWith(':')) {
        mem[parts[0].replace(':', '')] = Number(parts[1]);
      }
    }

    const memTotal = mem.memtotal ?? 0;
    const memAvailable = mem.memavailable ?? 0;
    const swapTotal = mem.swaptotal ?? 0;
    const memAvailablePct = memTotal ? (memAvailable / memTotal) * 100 : 0;

    const hostResult = {
      reachable: true,
      disk,
      mem_total_mb: Math.round(memTotal / 1024),
      mem_available_mb: Math.round(memAvailable / 1024),
      mem_available_pct: Number(memAvailablePct.toFixed(1)),
      swap_total_mb: Math.round(swapTotal / 1024),
      swapless: swapTotal === 0,
    };
    results[host] = hostResult;

    if (disk && disk.used_pct > maxDiskPct) {
      breaches.push({ host, kind: 'disk', value: `${disk.used_pct}%`, limit: `${maxDiskPct}%` });
    }
    if (memTotal && memAvailablePct < minMemPct) {
      breaches.push({
        host,
        kind: 'memory',
        value: `${memAvailablePct.toFixed(1)}% available`,
        limit: `${minMemPct}%`,
      });
    }
    if (swapTotal === 0) swapless.push(host);
  }

  const observed = {
    hosts,
    thresholds: { max_disk_pct: maxDiskPct, min_mem_available_pct: minMemPct },
    breaches,
    swapless_hosts: swapless,
    unreachable,
    results,
    checked_at: new Date().toISOString(),
  };

  if (unreachable.length === hosts.length) {
    return {
      status: 'error',
      message: `could not read capacity on any of ${hosts.length} host(s)`,
      observed,
    };
  }

  const parts = [];
  if (breaches.length) {
    parts.push(
      `${breaches.length} threshold breach(es): ` +
        breaches.map((b) => `${b.host} ${b.kind} ${b.value} > ${b.limit}`).join(', '),
    );
  }
  if (unreachable.length) parts.push(`${unreachable.length} host(s) unreachable`);

  // Swaplessness is recorded and surfaced but does not fail the control on its own: it is a
  // standing property of the host, not a change in posture, and a check that is permanently
  // red teaches people to ignore it.
  const note = swapless.length ? ` (no swap on ${swapless.join(', ')} — an OOM there kills a neighbour)` : '';

  return {
    status: breaches.length ? 'fail' : unreachable.length ? 'error' : 'pass',
    message: parts.length
      ? parts.join('; ') + note
      : `${hosts.length - unreachable.length}/${hosts.length} host(s) within thresholds${note}`,
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
