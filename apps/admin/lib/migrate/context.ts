import { q } from "../db";
import { GraphError, type Graph } from "./graph";
import { Cursors, Items, emptyCounts, type JobRow, type SourceRow } from "./store";
import { SuiteError, type Suite, type Who } from "./suite";
import type { Counts, Report, Workload } from "./types";

/** Stopped on purpose (the job was cancelled): the runner leaves it as it is. */
export class Stopped extends Error {}

/** For tests: a stand-in for the process dying mid-job. The runner leaves the job "running". */
export class Crash extends Error {}

export type Limits = { maxMessageBytes: number; maxFileBytes: number; calendarPastDays: number; calendarFutureDays: number };

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Limits {
  const n = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  return {
    maxMessageBytes: n(env.MIGRATION_MAX_MESSAGE_MB, 45) * 1024 * 1024,
    maxFileBytes: n(env.MIGRATION_MAX_FILE_MB, 15 * 1024) * 1024 * 1024,
    calendarPastDays: n(env.MIGRATION_CALENDAR_PAST_DAYS, 3 * 365),
    calendarFutureDays: n(env.MIGRATION_CALENDAR_FUTURE_DAYS, 3 * 365),
  };
}

export type Hooks = {
  /** Called after each item is written; tests throw Crash here. */
  afterItem?: (workload: Workload, n: number) => void | Promise<void>;
};

const MAX_LISTED = 300;

/** Everything one run of a job has to hand: where from, where to, and its report. */
export class JobContext {
  readonly items: Items;
  readonly cursors: Cursors;
  private written = 0;
  private lastSave = 0;
  private readonly baseThrottled: number;

  constructor(
    readonly job: JobRow,
    readonly source: SourceRow,
    readonly who: Who,
    readonly suite: Suite,
    readonly report: Report,
    readonly limits: Limits,
    readonly graph: Graph | null,
    /** Source address (lower-case) → suite address, for every mapped user of this source. */
    readonly mapping: Map<string, string>,
    readonly hooks: Hooks = {},
  ) {
    this.items = new Items(source.id, job.subject_id);
    this.cursors = new Cursors(source.id, job.subject_id);
    this.baseThrottled = report.throttled ?? 0;
  }

  counts(w: Workload): Counts {
    return (this.report.counts[w] ??= emptyCounts());
  }

  /** A source address as the suite knows it: the mapped account, else as it was. */
  mapEmail(addr: string): string {
    const a = addr.trim().toLowerCase();
    return this.mapping.get(a) ?? a;
  }

  async copied(w: Workload, kind: "copied" | "updated" | "deleted" = "copied"): Promise<void> {
    this.counts(w)[kind]++;
    const done = (this.job.progress.done ??= {});
    done[w] = (done[w] ?? 0) + 1;
    this.written++;
    // Saved with every item, so the report stays right when the process dies mid-job.
    await this.checkpoint(true);
    await this.hooks.afterItem?.(w, this.written);
  }

  async skipped(w: Workload, item: string, reason: string): Promise<void> {
    this.counts(w).skipped++;
    if (this.report.skipped.length < MAX_LISTED) this.report.skipped.push({ workload: w, item: item.slice(0, 200), reason });
    await this.checkpoint(true);
  }

  async failed(w: Workload, item: string, err: unknown): Promise<void> {
    this.counts(w).failed++;
    const msg = err instanceof Error ? err.message : String(err);
    if (this.report.errors.length < MAX_LISTED) this.report.errors.push({ workload: w, item: item.slice(0, 200), error: msg.slice(0, 300) });
    await this.checkpoint(true);
  }

  /** A retried item that now went through is no longer an error. */
  recovered(w: Workload): void {
    const c = this.counts(w);
    if (c.failed > 0) c.failed--;
  }

  step(w: Workload, step: string): Promise<void> {
    this.job.progress.workload = w;
    this.job.progress.step = step.slice(0, 200);
    return this.checkpoint(true);
  }

  /** Saves progress (at most every second unless forced) and stops if the job was cancelled. */
  async checkpoint(force = false): Promise<void> {
    if (!force && Date.now() - this.lastSave < 1000) return;
    this.lastSave = Date.now();
    if (this.graph) this.report.throttled = this.baseThrottled + this.graph.throttled;
    const [r] = await q<{ status: string }>(
      `UPDATE migration_jobs SET progress = $2, report = $3, heartbeat_at = now() WHERE id = $1 RETURNING status`,
      [this.job.id, JSON.stringify(this.job.progress), JSON.stringify(this.report)],
    );
    if (!r || r.status !== "running") throw new Stopped();
  }

}

/**
 * Errors that stop the whole run (and leave it to be retried) instead of being one item's
 * failure: a crash or cancel, Microsoft refusing the app's credentials, or a suite app that is
 * down or refuses the gateway secret.
 */
export function isFatal(e: unknown): boolean {
  if (e instanceof Crash || e instanceof Stopped) return true;
  if (e instanceof GraphError) return e.status === 401 || e.status === 429 || e.status === 503;
  if (e instanceof SuiteError) return [0, 401, 403, 502, 503].includes(e.status);
  return false;
}
