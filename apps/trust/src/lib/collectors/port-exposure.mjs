// Collector: port_exposure
//
// Asserts that nothing is listening on the public internet that should not be — in
// particular that no database, cache, or container-daemon port answers.
//
// VANTAGE POINT IS PART OF THE EVIDENCE.
//
// A reachability check only means what its network position means. Run from inside the
// network it proves nothing about internet exposure; run from a laptop behind a corporate
// firewall it can report "closed" for a port that is wide open to everyone else. So the
// observation records where it ran from, and a reviewer can judge it. Claiming "not exposed"
// from an unstated vantage point is the kind of assertion this product exists to replace.
//
// A closed port here is a genuine negative result, so a forbidden port answering is `fail`.
// But an EXPECTED port failing to answer is ambiguous — the service may be down, or this
// vantage may be blocked — and is reported separately rather than being folded into the
// same verdict.

import net from 'node:net';
import { createHash } from 'node:crypto';

export const kind = 'port_exposure';
export const version = '0.1.0';
export const title = 'No database or management port answers from outside';
export const description =
  'Opens a TCP connection to each listed port on each host and records which answer. Forbidden ports answering is a failure; expected ports not answering is reported separately, because that is as likely to be a vantage-point artefact as a real outage.';
export const defaultSeverity = 'critical';
export const requiresHostAccess = false;
export const suggestedControls = ['NET-BOUNDARY', 'CRY-TLS-TRANSIT'];

// Ports that should never be reachable from an untrusted network.
const DEFAULT_FORBIDDEN = [
  { port: 5432, service: 'PostgreSQL' },
  { port: 3306, service: 'MySQL' },
  { port: 6379, service: 'Redis' },
  { port: 27017, service: 'MongoDB' },
  { port: 9200, service: 'Elasticsearch' },
  { port: 2375, service: 'Docker daemon (unencrypted)' },
  { port: 2376, service: 'Docker daemon (TLS)' },
  { port: 11211, service: 'Memcached' },
  { port: 5984, service: 'CouchDB' },
  { port: 9000, service: 'Portainer / MinIO console' },
];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
    return { ok: false, reason: 'hosts must be a non-empty array' };
  }
  for (const h of config.hosts) {
    if (typeof h !== 'string' || !h.trim()) return { ok: false, reason: 'each host must be a non-empty string' };
  }
  for (const key of ['forbidden_ports', 'expected_open']) {
    if (config[key] !== undefined) {
      if (!Array.isArray(config[key])) return { ok: false, reason: `${key} must be an array of port numbers` };
      for (const p of config[key]) {
        if (!Number.isInteger(p) || p < 1 || p > 65535) {
          return { ok: false, reason: `${key} contains an invalid port: ${p}` };
        }
      }
    }
  }
  return { ok: true };
}

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (state, detail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ state, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('open'));
    // A refused connection is a definite closed. A timeout is a filtered/dropped packet,
    // which usually means a firewall — recorded distinctly because the two are not the same
    // finding, and conflating them hides a host that is simply unreachable.
    socket.once('timeout', () => finish('filtered', `no response in ${timeoutMs}ms`));
    socket.once('error', (err) =>
      finish(err.code === 'ECONNREFUSED' ? 'closed' : 'unreachable', err.code),
    );
    socket.connect(port, host);
  });
}

export async function run(config) {
  const hosts = config.hosts;
  const timeoutMs = config.timeout_ms ?? 4000;
  const forbidden = config.forbidden_ports
    ? config.forbidden_ports.map((p) => ({ port: p, service: lookupService(p) }))
    : DEFAULT_FORBIDDEN;
  const expectedOpen = config.expected_open ?? [443];

  const results = {};
  const exposures = [];
  const missing = [];
  let unreachableHosts = 0;

  for (const host of hosts) {
    const hostResult = { forbidden: {}, expected: {} };

    for (const { port, service } of forbidden) {
      const r = await probe(host, port, timeoutMs);
      hostResult.forbidden[port] = { ...r, service };
      if (r.state === 'open') exposures.push({ host, port, service });
    }

    for (const port of expectedOpen) {
      const r = await probe(host, port, timeoutMs);
      hostResult.expected[port] = r;
      if (r.state !== 'open') missing.push({ host, port, state: r.state });
    }

    // Every expected port unreachable almost certainly means the host, not the ports.
    const anyAnswer = Object.values(hostResult.expected).some((r) => r.state === 'open');
    if (!anyAnswer && expectedOpen.length) unreachableHosts++;
    results[host] = hostResult;
  }

  const observed = {
    vantage_point: config.vantage_label ?? 'the machine running the collector',
    hosts,
    forbidden_ports: forbidden.map((f) => f.port),
    expected_open: expectedOpen,
    exposures,
    expected_not_answering: missing,
    results,
    checked_at: new Date().toISOString(),
  };

  // If no host answered on anything expected, we probably measured our own network rather
  // than theirs. Reporting "no exposure found" from that would be a false all-clear.
  if (unreachableHosts === hosts.length && expectedOpen.length) {
    return {
      status: 'error',
      message: `no host answered on any expected port — the collector's network position is suspect, not the hosts'`,
      observed,
    };
  }

  const status = exposures.length ? 'fail' : 'pass';
  const message = exposures.length
    ? `${exposures.length} forbidden port(s) reachable: ` +
      exposures.map((e) => `${e.host}:${e.port} (${e.service})`).join(', ')
    : `no forbidden port answered on ${hosts.length} host(s) from ${observed.vantage_point}` +
      (missing.length ? `; ${missing.length} expected port(s) did not answer` : '');

  return { status, message, observed, content_hash: hash(observed) };
}

function lookupService(port) {
  return DEFAULT_FORBIDDEN.find((f) => f.port === port)?.service ?? `port ${port}`;
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
