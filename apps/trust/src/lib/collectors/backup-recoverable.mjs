// Collector: backup_recoverable
//
// Asserts that every database that EXISTS is backed up, recently, and in an archive that
// actually decompresses.
//
// WHAT THIS IS WRITTEN AGAINST
//
// "The backup job exited 0" is not evidence. Neither is "the file is there", and neither is
// file size: an archive of a genuinely empty Docker volume is a few dozen bytes, which looks
// exactly like a truncated backup. A size threshold raises a false alarm for every empty
// volume, and an operator who sees dozens of false alarms stops reading the alerts.
//
// So the checks that matter are the ones with a source of truth to compare against:
//
//   1. COVERAGE. Enumerate the databases actually running, and assert each appears in the
//      manifest. This is a common failure mode — the nightly job skips
//      any container whose image is not postgres-like, silently, with no error. A database
//      ends up unprotected and nothing reports it.
//   2. STATUS. Every manifest row must say OK. A row that says anything else is a backup
//      that did not happen, however many bytes are on disk.
//   3. FRESHNESS. Measured against the manifest's own timestamp, not the file mtime of
//      whatever happened to be written last.
//   4. INTEGRITY. `gzip -t` on a sample of dumps. That decompresses the whole stream and
//      verifies the CRC, so a truncated or corrupt dump fails here rather than during a
//      restore at 3am.
//
// A full restore-into-a-throwaway-container drill is stronger still and is what the
// `restore-drill` runbook does monthly. This runs nightly and catches everything cheaper.

import { createHash } from 'node:crypto';
import { sshExec, SshError } from './ssh.mjs';

export const kind = 'backup_recoverable';
export const version = '0.1.0';
export const title = 'Backups exist, cover every database, and decompress';
export const description =
  'Reads the backup manifest on the host, cross-checks it against the databases actually running, and runs a gzip integrity test over a sample of dumps. Coverage is checked against live containers because the nightly job silently skips anything it does not recognise.';
export const defaultSeverity = 'critical';
export const requiresHostAccess = true;
export const suggestedControls = ['OPS-BACKUP-RESTORE'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!config.host || typeof config.host !== 'string') {
    return { ok: false, reason: 'host is required (the machine holding the backups)' };
  }
  if (!config.backup_root || typeof config.backup_root !== 'string') {
    return { ok: false, reason: 'backup_root is required, e.g. /var/backups' };
  }
  if (config.backup_root.includes("'") || config.backup_root.includes('$')) {
    return { ok: false, reason: 'backup_root must not contain quotes or shell expansions' };
  }
  const age = config.max_age_hours ?? 36;
  if (typeof age !== 'number' || age <= 0) return { ok: false, reason: 'max_age_hours must be a positive number' };
  return { ok: true };
}

export async function run(config) {
  const root = config.backup_root;
  const maxAgeHours = config.max_age_hours ?? 36;
  const sampleSize = config.integrity_sample ?? 3;

  // One round trip. Each section is delimited so a partial result is still parseable rather
  // than being thrown away whole.
  const script = `
set -u
LATEST=$(ls -1d ${root}/*/ 2>/dev/null | sort | tail -1)
if [ -z "$LATEST" ]; then echo "__NO_BACKUP_DIR__"; exit 0; fi
echo "###DIR"; echo "$LATEST"
echo "###MTIME"; stat -c %Y "$LATEST/MANIFEST.txt" 2>/dev/null || echo 0
echo "###MANIFEST"; cat "$LATEST/MANIFEST.txt" 2>/dev/null
echo "###LIVE"; docker ps --format '{{.Names}}|{{.Image}}' 2>/dev/null | grep -iE 'postgres|pgvector|mysql|mariadb|mongo' || true
echo "###INTEGRITY"
for f in $(ls -1 "$LATEST"/*.sql.gz 2>/dev/null | head -${sampleSize}); do
  if gzip -t "$f" 2>/dev/null; then echo "OK|$(basename $f)"; else echo "CORRUPT|$(basename $f)"; fi
done
echo "###END"`.trim();

  let raw;
  try {
    raw = await sshExec({
      host: config.host,
      user: config.user,
      keyPath: config.key_path,
      command: script,
      timeoutMs: config.timeout_ms ?? 60_000,
    });
  } catch (err) {
    // Unreachable is 'error', never 'fail'. We learned nothing about the backups.
    return {
      status: 'error',
      message:
        err instanceof SshError
          ? `could not reach ${config.host}: ${err.message}`
          : `collector failed: ${err.message}`,
      observed: { host: config.host, error: String(err.message) },
    };
  }

  if (raw.includes('__NO_BACKUP_DIR__')) {
    return {
      status: 'fail',
      message: `no backup directory found under ${root} on ${config.host}`,
      observed: { host: config.host, backup_root: root, found: false },
      content_hash: hash({ host: config.host, root, found: false }),
    };
  }

  const section = (name) => {
    const start = raw.indexOf(`###${name}\n`);
    if (start === -1) return '';
    const from = start + name.length + 4;
    const next = raw.indexOf('\n###', from);
    return raw.slice(from, next === -1 ? undefined : next).trim();
  };

  const dir = section('DIR');
  const manifestMtime = Number(section('MTIME')) * 1000;
  const manifestLines = section('MANIFEST').split('\n').filter(Boolean);
  const liveLines = section('LIVE').split('\n').filter(Boolean);
  const integrityLines = section('INTEGRITY').split('\n').filter(Boolean);

  // Manifest carries two row shapes: a 5-field database row ending in a status, and a
  // 4-field volume row. Parse by field count rather than guessing from the name.
  const databases = [];
  const volumes = [];
  // Cluster roles are recorded as `<container>|globals|<bytes>|roles=<n>|OK`. That row has
  // five fields like a database row, so parsing by field count alone counted it AS a
  // database - inflating the backed-up count and reading `roles=3` as a table count.
  // Matched on the literal second field before the shape test, not after.
  const globals = [];
  for (const line of manifestLines) {
    const parts = line.split('|');
    if (parts[1] === 'globals') {
      globals.push({ container: parts[0], bytes: Number(parts[2]) || 0, status: parts[parts.length - 1] });
    } else if (parts.length >= 5) {
      databases.push({
        container: parts[0],
        database: parts[1],
        bytes: Number(parts[2]) || 0,
        tables: Number(String(parts[3]).replace('tables=', '')) || 0,
        status: parts[4],
      });
    } else if (parts.length === 4) {
      volumes.push({ name: parts[0], bytes: Number(parts[2]) || 0, status: parts[3] });
    }
  }

  const backedUp = new Set(databases.map((d) => d.container));
  const live = liveLines.map((l) => {
    const [name, image] = l.split('|');
    return { name, image };
  });
  const unbacked = live.filter((c) => !backedUp.has(c.name));

  // A globals capture that was ATTEMPTED and FAILED is a real defect: the roles that
  // enforce RLS and the read-only auditor seat would not come back. Absence is reported
  // but not failed - a database whose only role is its own owner loses nothing, and the
  // collector cannot tell which from the manifest alone. Once the nightly run has emitted
  // a globals row per container, absence becomes meaningful and this can tighten.
  const globalsFailed = globals.filter((g) => g.status !== 'OK');
  const globalsCovered = new Set(globals.filter((g) => g.status === 'OK').map((g) => g.container));

  const notOk = databases.filter((d) => d.status !== 'OK');
  const emptyDumps = databases.filter((d) => d.status === 'OK' && d.tables > 0 && d.bytes === 0);
  const corrupt = integrityLines.filter((l) => l.startsWith('CORRUPT')).map((l) => l.split('|')[1]);
  const verified = integrityLines.filter((l) => l.startsWith('OK')).map((l) => l.split('|')[1]);

  const ageHours = manifestMtime ? (Date.now() - manifestMtime) / 3_600_000 : null;
  const stale = ageHours === null || ageHours > maxAgeHours;

  const observed = {
    host: config.host,
    backup_dir: dir,
    manifest_age_hours: ageHours === null ? null : Number(ageHours.toFixed(1)),
    max_age_hours: maxAgeHours,
    databases_backed_up: databases.length,
    volumes_recorded: volumes.length,
    live_database_containers: live.length,
    unbacked_containers: unbacked,
    manifest_not_ok: notOk,
    empty_dumps: emptyDumps,
    integrity_verified: verified,
    integrity_corrupt: corrupt,
    // Restoring tables and rows without the cluster roles brings the data back and drops
    // every GRANT: 63 `role does not exist` errors on strust, where tenant isolation lives.
    globals_captured: globals.filter((g) => g.status === 'OK').length,
    globals_failed: globalsFailed.map((g) => g.container),
    globals_missing: live.filter((c) => !globalsCovered.has(c.name)).map((c) => c.name),
    checked_at: new Date().toISOString(),
  };

  const problems = [];
  // Coverage first: an unprotected database is a worse finding than a stale backup of one
  // that is protected, and it is the one nothing else in the estate reports.
  if (unbacked.length) {
    problems.push(
      `${unbacked.length} running database container(s) absent from the manifest: ` +
        unbacked.map((c) => c.name).join(', '),
    );
  }
  if (globalsFailed.length) {
    problems.push(
      `${globalsFailed.length} container(s) failed to capture cluster roles, so a restore ` +
        `would lose their GRANTs: ${globalsFailed.map((g) => g.container).join(', ')}`,
    );
  }
  if (notOk.length) problems.push(`${notOk.length} manifest row(s) not marked OK`);
  if (emptyDumps.length) problems.push(`${emptyDumps.length} dump(s) of zero bytes despite having tables`);
  if (corrupt.length) problems.push(`${corrupt.length} dump(s) failed a gzip integrity test: ${corrupt.join(', ')}`);
  if (stale) {
    problems.push(
      ageHours === null
        ? 'manifest has no readable timestamp'
        : `newest backup is ${ageHours.toFixed(1)}h old (limit ${maxAgeHours}h)`,
    );
  }

  return {
    status: problems.length ? 'fail' : 'pass',
    message: problems.length
      ? problems.join('; ')
      : `${databases.length} databases backed up ${ageHours.toFixed(1)}h ago, all ${live.length} live containers covered, ${verified.length} dump(s) passed integrity, ` +
        `cluster roles captured for ${globalsCovered.size}/${live.length}` +
        (observed.globals_missing.length
          ? ` (${observed.globals_missing.length} without, whose GRANTs would not restore)`
          : ''),
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
