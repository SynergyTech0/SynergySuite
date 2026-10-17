import { q } from "../db";
import { Crash, JobContext, Stopped, isFatal, limitsFromEnv, type Hooks } from "./context";
import { importOneDrive, importSite } from "./files";
import { Graph, type GraphOptions } from "./graph";
import { importImapMail } from "./imap";
import { importMail } from "./mail";
import { importCalendar, importContacts, importTodo } from "./pim";
import { open } from "./secret";
import { emptyReport, source as getSource, site as getSite, user as getUser, type JobRow } from "./store";
import { HttpSuite, type Suite } from "./suite";
import { NOT_MIGRATED, type Workload } from "./types";

/**
 * The background worker. Jobs wait in migration_jobs; the worker takes the oldest (one row lock
 * per job, so two Admin center processes never run the same one) and runs its workloads in turn.
 * A job keeps its report and every delta link as it goes, so when the process dies mid-job the
 * job is picked up again where it stopped. A run that fails as a whole (Microsoft or a suite app
 * unreachable, throttled past the retries) is tried again later, up to MAX_ATTEMPTS times.
 */

export const MAX_ATTEMPTS = 5;
/** A running job whose worker hasn't written for this long is taken to be dead and resumed. */
export const STALE_MS = 3 * 60_000;

export type RunnerDeps = { suite?: Suite; graph?: GraphOptions; hooks?: Hooks };

const g = globalThis as unknown as {
  __migrateWorker?: { timer: NodeJS.Timeout | null; active: number; deps: RunnerDeps; recovered: boolean };
};

function state() {
  return (g.__migrateWorker ??= { timer: null, active: 0, deps: {}, recovered: false });
}

/** Jobs left "running" by a process that is gone go back in the queue, keeping what they did. */
export async function recoverStale(olderThanMs = STALE_MS): Promise<number> {
  const rows = await q(
    `UPDATE migration_jobs SET status = 'queued', not_before = NULL
     WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => $1)) RETURNING id`,
    [olderThanMs / 1000],
  );
  return rows.length;
}

/** Takes the next job that is due, or null. */
export async function claim(): Promise<JobRow | null> {
  const [r] = await q<JobRow>(
    `UPDATE migration_jobs SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, now()), heartbeat_at = now(), error = NULL
     WHERE id = (SELECT id FROM migration_jobs WHERE status = 'queued' AND (not_before IS NULL OR not_before <= now())
                 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
  );
  return r ?? null;
}

/** The source's mapped people: their source address → their suite address. */
async function mappingOf(sourceId: string): Promise<Map<string, string>> {
  const rows = await q<{ email: string; target: string }>(`SELECT email, target FROM migration_users WHERE source_id = $1 AND target IS NOT NULL AND target <> ''`, [sourceId]);
  return new Map(rows.map((r) => [r.email.toLowerCase(), r.target.toLowerCase()]));
}

/** Runs one claimed job to its end (done, failed, queued again for later, or left as it is when the process "crashes"). */
export async function runJob(job: JobRow, deps: RunnerDeps = state().deps): Promise<void> {
  const report = { ...emptyReport(), ...(job.report ?? {}) };
  if (!report.runs || job.attempts <= 1) report.runs = (report.runs ?? 0) + 1;
  job.progress ??= {};
  try {
    const src = await getSource(job.source_id);
    if (!src) throw new Error("The source was removed");
    const suite = deps.suite ?? new HttpSuite();
    const mapping = await mappingOf(src.id);
    let graph: Graph | null = null;
    if (src.kind === "m365") {
      const cfg = src.config as { tenantId: string; clientId: string };
      graph = new Graph({ tenantId: cfg.tenantId, clientId: cfg.clientId, clientSecret: open(src.secret) }, deps.graph);
      report.notMigrated = NOT_MIGRATED;
    }
    const who = { email: job.target, name: job.label };
    const ctx = new JobContext(job, src, who, suite, report, limitsFromEnv(), graph, mapping, deps.hooks);
    await ctx.checkpoint(true);

    if (job.subject_kind === "site") {
      const s = await getSite(src.id, job.subject_id);
      if (!s) throw new Error("The site is no longer in the list; run discovery again");
      await importSite(ctx, { name: s.name, members: s.members });
    } else if (src.kind === "imap") {
      const u = await getUser(src.id, job.subject_id);
      if (!u) throw new Error("This mailbox is no longer in the list");
      const cfg = src.config as { host: string; port: number; secure: boolean };
      await importImapMail(ctx, { host: cfg.host, port: Number(cfg.port), secure: cfg.secure !== false }, u.ext_id, open(u.secret));
    } else {
      const order: [Workload, (c: JobContext) => Promise<void>][] = [
        ["mail", importMail], ["files", importOneDrive], ["calendar", importCalendar], ["contacts", importContacts], ["todo", importTodo],
      ];
      for (const [w, fn] of order) {
        if (!job.workloads.includes(w)) continue;
        ctx.counts(w);
        try {
          await fn(ctx);
        } catch (e) {
          if (isFatal(e)) throw e;
          // One workload failing as a whole (say To Do not licensed) doesn't stop the others.
          await ctx.failed(w, w, e);
        }
      }
    }
    job.progress.step = "";
    job.progress.workload = undefined;
    await q(`UPDATE migration_jobs SET status = 'done', finished_at = now(), progress = $2, report = $3, heartbeat_at = now() WHERE id = $1 AND status = 'running'`, [
      job.id, JSON.stringify(job.progress), JSON.stringify(report),
    ]);
  } catch (e) {
    if (e instanceof Crash) throw e; // tests: the process "died"; leave the row as a dead process would
    if (e instanceof Stopped) return; // cancelled: the row already says so
    const message = (e as Error).message || "Something went wrong";
    if (job.attempts < MAX_ATTEMPTS && isFatal(e)) {
      const waitS = Math.min(60 * 2 ** (job.attempts - 1), 30 * 60);
      await q(
        `UPDATE migration_jobs SET status = 'queued', not_before = now() + make_interval(secs => $2), error = $3, report = $4 WHERE id = $1 AND status = 'running'`,
        [job.id, waitS, `${message} (trying again in ${Math.round(waitS / 60)} min)`, JSON.stringify(report)],
      );
      return;
    }
    if (!isFatal(e)) console.error("[admin] migration job", job.id, (e as Error).message);
    await q(`UPDATE migration_jobs SET status = 'failed', finished_at = now(), error = $2, report = $3 WHERE id = $1 AND status = 'running'`, [
      job.id, message.slice(0, 500), JSON.stringify(report),
    ]);
  }
}

/** Runs queued jobs until none is due (tests call this; the worker does it on a timer). */
export async function drain(deps?: RunnerDeps, limit = 1000): Promise<number> {
  let n = 0;
  for (; n < limit; n++) {
    const job = await claim();
    if (!job) break;
    await runJob(job, deps);
  }
  return n;
}

function concurrency(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.MIGRATION_CONCURRENCY || 2);
  return Number.isInteger(v) && v >= 1 && v <= 16 ? v : 2;
}

async function tick(): Promise<void> {
  const s = state();
  if (!s.recovered) {
    await recoverStale(0);
    s.recovered = true;
  } else await recoverStale();
  while (s.active < concurrency()) {
    const job = await claim();
    if (!job) break;
    s.active++;
    void runJob(job, s.deps)
      .catch((e) => console.error("[admin] migration job", job.id, (e as Error).message))
      .finally(() => {
        s.active--;
      });
  }
}

/** Starts the background worker once per process (it checks for due jobs every few seconds). */
export function startWorker(deps: RunnerDeps = {}): void {
  const s = state();
  s.deps = deps;
  if (s.timer) return;
  const run = () => void tick().catch((e) => console.error("[admin] migration worker", (e as Error).message));
  s.timer = setInterval(run, 5000);
  s.timer.unref?.();
  run();
}

export function stopWorker(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
}
