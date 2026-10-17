import { createDb } from "@synergy/db";

/**
 * One catalog and one stock ledger for every channel: the back office, the point of sale and the
 * online store all sell the same products from the same shelves. `stock` is the running count per
 * product and location; `movements` is the ledger that explains it, and the two only change together.
 * Orders and purchase orders are never deleted (they are cancelled), so a legal hold has nothing
 * to stop here.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL DEFAULT 'store' CHECK (kind IN ('store', 'warehouse')),
  address    TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  lead_days  INTEGER NOT NULL DEFAULT 7,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_uniq ON vendors (lower(name));

CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           TEXT NOT NULL,
  barcode       TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  unit          TEXT NOT NULL DEFAULT 'each',
  price         NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Moving average cost of what is on the shelves, updated on every receipt.
  cost          NUMERIC(14,4) NOT NULL DEFAULT 0,
  -- NULL: the store's default rate.
  tax_rate      NUMERIC(6,3),
  track_stock   BOOLEAN NOT NULL DEFAULT true,
  reorder_point NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_sku    TEXT NOT NULL DEFAULT '',
  image_url     TEXT NOT NULL DEFAULT '',
  online        BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_uniq ON products (lower(sku));
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (barcode) WHERE barcode <> '';

CREATE TABLE IF NOT EXISTS stock (
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  on_hand     NUMERIC(14,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE IF NOT EXISTS movements (
  id          BIGSERIAL PRIMARY KEY,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id),
  qty         NUMERIC(14,3) NOT NULL,
  unit_cost   NUMERIC(14,4) NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL CHECK (kind IN ('receive', 'sale', 'return', 'adjust', 'count', 'transfer_in', 'transfer_out', 'cancel', 'mfg_issue', 'mfg_receipt', 'maint_issue', 'service_issue')),
  ref_type    TEXT,
  ref_id      TEXT,
  note        TEXT NOT NULL DEFAULT '',
  by_email    TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movements_product_idx ON movements (product_id, at DESC);
CREATE INDEX IF NOT EXISTS movements_at_idx ON movements (at DESC);
-- Field Service's parts (service_issue) came after the first installs: widen their check once.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movements_kind_check' AND pg_get_constraintdef(oid) LIKE '%service_issue%') THEN
    ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_kind_check;
    ALTER TABLE movements ADD CONSTRAINT movements_kind_check CHECK (kind IN ('receive', 'sale', 'return', 'adjust', 'count', 'transfer_in', 'transfer_out', 'cancel', 'mfg_issue', 'mfg_receipt', 'maint_issue', 'service_issue'));
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS po_number_seq;
CREATE TABLE IF NOT EXISTS purchase_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number      TEXT NOT NULL UNIQUE,
  vendor_id   UUID NOT NULL REFERENCES vendors(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  expected    DATE,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ordered_at  TIMESTAMPTZ,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS po_lines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id      UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  qty        NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_cost  NUMERIC(14,4) NOT NULL DEFAULT 0,
  received   NUMERIC(14,3) NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS po_lines_po_idx ON po_lines (po_id, position);

CREATE TABLE IF NOT EXISTS receipts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id       UUID NOT NULL REFERENCES purchase_orders(id),
  seq         INTEGER NOT NULL,
  vendor_ref  TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, seq)
);
CREATE TABLE IF NOT EXISTS receipt_lines (
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  po_line_id UUID NOT NULL REFERENCES po_lines(id),
  qty        NUMERIC(14,3) NOT NULL,
  unit_cost  NUMERIC(14,4) NOT NULL,
  PRIMARY KEY (receipt_id, po_line_id)
);

CREATE TABLE IF NOT EXISTS registers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  location_id UUID NOT NULL REFERENCES locations(id),
  active      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id   UUID NOT NULL REFERENCES registers(id),
  opened_by     TEXT NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_by     TEXT,
  closed_at     TIMESTAMPTZ,
  counted_cash  NUMERIC(14,2),
  expected_cash NUMERIC(14,2),
  note          TEXT NOT NULL DEFAULT ''
);
-- One open shift per register.
CREATE UNIQUE INDEX IF NOT EXISTS shifts_open_uniq ON shifts (register_id) WHERE closed_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS order_number_seq;
CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number         TEXT NOT NULL UNIQUE,
  channel        TEXT NOT NULL CHECK (channel IN ('pos', 'online')),
  -- pending: placed, not paid yet. paid. refunded: every line came back. cancelled: never paid, stock put back.
  status         TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'partially_refunded', 'refunded', 'cancelled')),
  fulfillment    TEXT NOT NULL DEFAULT 'fulfilled' CHECK (fulfillment IN ('unfulfilled', 'ready', 'fulfilled')),
  delivery       TEXT NOT NULL DEFAULT 'in_store' CHECK (delivery IN ('in_store', 'pickup', 'ship')),
  location_id    UUID NOT NULL REFERENCES locations(id),
  shift_id       UUID REFERENCES shifts(id),
  cashier        TEXT,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  ship_address   TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid           NUMERIC(14,2) NOT NULL DEFAULT 0,
  refunded       NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- The customer's link to their online order; never shown to anyone else.
  public_token   TEXT UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ,
  fulfilled_at   TIMESTAMPTZ,
  modified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (channel, status, fulfillment);
CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (lower(customer_email)) WHERE customer_email <> '';

CREATE TABLE IF NOT EXISTS order_lines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  sku        TEXT NOT NULL,
  name       TEXT NOT NULL,
  qty        NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(14,2) NOT NULL,
  discount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate   NUMERIC(6,3) NOT NULL DEFAULT 0,
  tax        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total      NUMERIC(14,2) NOT NULL,
  unit_cost  NUMERIC(14,4) NOT NULL DEFAULT 0,
  tracked    BOOLEAN NOT NULL DEFAULT true,
  refunded   NUMERIC(14,3) NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id, position);

CREATE TABLE IF NOT EXISTS payments (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method   TEXT NOT NULL CHECK (method IN ('cash', 'card', 'online', 'other')),
  -- Negative for money given back on a refund.
  amount   NUMERIC(14,2) NOT NULL,
  tendered NUMERIC(14,2),
  change   NUMERIC(14,2),
  ref      TEXT NOT NULL DEFAULT '',
  shift_id UUID REFERENCES shifts(id),
  by_email TEXT,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS payments_shift_idx ON payments (shift_id) WHERE shift_id IS NOT NULL;
-- A payment provider's callback for one payment is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS payments_online_ref_uniq ON payments (ref) WHERE method = 'online' AND ref <> '';

CREATE TABLE IF NOT EXISTS refunds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id),
  seq        INTEGER NOT NULL,
  amount     NUMERIC(14,2) NOT NULL,
  method     TEXT NOT NULL,
  restock    BOOLEAN NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  lines      JSONB NOT NULL,
  by_email   TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

-- Books outbox: every accounting effect, kept until Books has it. reference is the idempotency key.
CREATE TABLE IF NOT EXISTS postings (
  id         BIGSERIAL PRIMARY KEY,
  reference  TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('sale', 'refund', 'receipt', 'adjustment')),
  date       DATE NOT NULL,
  payload    JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed')),
  error      TEXT NOT NULL DEFAULT '',
  attempts   INTEGER NOT NULL DEFAULT 0,
  books_ref  TEXT,
  tried_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at  TIMESTAMPTZ
);
-- Stock moves other suite apps (Operations) sent through /api/svc/stock-moves, one per reference,
-- so a retried request gets the first answer back instead of moving stock twice.
CREATE TABLE IF NOT EXISTS svc_moves (
  reference  TEXT PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id),
  qty        NUMERIC(14,3) NOT NULL,
  unit_cost  NUMERIC(14,4) NOT NULL,
  on_hand    NUMERIC(14,3) NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS postings_open_idx ON postings (id) WHERE status <> 'posted';
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __commerceDb?: Db; __commerceReady?: Promise<void> };

export function db(): Db {
  if (!g.__commerceDb) g.__commerceDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/commerce", max: 10 });
  return g.__commerceDb;
}

export function ready(): Promise<void> {
  if (!g.__commerceReady) {
    g.__commerceReady = db().migrate(SCHEMA, "commerce").catch((e) => {
      g.__commerceReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__commerceReady;
}

export type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

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
