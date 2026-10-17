import { createDb } from "@synergy/db";

/**
 * Field Service keeps customers and the equipment installed at their sites, work orders for jobs
 * done there, and bookings that put a technician on a work order for a stretch of time. Only the
 * people in `staff` use the app: dispatchers run everything, technicians see the jobs booked to
 * them. Money is whole cents; part quantities can be fractional (metres of cable).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  email           TEXT PRIMARY KEY,
  name            TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL CHECK (role IN ('dispatcher', 'technician')),
  skills          TEXT[] NOT NULL DEFAULT '{}',
  phone           TEXT NOT NULL DEFAULT '',
  home_base       TEXT NOT NULL DEFAULT '',
  bill_rate_cents BIGINT,
  active          BOOLEAN NOT NULL DEFAULT true,
  added_by        TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (lower(email)) WHERE email <> '';

-- Equipment at a customer's site. ops_tag links it to an asset in Synergy Ops.
CREATE TABLE IF NOT EXISTS assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  make            TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  serial          TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  installed_on    DATE,
  warranty_until  DATE,
  ops_tag         TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assets_customer_idx ON assets (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS assets_ops_uniq ON assets (customer_id, ops_tag) WHERE ops_tag IS NOT NULL AND held_deleted_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS work_order_seq;
CREATE TABLE IF NOT EXISTS work_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number            TEXT NOT NULL UNIQUE,
  customer_id       UUID NOT NULL REFERENCES customers(id),
  asset_id          UUID REFERENCES assets(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  kind              TEXT NOT NULL DEFAULT 'repair' CHECK (kind IN ('repair', 'install', 'maintenance', 'inspection')),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  skill             TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  contact_name      TEXT NOT NULL DEFAULT '',
  contact_phone     TEXT NOT NULL DEFAULT '',
  due_day           DATE,
  estimate_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (estimate_minutes > 0 AND estimate_minutes <= 14400),
  billable          BOOLEAN NOT NULL DEFAULT true,
  desk_ticket       TEXT,
  resolution        TEXT NOT NULL DEFAULT '',
  signed_by         TEXT NOT NULL DEFAULT '',
  signature         TEXT,
  completed_at      TIMESTAMPTZ,
  completed_by      TEXT,
  invoice_status    TEXT NOT NULL DEFAULT 'none' CHECK (invoice_status IN ('none', 'sent', 'recorded')),
  books_id          TEXT,
  books_number      TEXT,
  invoice_total_cents BIGINT,
  invoice_lines     JSONB,
  invoiced_at       TIMESTAMPTZ,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders (status, priority, due_day);
CREATE INDEX IF NOT EXISTS work_orders_customer_idx ON work_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_asset_idx ON work_orders (asset_id) WHERE asset_id IS NOT NULL;

-- A technician on a work order for a stretch of time; a job can take several visits.
CREATE TABLE IF NOT EXISTS bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  technician    TEXT NOT NULL,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'traveling', 'on_site', 'done', 'cancelled')),
  travel_at     TIMESTAMPTZ,
  arrived_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  booked_by     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_tech_idx ON bookings (technician, starts_at);
CREATE INDEX IF NOT EXISTS bookings_wo_idx ON bookings (work_order_id, starts_at);

CREATE TABLE IF NOT EXISTS checklist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  done_by       TEXT,
  done_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS checklist_wo_idx ON checklist (work_order_id, position);

-- Time on site. Finishing a visit records it; dispatchers can correct it before billing.
CREATE TABLE IF NOT EXISTS labor (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  technician    TEXT NOT NULL,
  day           DATE NOT NULL,
  minutes       INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  rate_cents    BIGINT NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labor_wo_idx ON labor (work_order_id);

-- Parts used on a job. With Commerce linked each one is sent there (sync_status) so the stock
-- comes off the shelf and Books hears about it once.
CREATE TABLE IF NOT EXISTS parts (
  id               BIGSERIAL PRIMARY KEY,
  work_order_id    UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT 'each',
  qty              NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  unit_cost        NUMERIC(14,4),
  sync_status      TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'pending', 'synced', 'failed')),
  sync_error       TEXT NOT NULL DEFAULT '',
  added_by         TEXT NOT NULL,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_wo_idx ON parts (work_order_id);
CREATE INDEX IF NOT EXISTS parts_sync_idx ON parts (id) WHERE sync_status IN ('pending', 'failed');

-- The job's timeline: notes people write and what happened to it.
CREATE TABLE IF NOT EXISTS notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  author          TEXT NOT NULL,
  body            TEXT NOT NULL,
  event           BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notes_wo_idx ON notes (work_order_id, created_at);

-- Photos and documents from the job.
CREATE TABLE IF NOT EXISTS files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  data            BYTEA NOT NULL,
  added_by        TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS files_wo_idx ON files (work_order_id);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __fieldDb?: Db; __fieldReady?: Promise<void> };

export function db(): Db {
  if (!g.__fieldDb) g.__fieldDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/field", max: 10 });
  return g.__fieldDb;
}

export function ready(): Promise<void> {
  if (!g.__fieldReady) {
    g.__fieldReady = db().migrate(SCHEMA, "field").catch((e) => {
      g.__fieldReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__fieldReady;
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
