// The collector registry.
//
// Every collector exports the same contract, so the runner, the API and the UI can all
// treat them uniformly and nothing has to be listed twice:
//
//   kind                 unique identifier, matches monitors.kind
//   version              bumped when the OBSERVATION changes shape or meaning, because the
//                        version is recorded on every evidence row and is how a reviewer
//                        knows whether two observations are comparable
//   title, description   shown in the UI; the description says what is actually measured
//   defaultSeverity      used when a monitor does not override it
//   requiresHostAccess   true if it needs credentials into customer infrastructure — the
//                        product can then refuse to offer it on a hosted plan rather than
//                        quietly asking a customer for root (see ssh.mjs)
//   selfReferential      true if it measures Trust's own state rather than a
//                        customer system; these are the strongest evidence we can produce
//                        and need no credentials at all
//   suggestedControls    control keys this normally supports, used to pre-fill a new monitor
//   validateConfig(c)    -> { ok: true } | { ok: false, reason }
//   run(config, ctx)     -> { status, message, observed, content_hash? }
//
// `run` must return 'error' rather than 'fail' whenever it could not measure. A collector
// that reports a pass it did not observe is worse than no collector, and a collector that
// reports a failure it did not observe trains operators to ignore it.

import * as tlsEndpoint from './tls-endpoint.mjs';
import * as backupRecoverable from './backup-recoverable.mjs';
import * as portExposure from './port-exposure.mjs';
import * as sshHardening from './ssh-hardening.mjs';
import * as capacityHeadroom from './capacity-headroom.mjs';
import * as auditIntegrity from './audit-integrity.mjs';
import * as httpHeaders from './http-headers.mjs';
import * as dependencyVulns from './dependency-vulns.mjs';
import * as patchCurrency from './patch-currency.mjs';
import * as assetInventory from './asset-inventory.mjs';
import * as restoreDrill from './restore-drill.mjs';
import * as endpointCompliance from './endpoint-compliance.mjs';
import * as endpointThreats from './endpoint-threats.mjs';

const ALL = [
  tlsEndpoint,
  backupRecoverable,
  portExposure,
  sshHardening,
  capacityHeadroom,
  auditIntegrity,
  httpHeaders,
  dependencyVulns,
  patchCurrency,
  assetInventory,
  restoreDrill,
  endpointCompliance,
  endpointThreats,
];

// Fail at import rather than at 3am: a collector missing part of the contract would
// otherwise surface as an undefined call deep inside a scheduled run.
const REQUIRED = ['kind', 'version', 'title', 'description', 'defaultSeverity'];
for (const c of ALL) {
  for (const field of REQUIRED) {
    if (!c[field]) throw new Error(`collector '${c.kind ?? '(unknown)'}' is missing ${field}`);
  }
  if (typeof c.run !== 'function') throw new Error(`collector '${c.kind}' has no run()`);
  if (typeof c.validateConfig !== 'function') {
    throw new Error(`collector '${c.kind}' has no validateConfig()`);
  }
}

export const COLLECTORS = new Map(ALL.map((c) => [c.kind, c]));

/** Metadata for the UI and the API. Derived from the registry, never hand-listed. */
export function collectorCatalogue() {
  return ALL.map((c) => ({
    kind: c.kind,
    version: c.version,
    title: c.title,
    description: c.description,
    defaultSeverity: c.defaultSeverity,
    requiresHostAccess: !!c.requiresHostAccess,
    selfReferential: !!c.selfReferential,
    suggestedControls: c.suggestedControls ?? [],
  }));
}

/**
 * Validates a monitor's config against its collector.
 *
 * Called when a monitor is created or edited, so a typo is a 400 at save time rather than a
 * monitor that records `error` every night until somebody reads the run history.
 */
export function validateMonitorConfig(kind, config) {
  const collector = COLLECTORS.get(kind);
  if (!collector) {
    return {
      ok: false,
      reason: `no collector registered for kind '${kind}'. Available: ${[...COLLECTORS.keys()].join(', ')}`,
    };
  }
  return collector.validateConfig(config);
}
