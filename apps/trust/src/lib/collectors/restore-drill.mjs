// Collector: restore_drill
//
// The backup_recoverable collector answers "does a dump exist, is it fresh, and is the gzip
// intact". That is necessary and it is not sufficient: a dump can pass all three and still
// restore with dozens of `role does not exist` errors, because pg_dump of one database never
// emits CREATE ROLE. Tables and rows come back; every GRANT does not. The gzip is perfect.
//
// This reads the nightly restore drill instead - the thing that actually restores each dump
// into a throwaway container and counts the rows that landed against the live database. It
// is the difference between "a backup exists" and "the backup restores", and ISO A.8.13 and
// SOC 2 A1.2 both ask for the second.
//
// WHAT IT ASSERTS, AND WHY COVERAGE IS THE REAL CONTROL
//
// "Did last night's drill pass" is the easy question and the less useful one. The drill
// rotates: it restores the least-recently-tested dumps under a size budget, because the set
// can be far larger than one night's scratch space. So the question that matters is per-dump
// and historical - WHEN was THIS backup last restore-tested - and a dump that has never been
// drilled at all is the one to worry about, not the one that failed last night loudly.
//
// A dump present in the backup set with no drill record is therefore a finding in its own
// right, separate from a failure.

import { createHash } from 'node:crypto';
import { sshExec, SshError } from './ssh.mjs';

export const kind = 'restore_drill';
export const version = '0.1.0';
export const title = 'Backups are restore-tested on a rotation, and the restores succeed';
export const description =
  'Reads the nightly restore drill: each dump is restored into a throwaway container and its row counts compared against the live database. Checks that the drill ran, that what it drilled restored cleanly, and that every dump in the backup set has been restore-tested within the coverage window.';
export const defaultSeverity = 'critical';
export const requiresHostAccess = true;
export const selfReferential = false;
export const suggestedControls = ['OPS-BACKUP-RESTORE', 'OPS-BCDR'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!config.host || typeof config.host !== 'string') {
    return { ok: false, reason: 'host is required' };
  }
  const age = config.max_age_hours ?? 48;
  if (typeof age !== 'number' || age <= 0) {
    return { ok: false, reason: 'max_age_hours must be a positive number' };
  }
  const cov = config.max_coverage_days ?? 35;
  if (typeof cov !== 'number' || cov <= 0) {
    return { ok: false, reason: 'max_coverage_days must be a positive number' };
  }
  if (config.summary_path !== undefined && typeof config.summary_path !== 'string') {
    return { ok: false, reason: 'summary_path must be a string' };
  }
  if (config.backup_root !== undefined && typeof config.backup_root !== 'string') {
    return { ok: false, reason: 'backup_root must be a string' };
  }
  if (config.unit !== undefined && !/^[A-Za-z0-9@_.-]+$/.test(String(config.unit))) {
    return { ok: false, reason: 'unit must be a systemd unit name without a suffix, e.g. restore-drill' };
  }
  return { ok: true };
}

export async function run(config) {
  const summaryPath = config.summary_path ?? '/var/lib/restore-drill/latest.json';
  const root = config.backup_root ?? '/var/backups';
  // The drill runs as <unit>.service on <unit>.timer.
  const unit = config.unit ?? 'restore-drill';
  const maxAgeHours = config.max_age_hours ?? 48;
  const maxCoverageDays = config.max_coverage_days ?? 35;

  // The drill's own summary is not enough on its own: it lists the dumps it has state for,
  // so a dump that has NEVER been drilled is absent from it rather than visibly untested.
  // The backup set is the denominator, and it has to be read from the host.
  const script = `
set -u
echo "###SUMMARY"; cat ${summaryPath} 2>/dev/null
echo "###MTIME"; stat -c %Y ${summaryPath} 2>/dev/null || echo 0
LATEST=$(ls -1d ${root}/20* 2>/dev/null | sort | tail -1)
echo "###SET"; [ -n "$LATEST" ] && basename "$LATEST" || true
echo "###DUMPS"; [ -n "$LATEST" ] && (cd "$LATEST" && ls -1 *.sql.gz 2>/dev/null) || true
echo "###TIMER"; systemctl is-enabled ${unit}.timer 2>/dev/null || echo unknown
echo "###LASTRUN"; systemctl show -p Result --value ${unit}.service 2>/dev/null || echo unknown
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
    // Unreachable is 'error', never 'fail'. We learned nothing about the drill, and a
    // monitor that reports "fail" when it could not measure teaches people to ignore it.
    return {
      status: 'error',
      message:
        err instanceof SshError
          ? `could not reach ${config.host}: ${err.message}`
          : `collector failed: ${err.message}`,
      observed: { host: config.host, error: String(err.message) },
    };
  }

  const section = (name) => {
    const start = raw.indexOf(`###${name}\n`);
    if (start === -1) return '';
    const from = start + name.length + 4;
    const next = raw.indexOf('\n###', from);
    return raw.slice(from, next === -1 ? undefined : next).trim();
  };

  const summaryRaw = section('SUMMARY');
  const timerEnabled = section('TIMER');
  const lastRunResult = section('LASTRUN');
  const backupSet = section('SET');
  const dumps = section('DUMPS').split('\n').map((x) => x.trim()).filter(Boolean);

  if (!summaryRaw) {
    // No summary at all. The drill wrapper writes one on every exit path including its own
    // refusals, so an absent file means it has never completed once - which is a finding,
    // not an outage.
    const observed = {
      host: config.host,
      summary_path: summaryPath,
      found: false,
      timer_enabled: timerEnabled,
      dumps_in_set: dumps.length,
      checked_at: new Date().toISOString(),
    };
    return {
      status: 'fail',
      message:
        `no restore-drill summary at ${summaryPath} on ${config.host} — ` +
        `${dumps.length} dump(s) in the backup set have never been restore-tested`,
      observed,
      content_hash: hash(observed),
    };
  }

  let summary;
  try {
    summary = JSON.parse(summaryRaw);
  } catch (err) {
    return {
      status: 'error',
      message: `restore-drill summary at ${summaryPath} is not valid JSON: ${err.message}`,
      observed: { host: config.host, summary_path: summaryPath, parse_error: String(err.message) },
    };
  }

  const mtime = Number(section('MTIME')) * 1000;
  const ageHours = mtime ? (Date.now() - mtime) / 3_600_000 : null;

  const drilled = Array.isArray(summary.drilled) ? summary.drilled : [];
  const coverage = Array.isArray(summary.coverage) ? summary.coverage : [];

  const covByDump = new Map(coverage.map((c) => [c.dump, c]));
  const nowSec = Date.now() / 1000;
  const cutoff = maxCoverageDays * 86_400;

  // Per-dump coverage against the backup set, which is the denominator that matters. A dump
  // the drill has no record of is untested, however well last night's run went.
  const neverDrilled = [];
  const staleCoverage = [];
  const failingCoverage = [];
  for (const d of dumps) {
    const c = covByDump.get(d);
    if (!c || !c.last_drilled) {
      neverDrilled.push(d);
      continue;
    }
    const age = nowSec - Number(c.last_drilled);
    if (age > cutoff) {
      staleCoverage.push({ dump: d, days: Number((age / 86_400).toFixed(1)) });
    }
    if (c.outcome && c.outcome !== 'ok') {
      failingCoverage.push({ dump: d, outcome: c.outcome });
    }
  }

  const badDrills = drilled.filter((x) => Number(x.errors) !== 0);
  const tableMismatch = drilled.filter(
    (x) => Number(x.errors) === 0 && Number(x.restored_tables) !== Number(x.live_tables),
  );

  const tested = dumps.length - neverDrilled.length;
  const observed = {
    host: config.host,
    summary_path: summaryPath,
    drill_status: summary.status ?? null,
    drill_note: summary.note ?? null,
    drill_set: summary.set ?? null,
    backup_set: backupSet,
    summary_age_hours: ageHours === null ? null : Number(ageHours.toFixed(1)),
    max_age_hours: maxAgeHours,
    timer_enabled: timerEnabled,
    last_service_result: lastRunResult,
    free_gb_at_drill: summary.free_gb ?? null,
    dumps_in_set: dumps.length,
    dumps_ever_restore_tested: tested,
    coverage_pct: dumps.length ? Number(((tested / dumps.length) * 100).toFixed(0)) : 0,
    max_coverage_days: maxCoverageDays,
    drilled_last_run: drilled.length,
    // Named, not just counted: an assessor sampling this picks rows.
    drilled_detail: drilled.slice(0, 20),
    restore_errors: badDrills.map((x) => ({ container: x.container, database: x.database, errors: x.errors })),
    table_mismatches: tableMismatch.map((x) => ({
      container: x.container,
      live_tables: x.live_tables,
      restored_tables: x.restored_tables,
    })),
    never_restore_tested: neverDrilled,
    coverage_older_than_window: staleCoverage,
    last_outcome_not_ok: failingCoverage,
    checked_at: new Date().toISOString(),
  };

  // An empty population is never a pass. "Every one of zero dumps restored" is true and
  // worthless, and it is exactly what a broken backup job plus a working drill looks like.
  if (dumps.length === 0) {
    return {
      status: 'error',
      message: `no dumps found under ${root} on ${config.host} — nothing to restore-test, which is not evidence that restores work`,
      observed,
      content_hash: hash(observed),
    };
  }

  const problems = [];
  // Correctness of what was actually tested comes first.
  if (badDrills.length) {
    problems.push(
      `${badDrills.length} dump(s) restored with errors: ` +
        badDrills.map((x) => `${x.container}/${x.database} (${x.errors})`).join(', '),
    );
  }
  if (tableMismatch.length) {
    problems.push(
      `${tableMismatch.length} dump(s) restored a different number of tables than live: ` +
        tableMismatch.map((x) => `${x.container} ${x.restored_tables}/${x.live_tables}`).join(', '),
    );
  }
  if (failingCoverage.length) {
    problems.push(
      `${failingCoverage.length} dump(s) whose last drill did not succeed: ` +
        failingCoverage.map((x) => `${x.dump} (${x.outcome})`).join(', '),
    );
  }
  // Then coverage, which is the control an assessor tests.
  if (neverDrilled.length) {
    problems.push(
      `${neverDrilled.length} of ${dumps.length} dump(s) have never been restore-tested: ` +
        neverDrilled.slice(0, 6).join(', ') +
        (neverDrilled.length > 6 ? `, +${neverDrilled.length - 6} more` : ''),
    );
  }
  if (staleCoverage.length) {
    problems.push(
      `${staleCoverage.length} dump(s) not restore-tested within ${maxCoverageDays}d: ` +
        staleCoverage.slice(0, 6).map((x) => `${x.dump} (${x.days}d)`).join(', '),
    );
  }
  if (ageHours === null || ageHours > maxAgeHours) {
    problems.push(
      ageHours === null
        ? 'drill summary has no readable timestamp'
        : `drill last ran ${ageHours.toFixed(1)}h ago (limit ${maxAgeHours}h)`,
    );
  }
  if (timerEnabled !== 'enabled') {
    problems.push(`${unit}.timer is '${timerEnabled}', so the drill is not scheduled`);
  }
  // The unit's own verdict, asserted and not merely recorded. If systemd kills the wrapper
  // — a timeout on a large restore, an OOM — the wrapper dies before it can write a
  // summary, so latest.json still holds the PREVIOUS run's result and reads as a success
  // that is hours old. Without this the only thing that would eventually notice is the
  // staleness check, 48 hours later. A drill the service says did not finish is a finding
  // now, whatever the last summary on disk says.
  if (lastRunResult && !['success', 'unknown', ''].includes(lastRunResult)) {
    problems.push(
      `${unit}.service last exited '${lastRunResult}', so the newest summary may predate a run that did not finish`,
    );
  }
  // The wrapper's own refusals (low disk, no target) surface here rather than passing as a
  // night with nothing to do.
  if (summary.status && summary.status !== 'ok') {
    problems.push(`last drill reported '${summary.status}': ${summary.note ?? 'no detail'}`);
  }

  return {
    status: problems.length ? 'fail' : 'pass',
    message: problems.length
      ? problems.join('; ')
      : `${drilled.length} dump(s) restored cleanly ${ageHours.toFixed(1)}h ago; ` +
        `all ${dumps.length} dump(s) in set ${backupSet} restore-tested within ${maxCoverageDays}d`,
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
