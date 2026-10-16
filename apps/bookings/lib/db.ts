import { createDb } from "@synergy/db";

/**
 * A booking page belongs to its staff: admins change it, everyone on it sees and handles its
 * appointments. Customers never sign in; each appointment carries a secret token for its own
 * manage page. Times are UTC; a page's hours are minutes from midnight in its own time zone.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  time_zone       TEXT NOT NULL DEFAULT 'UTC',
  hours           JSONB NOT NULL,
  min_notice_min  INTEGER NOT NULL DEFAULT 120,
  max_days_ahead  INTEGER NOT NULL DEFAULT 60,
  step_min        INTEGER NOT NULL DEFAULT 30,
  published       BOOLEAN NOT NULL DEFAULT false,
  choose_staff    BOOLEAN NOT NULL DEFAULT true,
  sender_email    TEXT,
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT 'blue',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS staff (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id  UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  email    TEXT NOT NULL,
  name     TEXT NOT NULL DEFAULT '',
  role     TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  -- Their own hours; NULL keeps the page's.
  hours    JSONB,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, email)
);
CREATE INDEX IF NOT EXISTS staff_email_idx ON staff (email);

CREATE TABLE IF NOT EXISTS services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  duration_min      INTEGER NOT NULL DEFAULT 30,
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min  INTEGER NOT NULL DEFAULT 0,
  location_kind     TEXT NOT NULL DEFAULT 'meet' CHECK (location_kind IN ('meet', 'in_person', 'phone', 'custom')),
  location          TEXT NOT NULL DEFAULT '',
  price             TEXT NOT NULL DEFAULT '',
  -- Staff ids who offer it; empty = everyone on the page.
  staff_ids         UUID[] NOT NULL DEFAULT '{}',
  questions         JSONB NOT NULL DEFAULT '[]',
  reminder_hours    INTEGER[] NOT NULL DEFAULT '{24}',
  active            BOOLEAN NOT NULL DEFAULT true,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, slug)
);

CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name      TEXT NOT NULL,
  staff_email       TEXT NOT NULL,
  staff_name        TEXT NOT NULL DEFAULT '',
  customer_name     TEXT NOT NULL,
  customer_email    TEXT NOT NULL,
  customer_phone    TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  answers           JSONB NOT NULL DEFAULT '[]',
  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,
  -- The time it holds on the staff member's day, buffers included.
  block_start       TIMESTAMPTZ NOT NULL,
  block_end         TIMESTAMPTZ NOT NULL,
  location          TEXT NOT NULL DEFAULT '',
  meet_room         TEXT,
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  token             TEXT NOT NULL UNIQUE,
  sequence          INTEGER NOT NULL DEFAULT 0,
  calendar_event_id TEXT,
  reminders_sent    INTEGER[] NOT NULL DEFAULT '{}',
  booked_by         TEXT,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      TEXT,
  cancel_reason     TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_at < end_at)
);
CREATE INDEX IF NOT EXISTS appointments_staff_idx ON appointments (staff_email, block_start) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS appointments_page_idx ON appointments (page_id, start_at);
CREATE INDEX IF NOT EXISTS appointments_customer_idx ON appointments (customer_email);
CREATE INDEX IF NOT EXISTS appointments_upcoming_idx ON appointments (start_at) WHERE status = 'confirmed';
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __bookingsDb?: Db; __bookingsReady?: Promise<void> };

export function db(): Db {
  if (!g.__bookingsDb) g.__bookingsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/bookings", max: 10 });
  return g.__bookingsDb;
}

export function ready(): Promise<void> {
  if (!g.__bookingsReady) {
    g.__bookingsReady = db().migrate(SCHEMA, "bookings").catch((e) => {
      g.__bookingsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__bookingsReady;
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
