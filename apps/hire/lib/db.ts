import { createDb } from "@synergy/db";

/**
 * Recruiters (HIRE_ADMIN_EMAILS, default ADMIN_EMAILS) see every job and candidate. A job's
 * hiring manager sees that job and its candidates. Open jobs are listed on the public careers
 * page, where anyone can apply without signing in.
 *
 * A candidate is one application to one job and moves through the stages in order; every stage
 * change and note is kept on the candidate's timeline.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  department      TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'full_time'
                    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'temporary', 'internship')),
  remote          BOOLEAN NOT NULL DEFAULT false,
  salary          TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  hiring_manager  TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at       TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_slug_uniq ON jobs (slug);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_manager_idx ON jobs (hiring_manager);

CREATE TABLE IF NOT EXISTS candidates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT NOT NULL DEFAULT '',
  profile_url      TEXT NOT NULL DEFAULT '',
  resume_url       TEXT NOT NULL DEFAULT '',
  cover_note       TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'careers', 'referral')),
  stage            TEXT NOT NULL DEFAULT 'applied'
                     CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
  rating           INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hr_person_id     TEXT,
  hr_added_at      TIMESTAMPTZ,
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS candidates_job_email_uniq ON candidates (job_id, email);
CREATE INDEX IF NOT EXISTS candidates_stage_idx ON candidates (job_id, stage);

CREATE TABLE IF NOT EXISTS candidate_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'stage', 'system')),
  body         TEXT NOT NULL,
  author       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_events_idx ON candidate_events (candidate_id, created_at);

-- What the careers page says about the organization. One row.
CREATE TABLE IF NOT EXISTS careers_settings (
  id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  company     TEXT NOT NULL DEFAULT '',
  intro       TEXT NOT NULL DEFAULT '',
  contact     TEXT NOT NULL DEFAULT '',
  modified_by TEXT NOT NULL DEFAULT '',
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __hireDb?: Db; __hireReady?: Promise<void> };

export function db(): Db {
  if (!g.__hireDb) g.__hireDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/hire", max: 10 });
  return g.__hireDb;
}

export function ready(): Promise<void> {
  if (!g.__hireReady) {
    g.__hireReady = db().migrate(SCHEMA, "hire").catch((e) => {
      g.__hireReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__hireReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

export type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: Tq) => Promise<T>): Promise<T> {
  await ready();
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => (await client.query(text, params as unknown[])).rows);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
