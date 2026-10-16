// The one pattern that decides whether an asset's NAME suggests it holds regulated health
// data. Exported from a single place because it is used twice for opposite purposes:
//
//   scripts/import-assets.mjs  classifies a newly discovered asset `restricted`
//   collectors/asset-inventory.mjs  flags an asset that is NOT classified restricted
//
// Those two have to encode the same judgement. Kept as separate literals they drifted
// immediately: the collector's copy omitted `care`, `rx` and `vital`, so the importer
// would classify `billing-care` as restricted while the collector reported no suspects -
// a check that agreed with itself and with nothing else.
//
// Short tokens are anchored. `aba` (applied behaviour analysis) and `hh` (home health) are
// real PHI markers, but unanchored `aba` matches "database" and unanchored `hh` matches
// plenty of hashes - a collector that cries PHI over every Postgres container is one whose
// output gets ignored, which costs more than the check is worth.
const LONG = 'emr|health|clinic|patient|pdmp|medic|therap|pharma|dental|vital|phi';
const SHORT = 'aba|hh|rx|care';

export const PHI_NAME_PATTERN = `(${LONG}|(^|[^a-z])(${SHORT})([^a-z]|$))`;

// Postgres regex and JavaScript regex agree on this subset, so the same string serves
// `name ~* $1` in SQL and a RegExp here. Verified against both, not assumed.
export function suggestsPhi(name) {
  return new RegExp(PHI_NAME_PATTERN, 'i').test(String(name));
}
