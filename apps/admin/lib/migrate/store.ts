import { q } from "../db";
import type { Counts, JobStatus, JobSummary, Report, SourceKind, Workload } from "./types";

/** The migration tables (see lib/db.ts), row by row. */

export type SourceRow = {
  id: string; kind: SourceKind; name: string; config: Record<string, string | number | boolean>; secret: string;
  created_by: string; created_at: Date; discovered_at: Date | null; discovery_error: string | null; notes: string[];
};

export type UserRow = {
  source_id: string; ext_id: string; email: string; name: string; enabled: boolean;
  mail_bytes: string | null; mail_items: number | null; drive_bytes: string | null;
  has_mailbox: boolean | null; has_drive: boolean | null; target: string | null; secret: string; seen_at: Date;
};

export type SiteRow = {
  source_id: string; site_id: string; name: string; url: string; drive_bytes: string | null; libraries: number | null;
  members: { email: string; role: "owner" | "member" }[]; include: boolean; library: string; seen_at: Date;
};

export type JobRow = {
  id: string; source_id: string; subject_kind: "user" | "site"; subject_id: string; label: string; target: string;
  workloads: Workload[]; status: JobStatus; attempts: number; progress: JobSummary["progress"]; report: Report;
  error: string | null; created_by: string; created_at: Date; started_at: Date | null; finished_at: Date | null;
  heartbeat_at: Date | null; not_before: Date | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function emptyCounts(): Counts {
  return { copied: 0, updated: 0, deleted: 0, skipped: 0, failed: 0 };
}

export function emptyReport(): Report {
  return { counts: {}, skipped: [], errors: [], notMigrated: [], throttled: 0, runs: 0 };
}

export function toJob(r: JobRow): JobSummary {
  return {
    id: r.id, sourceId: r.source_id, subjectKind: r.subject_kind, subjectId: r.subject_id, label: r.label, target: r.target,
    workloads: r.workloads, status: r.status, attempts: r.attempts, error: r.error, createdBy: r.created_by,
    createdAt: r.created_at.toISOString(), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
    progress: r.progress ?? {}, report: { ...emptyReport(), ...(r.report ?? {}) },
  };
}

export async function source(id: string): Promise<SourceRow | null> {
  const [r] = await q<SourceRow>(`SELECT * FROM migration_sources WHERE id = $1`, [id]);
  return r ?? null;
}

export async function user(sourceId: string, extId: string): Promise<UserRow | null> {
  const [r] = await q<UserRow>(`SELECT * FROM migration_users WHERE source_id = $1 AND ext_id = $2`, [sourceId, extId]);
  return r ?? null;
}

export async function users(sourceId: string): Promise<UserRow[]> {
  return q<UserRow>(`SELECT * FROM migration_users WHERE source_id = $1 ORDER BY lower(name), email`, [sourceId]);
}

export async function site(sourceId: string, siteId: string): Promise<SiteRow | null> {
  const [r] = await q<SiteRow>(`SELECT * FROM migration_sites WHERE source_id = $1 AND site_id = $2`, [sourceId, siteId]);
  return r ?? null;
}

export async function sites(sourceId: string): Promise<SiteRow[]> {
  return q<SiteRow>(`SELECT * FROM migration_sites WHERE source_id = $1 ORDER BY lower(name)`, [sourceId]);
}

export async function job(id: string): Promise<JobRow | null> {
  const [r] = await q<JobRow>(`SELECT * FROM migration_jobs WHERE id = $1`, [id]);
  return r ?? null;
}

/** Each subject's newest job. */
export async function latestJobs(sourceId: string): Promise<Map<string, JobRow>> {
  const rows = await q<JobRow>(
    `SELECT DISTINCT ON (subject_kind, subject_id) * FROM migration_jobs WHERE source_id = $1 ORDER BY subject_kind, subject_id, created_at DESC`,
    [sourceId],
  );
  return new Map(rows.map((r) => [`${r.subject_kind}:${r.subject_id}`, r]));
}

/** Where a copy of each source item went, per subject and workload. */
export type ItemRow = { item_id: string; target_id: string; version: string; info: Record<string, unknown> };

export class Items {
  constructor(private sourceId: string, private subjectId: string) {}

  async get(workload: string, itemId: string): Promise<ItemRow | null> {
    const [r] = await q<ItemRow>(
      `SELECT item_id, target_id, version, info FROM migration_items WHERE source_id = $1 AND subject_id = $2 AND workload = $3 AND item_id = $4`,
      [this.sourceId, this.subjectId, workload, itemId],
    );
    return r ?? null;
  }

  async put(workload: string, itemId: string, targetId: string, version: string, info: Record<string, unknown> = {}): Promise<void> {
    await q(
      `INSERT INTO migration_items (source_id, subject_id, workload, item_id, target_id, version, info) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source_id, subject_id, workload, item_id) DO UPDATE SET target_id = $5, version = $6, info = $7, updated_at = now()`,
      [this.sourceId, this.subjectId, workload, itemId, targetId, version, JSON.stringify(info)],
    );
  }

  async del(workload: string, itemId: string): Promise<void> {
    await q(`DELETE FROM migration_items WHERE source_id = $1 AND subject_id = $2 AND workload = $3 AND item_id = $4`, [
      this.sourceId, this.subjectId, workload, itemId,
    ]);
  }

  /** Items whose copy failed last time, to try again. */
  async failed(workload: string, limit = 500): Promise<ItemRow[]> {
    return q<ItemRow>(
      `SELECT item_id, target_id, version, info FROM migration_items
       WHERE source_id = $1 AND subject_id = $2 AND workload = $3 AND target_id = '' AND (info->>'failed') = 'true' LIMIT ${limit}`,
      [this.sourceId, this.subjectId, workload],
    );
  }

  async count(workload: string): Promise<number> {
    const [r] = await q<{ n: string }>(
      `SELECT COUNT(*) AS n FROM migration_items WHERE source_id = $1 AND subject_id = $2 AND workload = $3 AND target_id <> ''`,
      [this.sourceId, this.subjectId, workload],
    );
    return Number(r?.n ?? 0);
  }
}

/** Delta links and other resume points, per subject, workload and scope (a folder, a drive). */
export class Cursors {
  constructor(private sourceId: string, private subjectId: string) {}

  async get<T extends Record<string, unknown>>(workload: string, scope: string): Promise<Partial<T>> {
    const [r] = await q<{ state: T }>(
      `SELECT state FROM migration_cursors WHERE source_id = $1 AND subject_id = $2 AND workload = $3 AND scope = $4`,
      [this.sourceId, this.subjectId, workload, scope],
    );
    return r?.state ?? {};
  }

  async put(workload: string, scope: string, state: Record<string, unknown>): Promise<void> {
    await q(
      `INSERT INTO migration_cursors (source_id, subject_id, workload, scope, state) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, subject_id, workload, scope) DO UPDATE SET state = $5, updated_at = now()`,
      [this.sourceId, this.subjectId, workload, scope, JSON.stringify(state)],
    );
  }
}
