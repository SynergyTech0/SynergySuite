import { createDb } from "@synergy/db";
import pg from "pg";

// DATE columns come back as yyyy-mm-dd text rather than a Date at local midnight.
pg.types.setTypeParser(1082, (v: string) => v);

/**
 * Manufacturing: items and their stock ledger, work centers, versioned bills of materials with
 * routings, work orders (materials and operations copied from the bill when released), outside
 * demand, MRP planned orders and purchase requests.
 * Assets: the register, meter readings, preventive maintenance plans and maintenance orders.
 * Work orders and maintenance orders are never deleted, only cancelled, so legal holds need no
 * extra care here.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS counters (
  kind TEXT NOT NULL,
  year INT NOT NULL,
  last INT NOT NULL,
  PRIMARY KEY (kind, year)
);

CREATE TABLE IF NOT EXISTS items (
  id            BIGSERIAL PRIMARY KEY,
  sku           TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  uom           TEXT NOT NULL DEFAULT 'ea',
  source        TEXT NOT NULL DEFAULT 'buy' CHECK (source IN ('make','buy')),
  unit_cost     NUMERIC(19,4) NOT NULL DEFAULT 0,
  on_hand       NUMERIC(16,4) NOT NULL DEFAULT 0,
  safety_stock  NUMERIC(16,4) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(16,4) NOT NULL DEFAULT 0,
  lot_size      NUMERIC(16,4) NOT NULL DEFAULT 0,
  lead_days     INT NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  active        BOOLEAN NOT NULL DEFAULT true,
  books_item_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS items_sku_idx ON items (lower(sku));

-- Every change to on_hand, signed. Books gets each one when it is linked (books_status).
CREATE TABLE IF NOT EXISTS stock_moves (
  id           BIGSERIAL PRIMARY KEY,
  item_id      BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty          NUMERIC(16,4) NOT NULL,
  unit_cost    NUMERIC(19,4) NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL CHECK (kind IN ('receipt','adjust','issue','produce','maintenance')),
  ref          TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  by_email     TEXT NOT NULL DEFAULT '',
  books_status TEXT NOT NULL DEFAULT 'off' CHECK (books_status IN ('off','pending','synced','failed')),
  books_error  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_moves_item_idx ON stock_moves (item_id, id DESC);
CREATE INDEX IF NOT EXISTS stock_moves_books_idx ON stock_moves (id) WHERE books_status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS work_centers (
  id             BIGSERIAL PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  rate_per_hour  NUMERIC(19,4) NOT NULL DEFAULT 0,
  hours_per_day  NUMERIC(6,2) NOT NULL DEFAULT 8,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_centers_code_idx ON work_centers (lower(code));

CREATE TABLE IF NOT EXISTS boms (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  output_qty  NUMERIC(16,4) NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','obsolete')),
  notes       TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, version)
);
-- One active bill per item: activating a version retires the one before it.
CREATE UNIQUE INDEX IF NOT EXISTS boms_active_idx ON boms (item_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bom_lines (
  id           BIGSERIAL PRIMARY KEY,
  bom_id       BIGINT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES items(id),
  qty          NUMERIC(16,4) NOT NULL CHECK (qty > 0),
  scrap_pct    NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (scrap_pct >= 0 AND scrap_pct < 100),
  position     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bom_lines_bom_idx ON bom_lines (bom_id, position);
CREATE INDEX IF NOT EXISTS bom_lines_component_idx ON bom_lines (component_id);

CREATE TABLE IF NOT EXISTS bom_operations (
  id             BIGSERIAL PRIMARY KEY,
  bom_id         BIGINT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  seq            INT NOT NULL,
  name           TEXT NOT NULL,
  work_center_id BIGINT NOT NULL REFERENCES work_centers(id),
  setup_minutes  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
  run_minutes    NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (run_minutes >= 0)
);
CREATE INDEX IF NOT EXISTS bom_operations_bom_idx ON bom_operations (bom_id, seq);

CREATE TABLE IF NOT EXISTS work_orders (
  id            BIGSERIAL PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  item_id       BIGINT NOT NULL REFERENCES items(id),
  bom_id        BIGINT REFERENCES boms(id),
  qty           NUMERIC(16,4) NOT NULL CHECK (qty > 0),
  qty_done      NUMERIC(16,4) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','released','in_progress','done','cancelled')),
  start_date    DATE,
  due_date      DATE,
  assignee      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  material_cost NUMERIC(19,4) NOT NULL DEFAULT 0,
  labor_cost    NUMERIC(19,4) NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders (status, due_date);

CREATE TABLE IF NOT EXISTS wo_materials (
  id           BIGSERIAL PRIMARY KEY,
  wo_id        BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES items(id),
  qty_required NUMERIC(16,4) NOT NULL,
  qty_issued   NUMERIC(16,4) NOT NULL DEFAULT 0,
  cost_issued  NUMERIC(19,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS wo_materials_wo_idx ON wo_materials (wo_id);

CREATE TABLE IF NOT EXISTS wo_operations (
  id              BIGSERIAL PRIMARY KEY,
  wo_id           BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  seq             INT NOT NULL,
  name            TEXT NOT NULL,
  work_center_id  BIGINT NOT NULL REFERENCES work_centers(id),
  planned_minutes NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_minutes  NUMERIC(12,2),
  rate_per_hour   NUMERIC(19,4) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done')),
  done_by         TEXT NOT NULL DEFAULT '',
  done_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wo_operations_wo_idx ON wo_operations (wo_id, seq);

-- Demand from outside manufacturing: forecasts, sales orders, anything typed in by hand.
CREATE TABLE IF NOT EXISTS demands (
  id         BIGSERIAL PRIMARY KEY,
  item_id    BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty        NUMERIC(16,4) NOT NULL CHECK (qty > 0),
  due_date   DATE NOT NULL,
  reference  TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'manual',
  open       BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demands_open_idx ON demands (due_date) WHERE open;

CREATE TABLE IF NOT EXISTS mrp_runs (
  id       BIGSERIAL PRIMARY KEY,
  run_by   TEXT NOT NULL DEFAULT '',
  run_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  orders   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS planned_orders (
  id         BIGSERIAL PRIMARY KEY,
  run_id     BIGINT NOT NULL REFERENCES mrp_runs(id) ON DELETE CASCADE,
  item_id    BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('make','buy')),
  qty        NUMERIC(16,4) NOT NULL,
  need_date  DATE NOT NULL,
  start_date DATE NOT NULL,
  late       BOOLEAN NOT NULL DEFAULT false,
  reason     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','firmed','dismissed')),
  firmed_ref TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS planned_orders_status_idx ON planned_orders (status, start_date);

-- What MRP says to buy, once someone agrees: purchasing (or Books) turns these into orders.
CREATE TABLE IF NOT EXISTS purchase_requests (
  id          BIGSERIAL PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  item_id     BIGINT NOT NULL REFERENCES items(id),
  qty         NUMERIC(16,4) NOT NULL CHECK (qty > 0),
  need_date   DATE,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ordered','received','cancelled')),
  vendor      TEXT NOT NULL DEFAULT '',
  reference   TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_requests_status_idx ON purchase_requests (status, need_date);

CREATE TABLE IF NOT EXISTS assets (
  id                 BIGSERIAL PRIMARY KEY,
  tag                TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  category           TEXT NOT NULL DEFAULT '',
  location           TEXT NOT NULL DEFAULT '',
  make               TEXT NOT NULL DEFAULT '',
  model              TEXT NOT NULL DEFAULT '',
  serial             TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','in_repair','retired','disposed')),
  parent_id          BIGINT REFERENCES assets(id),
  assignee           TEXT NOT NULL DEFAULT '',
  purchase_date      DATE,
  purchase_cost      NUMERIC(19,4),
  salvage_value      NUMERIC(19,4),
  useful_life_months INT CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  meter_unit         TEXT NOT NULL DEFAULT '',
  meter_value        NUMERIC(16,2),
  notes              TEXT NOT NULL DEFAULT '',
  books_asset_id     TEXT,
  books_error        TEXT NOT NULL DEFAULT '',
  created_by         TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_status_idx ON assets (status, tag);
CREATE INDEX IF NOT EXISTS assets_assignee_idx ON assets (lower(assignee)) WHERE assignee <> '';

CREATE TABLE IF NOT EXISTS meter_readings (
  id        BIGSERIAL PRIMARY KEY,
  asset_id  BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  value     NUMERIC(16,2) NOT NULL,
  by_email  TEXT NOT NULL DEFAULT '',
  read_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meter_readings_asset_idx ON meter_readings (asset_id, read_at DESC);

CREATE TABLE IF NOT EXISTS maint_plans (
  id                BIGSERIAL PRIMARY KEY,
  asset_id          BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  instructions      TEXT NOT NULL DEFAULT '',
  interval_days     INT CHECK (interval_days IS NULL OR interval_days > 0),
  interval_meter    NUMERIC(16,2) CHECK (interval_meter IS NULL OR interval_meter > 0),
  next_due          DATE,
  next_meter        NUMERIC(16,2),
  assignee          TEXT NOT NULL DEFAULT '',
  estimated_minutes INT NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT true,
  last_done         DATE,
  created_by        TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (interval_days IS NOT NULL OR interval_meter IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS maint_plans_asset_idx ON maint_plans (asset_id);

CREATE TABLE IF NOT EXISTS maint_orders (
  id               BIGSERIAL PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  asset_id         BIGINT NOT NULL REFERENCES assets(id),
  plan_id          BIGINT REFERENCES maint_plans(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL DEFAULT 'corrective' CHECK (kind IN ('preventive','corrective','inspection')),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','on_hold','done','cancelled')),
  requested_by     TEXT NOT NULL DEFAULT '',
  assignee         TEXT NOT NULL DEFAULT '',
  due_date         DATE,
  labor_minutes    INT NOT NULL DEFAULT 0,
  labor_rate       NUMERIC(19,4) NOT NULL DEFAULT 0,
  downtime_minutes INT NOT NULL DEFAULT 0,
  resolution       TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS maint_orders_status_idx ON maint_orders (status, due_date);
CREATE INDEX IF NOT EXISTS maint_orders_asset_idx ON maint_orders (asset_id, created_at DESC);
-- At most one open order per plan, so the scheduler can run as often as it likes.
CREATE UNIQUE INDEX IF NOT EXISTS maint_orders_open_plan_idx ON maint_orders (plan_id) WHERE plan_id IS NOT NULL AND status IN ('open','in_progress','on_hold');

CREATE TABLE IF NOT EXISTS maint_parts (
  id        BIGSERIAL PRIMARY KEY,
  order_id  BIGINT NOT NULL REFERENCES maint_orders(id) ON DELETE CASCADE,
  item_id   BIGINT NOT NULL REFERENCES items(id),
  qty       NUMERIC(16,4) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(19,4) NOT NULL DEFAULT 0,
  by_email  TEXT NOT NULL DEFAULT '',
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maint_parts_order_idx ON maint_parts (order_id);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __opsDb?: Db; __opsReady?: Promise<void> };

export function db(): Db {
  // OPS_DATABASE_URL wins; otherwise DATABASE_URL, otherwise the local development database.
  if (!g.__opsDb) {
    g.__opsDb = createDb({
      connectionString: process.env.OPS_DATABASE_URL || undefined,
      devUrl: "postgres://postgres@127.0.0.1:5499/ops",
      max: 10,
    });
  }
  return g.__opsDb;
}

export function ready(): Promise<void> {
  if (!g.__opsReady) {
    g.__opsReady = db().migrate(SCHEMA, "ops").catch((e) => {
      g.__opsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__opsReady;
}

/** pg returns NUMERIC as text; every money and quantity column comes back through this. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

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

/** The next number of a kind for this year, e.g. WO-2026-0007. Safe under concurrent requests. */
export async function nextNumber(tq: Tq, kind: string, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [r] = await tq<{ last: number }>(
    `INSERT INTO counters (kind, year, last) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET last = counters.last + 1 RETURNING last`,
    [kind, year],
  );
  return `${prefix}-${year}-${String(r.last).padStart(4, "0")}`;
}
