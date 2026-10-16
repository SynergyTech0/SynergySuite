#!/usr/bin/env node
//
// Synergy Trust collector agent.
//
// Runs ON a monitored host. Asks the server what to measure, measures it locally, posts the
// results back. Nothing listens; nothing inbound is required; the server holds no
// credentials into this machine.
//
//   STRUST_SERVER=https://trust.example.com \
//   STRUST_AGENT_TOKEN=... \
//   node strust-agent.mjs
//
// Add --once for a single pass (what a cron entry wants), or leave it to loop on an
// interval (what a systemd service wants).
//
//   17 * * * *  STRUST_SERVER=... STRUST_AGENT_TOKEN=... node /opt/strust/strust-agent.mjs --once
//
// WHAT THIS AGENT IS TRUSTED WITH
//
// Very little, on purpose. It cannot decide what to measure — it is told. It cannot report
// for a monitor it was not assigned; the server checks. It cannot backdate a result past a
// clamp. Its token is a credential for submitting observations, not for authoring them. If
// this host is compromised, the blast radius is false observations about the monitors this
// host already owned, and those land in an append-only, hash-chained log where they can be
// found afterwards.
//
// It needs the collector modules alongside it (the `collectors/` directory), which is the
// same code the server runs — so an observation means the same thing wherever it was made.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const SERVER = (process.env.STRUST_SERVER ?? '').replace(/\/+$/, '');
const TOKEN = process.env.STRUST_AGENT_TOKEN ?? '';
const ONCE = process.argv.includes('--once');
const INTERVAL_MIN = Number(process.env.STRUST_INTERVAL_MINUTES ?? 60);

let VERSION = '0.1.0';
try {
  VERSION = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version ?? VERSION;
} catch {
  /* running from a bare copy without package.json is fine */
}

if (!SERVER || !TOKEN) {
  console.error(
    'STRUST_SERVER and STRUST_AGENT_TOKEN are both required.\n' +
      'Enrol an agent in the web UI (Monitors -> Agents) to get a token; it is shown once.',
  );
  process.exit(2);
}

// Collectors are loaded from the copy shipped beside the agent. Importing them rather than
// reimplementing them is the point: the same code, so the same observation.
const { COLLECTORS } = await import(join(here, 'collectors', 'registry.mjs'));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function api(path, init = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'x-agent-version': VERSION,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

/**
 * Rewrites any host in a config to `localhost`.
 *
 * The server stores a config describing the machine from its own perspective — an IP, a
 * hostname. The agent IS that machine, so every host reference becomes local and the SSH
 * transport disappears beneath the collector. This is what removes the credential-custody
 * problem entirely rather than merely moving it.
 */
function localise(config) {
  const c = { ...(config ?? {}) };
  if (Array.isArray(c.hosts)) c.hosts = ['localhost'];
  if (typeof c.host === 'string') c.host = 'localhost';
  return c;
}

async function runOnce() {
  const assignments = await api('/api/agent/assignments');
  if (assignments.status === 401) {
    log('ERROR  token rejected:', assignments.body.error);
    return { fatal: true };
  }
  if (assignments.status !== 200) {
    log('ERROR  could not fetch assignments:', assignments.status, assignments.body.error ?? '');
    return {};
  }

  const list = assignments.body.assignments ?? [];
  log(`assigned ${list.length} monitor(s) for ${assignments.body.agent?.host ?? 'this host'}`);
  if (!list.length) return {};

  const results = [];
  for (const m of list) {
    const collector = COLLECTORS.get(m.kind);
    const startedAt = new Date().toISOString();

    if (!collector) {
      // Reported, not skipped. A silently skipped monitor looks monitored and is not.
      results.push({
        monitor: m.key,
        status: 'error',
        message: `agent has no collector for kind '${m.kind}' — agent may need updating`,
        observed: { agent_version: VERSION, kind: m.kind },
        started_at: startedAt,
      });
      log(`  ERROR ${m.key}: no collector for '${m.kind}'`);
      continue;
    }

    try {
      const outcome = await collector.run(localise(m.config), {});
      results.push({
        monitor: m.key,
        status: outcome.status,
        message: outcome.message,
        observed: { ...outcome.observed, collected_by_agent: true, agent_version: VERSION },
        content_hash: outcome.content_hash,
        started_at: startedAt,
      });
      log(`  ${outcome.status.toUpperCase().padEnd(5)} ${m.key}: ${outcome.message.slice(0, 110)}`);
    } catch (err) {
      results.push({
        monitor: m.key,
        status: 'error',
        message: `collector threw: ${err.message}`,
        observed: { agent_version: VERSION },
        started_at: startedAt,
      });
      log(`  ERROR ${m.key}: ${err.message}`);
    }
  }

  const report = await api('/api/agent/report', {
    method: 'POST',
    body: JSON.stringify({ results }),
  });
  if (report.status !== 200) {
    log('ERROR  report rejected:', report.status, report.body.error ?? '');
    return {};
  }
  log(`reported ${report.body.accepted} accepted, ${report.body.rejected?.length ?? 0} rejected`);
  for (const r of report.body.rejected ?? []) log(`  REJECTED ${r.monitor}: ${r.reason}`);
  return { accepted: report.body.accepted };
}

if (ONCE) {
  const { fatal } = await runOnce();
  process.exit(fatal ? 1 : 0);
} else {
  log(`agent ${VERSION} starting, reporting to ${SERVER} every ${INTERVAL_MIN}m`);
  for (;;) {
    try {
      const { fatal } = await runOnce();
      if (fatal) process.exit(1);
    } catch (err) {
      // Never exit on a transient failure: an agent that dies on one bad night leaves a
      // silent hole in the evidence series that nobody notices until the audit.
      log('ERROR  run failed:', err.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60_000));
  }
}
