import { createDb } from "@synergy/db";

/**
 * A list belongs to its owner and the people it is shared with; everyone on a list can change its
 * tasks. My Day is personal, so a task is in someone's day through `my_day`, not on the task.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'blue',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lists_owner_idx ON lists (owner);
-- One default "Tasks" list each.
CREATE UNIQUE INDEX IF NOT EXISTS lists_default_uniq ON lists (owner) WHERE is_default;

CREATE TABLE IF NOT EXISTS list_members (
  list_id  UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email    TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, email)
);
CREATE INDEX IF NOT EXISTS list_members_email_idx ON list_members (email);

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  important    BOOLEAN NOT NULL DEFAULT false,
  due          DATE,
  reminder_at  TIMESTAMPTZ,
  reminder_by  TEXT,
  reminded_at  TIMESTAMPTZ,
  repeat       TEXT CHECK (repeat IN ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  assigned_to  TEXT,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_list_idx ON tasks (list_id, completed_at);
CREATE INDEX IF NOT EXISTS tasks_reminder_idx ON tasks (reminder_by, reminder_at) WHERE reminded_at IS NULL AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks (assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS steps (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  done     BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS steps_task_idx ON steps (task_id, position);

CREATE TABLE IF NOT EXISTS my_day (
  email   TEXT NOT NULL,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  PRIMARY KEY (email, task_id)
);

-- Deleted while the owner was on legal hold: kept, hidden, still found by eDiscovery.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __todoDb?: Db; __todoReady?: Promise<void> };

export function db(): Db {
  if (!g.__todoDb) g.__todoDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/todo", max: 10 });
  return g.__todoDb;
}

export function ready(): Promise<void> {
  if (!g.__todoReady) {
    g.__todoReady = db().migrate(SCHEMA, "todo").catch((e) => {
      g.__todoReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__todoReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
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
