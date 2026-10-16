// Collector metadata for the UI, derived from the runtime registry.
//
// Nothing here is hand-listed: a kind cannot appear in the UI without a collector actually
// backing it, which is the inverse of the usual drift where a roadmap list implies a
// capability that does not exist.

export { collectorCatalogue, validateMonitorConfig } from './collectors/registry.mjs';

import { collectorCatalogue } from './collectors/registry.mjs';

export const COLLECTOR_KINDS = collectorCatalogue();
