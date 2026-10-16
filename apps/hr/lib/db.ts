import { createDb } from "@synergy/db";

/**
 * HR keeps the People add-on's database and tables (employees, pto_requests) and adds to them, so
 * an existing install upgrades in place on first start. Pay data sits in tables of its own that
 * only payroll admins can read. Money is in whole cents.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  manager_email TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  start_date    DATE,
  pto_days_per_year NUMERIC(5,1) NOT NULL DEFAULT 15,
  emergency_contact TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'full_time';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sick_days_per_year NUMERIC(5,1) NOT NULL DEFAULT 5;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_address TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pronouns TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees (manager_email);

CREATE TABLE IF NOT EXISTS pto_requests (
  id          BIGSERIAL PRIMARY KEY,
  employee_email TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'vacation' CHECK (kind IN ('vacation','sick','personal','other')),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  days        NUMERIC(5,1) NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  decided_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS pto_emp_idx ON pto_requests (employee_email, start_date DESC);
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS decision_note TEXT NOT NULL DEFAULT '';
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS pto_status_idx ON pto_requests (status, start_date);

CREATE TABLE IF NOT EXISTS holidays (
  day  DATE PRIMARY KEY,
  name TEXT NOT NULL
);

-- Onboarding and offboarding: a checklist per person, made from a template.
CREATE TABLE IF NOT EXISTS checklist_templates (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind  TEXT NOT NULL CHECK (kind IN ('onboarding','offboarding')),
  name  TEXT NOT NULL,
  tasks JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS checklists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('onboarding','offboarding')),
  title       TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checklists_employee_idx ON checklists (employee_id);
CREATE TABLE IF NOT EXISTS checklist_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  owner        TEXT NOT NULL CHECK (owner IN ('employee','manager','hr')),
  assignee     TEXT NOT NULL DEFAULT '',
  due          DATE,
  position     INTEGER NOT NULL DEFAULT 0,
  done_at      TIMESTAMPTZ,
  done_by      TEXT
);
CREATE INDEX IF NOT EXISTS checklist_tasks_assignee_idx ON checklist_tasks (assignee) WHERE done_at IS NULL;

-- Payroll. One row of company settings.
CREATE TABLE IF NOT EXISTS pay_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name        TEXT NOT NULL DEFAULT '',
  frequency           TEXT NOT NULL DEFAULT 'biweekly' CHECK (frequency IN ('weekly','biweekly','semimonthly','monthly')),
  overtime_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.5,
  suta_rate           NUMERIC(6,3) NOT NULL DEFAULT 0,
  suta_wage_base_cents BIGINT NOT NULL DEFAULT 0,
  accounts            JSONB NOT NULL DEFAULT '{}',
  books_org           TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          TEXT NOT NULL DEFAULT ''
);
INSERT INTO pay_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pay_profiles (
  employee_id        BIGINT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  in_payroll         BOOLEAN NOT NULL DEFAULT true,
  pay_type           TEXT NOT NULL DEFAULT 'salary' CHECK (pay_type IN ('salary','hourly')),
  annual_salary_cents BIGINT NOT NULL DEFAULT 0 CHECK (annual_salary_cents >= 0),
  hourly_rate_cents  BIGINT NOT NULL DEFAULT 0 CHECK (hourly_rate_cents >= 0),
  filing_status      TEXT NOT NULL DEFAULT 'single' CHECK (filing_status IN ('single','married','head')),
  multiple_jobs      BOOLEAN NOT NULL DEFAULT false,
  dependents_cents   BIGINT NOT NULL DEFAULT 0,
  other_income_cents BIGINT NOT NULL DEFAULT 0,
  deductions_cents   BIGINT NOT NULL DEFAULT 0,
  extra_withholding_cents BIGINT NOT NULL DEFAULT 0,
  w4_exempt          BOOLEAN NOT NULL DEFAULT false,
  work_state         TEXT NOT NULL DEFAULT '',
  state_rate         NUMERIC(6,3) NOT NULL DEFAULT 0,
  payment_method     TEXT NOT NULL DEFAULT 'direct_deposit' CHECK (payment_method IN ('direct_deposit','check')),
  account_last4      TEXT NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pay_deductions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('pretax_retirement','pretax_benefit','roth_retirement','posttax')),
  amount_cents  BIGINT CHECK (amount_cents >= 0),
  percent       NUMERIC(6,3) CHECK (percent >= 0 AND percent <= 100),
  match_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  match_cap_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  annual_limit_cents BIGINT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((amount_cents IS NULL) <> (percent IS NULL))
);
CREATE INDEX IF NOT EXISTS pay_deductions_employee_idx ON pay_deductions (employee_id);

CREATE TABLE IF NOT EXISTS pay_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       BIGSERIAL UNIQUE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  pay_date     DATE NOT NULL,
  frequency    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','void')),
  totals       JSONB NOT NULL DEFAULT '{}',
  note         TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  paid_by      TEXT,
  paid_at      TIMESTAMPTZ,
  books_status TEXT NOT NULL DEFAULT 'none' CHECK (books_status IN ('none','posted','failed','off')),
  books_journal TEXT,
  books_error  TEXT,
  CHECK (period_start <= period_end)
);
CREATE INDEX IF NOT EXISTS pay_runs_date_idx ON pay_runs (pay_date DESC);

CREATE TABLE IF NOT EXISTS paychecks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  employee_id    BIGINT NOT NULL REFERENCES employees(id),
  employee_email TEXT NOT NULL,
  employee_name  TEXT NOT NULL,
  hours          JSONB NOT NULL,
  profile        JSONB NOT NULL,
  result         JSONB NOT NULL,
  gross_cents    BIGINT NOT NULL,
  net_cents      BIGINT NOT NULL,
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS paychecks_employee_idx ON paychecks (employee_id);

-- Who changed what: pay setup, pay runs, employee records.
CREATE TABLE IF NOT EXISTS audit (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  detail  JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC);

-- State withholding certificates. Profiles saved before state tables existed keep their flat rate.
ALTER TABLE pay_profiles ADD COLUMN IF NOT EXISTS state_method TEXT CHECK (state_method IN ('table','flat'));
UPDATE pay_profiles SET state_method = CASE WHEN state_rate > 0 THEN 'flat' ELSE 'table' END WHERE state_method IS NULL;
ALTER TABLE pay_profiles ALTER COLUMN state_method SET DEFAULT 'table';
ALTER TABLE pay_profiles ALTER COLUMN state_method SET NOT NULL;
ALTER TABLE pay_profiles ADD COLUMN IF NOT EXISTS state_filing_status TEXT NOT NULL DEFAULT '' CHECK (state_filing_status IN ('','single','married','head'));
ALTER TABLE pay_profiles ADD COLUMN IF NOT EXISTS state_allowances INT NOT NULL DEFAULT 0 CHECK (state_allowances BETWEEN 0 AND 99);
ALTER TABLE pay_profiles ADD COLUMN IF NOT EXISTS state_extra_withholding_cents BIGINT NOT NULL DEFAULT 0 CHECK (state_extra_withholding_cents >= 0);
ALTER TABLE pay_profiles ADD COLUMN IF NOT EXISTS state_exempt BOOLEAN NOT NULL DEFAULT false;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __hrDb?: Db; __hrReady?: Promise<void> };

export function db(): Db {
  if (!g.__hrDb) g.__hrDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5475/people", max: 10 });
  return g.__hrDb;
}

export function ready(): Promise<void> {
  if (!g.__hrReady) {
    // Same lock name as the People add-on used, so an old and a new replica never migrate at once.
    g.__hrReady = db().migrate(SCHEMA, "people").catch((e) => {
      g.__hrReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__hrReady;
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

export async function audit(actor: string, action: string, subject: string, detail: Record<string, unknown> = {}, tq?: Tq): Promise<void> {
  const run = tq ?? q;
  await run("INSERT INTO audit (actor, action, subject, detail) VALUES ($1, $2, $3, $4)", [actor, action, subject, JSON.stringify(detail)]);
}
