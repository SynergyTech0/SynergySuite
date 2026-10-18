import { createDb } from "@synergy/db";

/**
 * Schedules are built a week at a time (Monday to Sunday). A shift is a calendar day with a start
 * and end in minutes after midnight; one with no employee is an open shift anyone on the roster
 * can claim. Drafts are seen only by schedulers until the week is published. Employees are this
 * app's own roster; one is matched to a suite account by email.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS positions (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#4f46e5',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS positions_name_uniq ON positions (lower(name));

CREATE TABLE IF NOT EXISTS employees (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_uniq ON employees (lower(email)) WHERE email <> '';

CREATE TABLE IF NOT EXISTS shifts (
  id          BIGSERIAL PRIMARY KEY,
  employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
  position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL,
  location    TEXT NOT NULL DEFAULT '',
  shift_date  DATE NOT NULL,
  start_min   INTEGER NOT NULL CHECK (start_min >= 0),
  end_min     INTEGER NOT NULL CHECK (end_min <= 1440),
  notes       TEXT NOT NULL DEFAULT '',
  published   BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_min < end_min)
);
CREATE INDEX IF NOT EXISTS shifts_date_idx ON shifts (shift_date);
CREATE INDEX IF NOT EXISTS shifts_employee_idx ON shifts (employee_id, shift_date);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __shiftsDb?: Db; __shiftsReady?: Promise<void> };

export function db(): Db {
  if (!g.__shiftsDb) g.__shiftsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/shifts", max: 10 });
  return g.__shiftsDb;
}

export function ready(): Promise<void> {
  if (!g.__shiftsReady) {
    g.__shiftsReady = db().migrate(SCHEMA, "shifts").catch((e) => {
      g.__shiftsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__shiftsReady;
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
