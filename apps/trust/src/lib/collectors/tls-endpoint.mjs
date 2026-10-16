// Collector: tls_endpoint
//
// Asserts that a hostname terminates TLS at an acceptable protocol version with a
// currently-valid certificate chain.
//
// It opens a real TLS socket and reads the negotiated parameters. An HTTP request that
// returns 200 proves only that something answered - it does not tell you which protocol
// version was negotiated, whether the chain validated, or how long the leaf has left. Those
// are the facts the control is about, so they are what gets measured and hashed.

import tls from 'node:tls';
import { createHash } from 'node:crypto';

const ACCEPTABLE = new Set(['TLSv1.2', 'TLSv1.3']);

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: true, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate(false);
        resolve({
          reachable: true,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError?.message ?? null,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name ?? null,
          subject: cert?.subject?.CN ?? null,
          issuer: cert?.issuer?.O ?? cert?.issuer?.CN ?? null,
          valid_from: cert?.valid_from ?? null,
          valid_to: cert?.valid_to ?? null,
        });
        socket.end();
      },
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ reachable: false, error: `timed out after ${timeoutMs}ms` });
    });
    socket.on('error', (err) => {
      // A handshake rejected for a bad chain is a FAIL (we learned something).
      // A DNS or refused-connection error is an ERROR (we learned nothing).
      resolve({
        reachable: err.code !== 'ENOTFOUND' && err.code !== 'ECONNREFUSED',
        error: err.message,
        code: err.code ?? null,
        authorized: false,
      });
    });
  });
}

export const kind = 'tls_endpoint';
export const version = '0.2.0';
export const title = 'Public endpoints enforce TLS 1.2+ with a valid chain';
export const description =
  'Opens a real TLS socket to each host and records the negotiated protocol, cipher, chain validity and days left on the leaf certificate. An HTTP 200 proves something answered; it says nothing about which protocol was negotiated or whether the chain validated.';
export const defaultSeverity = 'high';
export const requiresHostAccess = false;
export const suggestedControls = ['CRY-TLS-TRANSIT', 'NET-BOUNDARY'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
    return { ok: false, reason: 'hosts must be a non-empty array of hostnames' };
  }
  for (const h of config.hosts) {
    if (typeof h !== 'string' || !h.trim()) return { ok: false, reason: 'each host must be a non-empty string' };
  }
  if (config.port !== undefined && (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)) {
    return { ok: false, reason: 'port must be an integer between 1 and 65535' };
  }
  const days = config.min_days_remaining ?? 21;
  if (typeof days !== 'number' || days < 0) {
    return { ok: false, reason: 'min_days_remaining must be a non-negative number' };
  }
  return { ok: true };
}

// config: { hosts: string[], port?: number, min_days_remaining?: number, timeout_ms?: number }
export async function run(config) {
  const port = config.port ?? 443;
  const minDays = config.min_days_remaining ?? 21;
  const timeoutMs = config.timeout_ms ?? 8000;
  const hosts = config.hosts ?? [];

  if (!hosts.length) {
    return { status: 'error', message: 'no hosts configured', observed: {} };
  }

  const results = {};
  for (const host of hosts) {
    const r = await probe(host, port, timeoutMs);
    if (r.valid_to) {
      r.days_remaining = Math.floor((Date.parse(r.valid_to) - Date.now()) / 86_400_000);
    }
    results[host] = r;
  }

  const unreachable = hosts.filter((h) => !results[h].reachable);
  const failing = hosts.filter((h) => {
    const r = results[h];
    if (!r.reachable) return false;
    if (!r.authorized) return true;
    if (!ACCEPTABLE.has(r.protocol)) return true;
    if (typeof r.days_remaining === 'number' && r.days_remaining < minDays) return true;
    return false;
  });

  // Unreachable is 'error', not 'fail'. Reporting "no failures" when nothing could be
  // measured is the silent-success bug that makes a monitor worse than no monitor.
  let status, message;
  if (unreachable.length) {
    status = 'error';
    message = `could not measure ${unreachable.length}/${hosts.length}: ${unreachable.join(', ')}`;
  } else if (failing.length) {
    status = 'fail';
    message = `${failing.length}/${hosts.length} endpoint(s) non-compliant: ${failing.join(', ')}`;
  } else {
    status = 'pass';
    message = `${hosts.length}/${hosts.length} endpoints on TLS 1.2+ with valid chains and >=${minDays}d remaining`;
  }

  const observed = { port, min_days_remaining: minDays, checked_at: new Date().toISOString(), results };
  return {
    status,
    message,
    observed,
    // Hash covers the observation, so the stored evidence can be shown not to have drifted
    // from what the collector actually saw.
    content_hash: createHash('sha256').update(JSON.stringify(observed)).digest('hex'),
  };
}
