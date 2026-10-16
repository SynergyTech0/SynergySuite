import { createDb } from "@synergy/db";

/**
 * A project belongs to its team: the people in `members`. Managers run the project (plan, team,
 * rates, approvals, billing); everyone on the team sees the plan and logs time and expenses on it.
 *
 * Time is kept one row per timesheet cell: a person, a project, a task (or none) and a day. The
 * week grid edits those rows directly and the timer adds to today's. Money is whole cents.
 */
const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS project_code_seq;
CREATE TABLE IF NOT EXISTS projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  client_name      TEXT NOT NULL DEFAULT '',
  client_email     TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'on_hold', 'done', 'cancelled')),
  billing          TEXT NOT NULL DEFAULT 'time' CHECK (billing IN ('time', 'fixed', 'none')),
  currency         TEXT NOT NULL DEFAULT 'USD',
  start_day        DATE,
  finish_day       DATE,
  budget_minutes   INTEGER,
  budget_cents     BIGINT,
  fixed_fee_cents  BIGINT,
  default_rate_cents BIGINT,
  planner_board_id TEXT,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_code_uniq ON projects (code);

CREATE TABLE IF NOT EXISTS members (
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
  bill_rate_cents BIGINT,
  cost_rate_cents BIGINT,
  weekly_minutes  INTEGER NOT NULL DEFAULT 2400,
  added_by        TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, email)
);
CREATE INDEX IF NOT EXISTS members_email_idx ON members (email);

CREATE TABLE IF NOT EXISTS tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id        UUID REFERENCES tasks(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  start_day        DATE,
  finish_day       DATE,
  estimate_minutes INTEGER,
  percent_done     INTEGER NOT NULL DEFAULT 0 CHECK (percent_done BETWEEN 0 AND 100),
  assigned_to      TEXT,
  milestone        BOOLEAN NOT NULL DEFAULT false,
  billable         BOOLEAN NOT NULL DEFAULT true,
  depends_on       UUID[] NOT NULL DEFAULT '{}',
  position         INTEGER NOT NULL DEFAULT 0,
  planner_card_id  TEXT,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_planner_uniq ON tasks (project_id, planner_card_id) WHERE planner_card_id IS NOT NULL;

-- A billing run: what went to Books (or was recorded without it) for one project.
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'recorded')),
  books_id        TEXT,
  books_number    TEXT,
  through_day     DATE NOT NULL,
  total_cents     BIGINT NOT NULL,
  currency        TEXT NOT NULL,
  lines           JSONB NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_project_idx ON invoices (project_id, created_at);

CREATE TABLE IF NOT EXISTS time_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
  person          TEXT NOT NULL,
  day             DATE NOT NULL,
  minutes         INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  notes           TEXT NOT NULL DEFAULT '',
  billable        BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  rate_cents      BIGINT,
  cost_cents      BIGINT,
  submitted_at    TIMESTAMPTZ,
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  reject_reason   TEXT,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
-- One row per timesheet cell.
CREATE UNIQUE INDEX IF NOT EXISTS time_cell_uniq ON time_entries (person, project_id, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid), day)
  WHERE held_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS time_person_idx ON time_entries (person, day);
CREATE INDEX IF NOT EXISTS time_project_idx ON time_entries (project_id, status);

-- A running timer, one per person.
CREATE TABLE IF NOT EXISTS timers (
  person     TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id    UUID REFERENCES tasks(id) ON DELETE SET NULL,
  notes      TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person          TEXT NOT NULL,
  day             DATE NOT NULL,
  category        TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  billable        BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at    TIMESTAMPTZ,
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  reject_reason   TEXT,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  receipt_name    TEXT,
  receipt_type    TEXT,
  receipt         BYTEA,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS expenses_person_idx ON expenses (person, day);
CREATE INDEX IF NOT EXISTS expenses_project_idx ON expenses (project_id, status);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __projectsDb?: Db; __projectsReady?: Promise<void> };

export function db(): Db {
  if (!g.__projectsDb) g.__projectsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/projects", max: 10 });
  return g.__projectsDb;
}

export function ready(): Promise<void> {
  if (!g.__projectsReady) {
    g.__projectsReady = db().migrate(SCHEMA, "projects").catch((e) => {
      g.__projectsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__projectsReady;
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
