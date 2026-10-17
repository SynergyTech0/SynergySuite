import { createDb } from "@synergy/db";

/**
 * A law firm's practice records. A matter belongs to its responsible lawyer and the team on it;
 * the firm's administrators (LAW_ADMIN_EMAILS, default ADMIN_EMAILS) see every matter. Client
 * names and every matter's parties are read firm-wide by conflict checks, which is the point of them.
 *
 * Trust money is a ledger of transactions that are never edited or deleted, only voided by a
 * later entry, so a client's balance can always be rebuilt from its history. Money is whole cents.
 * Dates are calendar days. Uploaded case documents are kept in the database with their text.
 */
const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS matter_number_seq;
CREATE SEQUENCE IF NOT EXISTS bill_number_seq;
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'organization')),
  name        TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('prospect', 'active', 'former')),
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS clients_name ON clients (lower(name));
CREATE TABLE IF NOT EXISTS matters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  client_id        UUID NOT NULL REFERENCES clients(id),
  practice_area    TEXT NOT NULL DEFAULT 'General',
  jurisdiction     TEXT NOT NULL DEFAULT 'FED',
  court            TEXT NOT NULL DEFAULT '',
  case_number      TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  fee_type         TEXT NOT NULL DEFAULT 'hourly' CHECK (fee_type IN ('hourly', 'flat', 'contingency', 'pro_bono')),
  rate_cents       BIGINT CHECK (rate_cents >= 0),
  flat_cents       BIGINT CHECK (flat_cents >= 0),
  contingency_pct  NUMERIC(5,2) CHECK (contingency_pct BETWEEN 0 AND 100),
  currency         TEXT NOT NULL DEFAULT 'USD',
  engagement_signed_on DATE,
  opened_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_on        DATE,
  responsible      TEXT NOT NULL,
  ai_brief         JSONB,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS matters_client ON matters (client_id);
CREATE TABLE IF NOT EXISTS matter_people (
  matter_id  UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'lawyer' CHECK (role IN ('lawyer', 'paralegal', 'staff')),
  rate_cents BIGINT CHECK (rate_cents >= 0),
  added_by   TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, email)
);
CREATE INDEX IF NOT EXISTS matter_people_email ON matter_people (email);
CREATE TABLE IF NOT EXISTS matter_parties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id  UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  normalized TEXT NOT NULL,
  aliases    TEXT[] NOT NULL DEFAULT '{}',
  kind       TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'organization')),
  role       TEXT NOT NULL CHECK (role IN ('adverse', 'co_party', 'opposing_counsel', 'witness', 'related')),
  notes      TEXT NOT NULL DEFAULT '',
  added_by   TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matter_parties_matter ON matter_parties (matter_id);
CREATE TABLE IF NOT EXISTS conflict_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  names       TEXT[] NOT NULL,
  matter_id   UUID REFERENCES matters(id) ON DELETE SET NULL,
  results     JSONB NOT NULL,
  hits        INTEGER NOT NULL,
  decision    TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'cleared', 'waived', 'declined')),
  note        TEXT NOT NULL DEFAULT '',
  checked_by  TEXT NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS deadlines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  due_day     DATE NOT NULL,
  basis       TEXT NOT NULL DEFAULT '',
  assignee    TEXT,
  done_at     TIMESTAMPTZ,
  done_by     TEXT,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deadlines_due ON deadlines (due_day) WHERE done_at IS NULL;
CREATE TABLE IF NOT EXISTS bills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT NOT NULL UNIQUE,
  matter_id    UUID NOT NULL REFERENCES matters(id),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'recorded', 'sent')),
  through_day  DATE NOT NULL,
  total_cents  BIGINT NOT NULL,
  currency     TEXT NOT NULL,
  lines        JSONB NOT NULL,
  books_id     TEXT,
  books_number TEXT,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS time_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id    UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'time' CHECK (kind IN ('time', 'expense')),
  who          TEXT NOT NULL,
  day          DATE NOT NULL,
  minutes      INTEGER NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  rate_cents   BIGINT NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
  amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  description  TEXT NOT NULL,
  billable     BOOLEAN NOT NULL DEFAULT true,
  bill_id      UUID REFERENCES bills(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_matter ON time_entries (matter_id, day);
CREATE TABLE IF NOT EXISTS trust_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  bank          TEXT NOT NULL DEFAULT '',
  jurisdiction  TEXT NOT NULL DEFAULT 'FED',
  iolta         BOOLEAN NOT NULL DEFAULT true,
  books_account TEXT NOT NULL DEFAULT '',
  archived      BOOLEAN NOT NULL DEFAULT false,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trust_txns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES trust_accounts(id),
  client_id    UUID NOT NULL REFERENCES clients(id),
  matter_id    UUID REFERENCES matters(id),
  kind         TEXT NOT NULL CHECK (kind IN ('deposit', 'disbursement', 'fee_transfer')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  day          DATE NOT NULL,
  received_on  DATE,
  party        TEXT NOT NULL DEFAULT '',
  reference    TEXT NOT NULL DEFAULT '',
  memo         TEXT NOT NULL DEFAULT '',
  bill_id      UUID REFERENCES bills(id),
  books_status TEXT NOT NULL DEFAULT 'none' CHECK (books_status IN ('none', 'posted', 'failed')),
  books_error  TEXT NOT NULL DEFAULT '',
  entered_by   TEXT NOT NULL,
  entered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at    TIMESTAMPTZ,
  voided_by    TEXT,
  void_reason  TEXT NOT NULL DEFAULT '',
  void_books_status TEXT NOT NULL DEFAULT 'none' CHECK (void_books_status IN ('none', 'posted', 'failed'))
);
CREATE INDEX IF NOT EXISTS trust_txns_account ON trust_txns (account_id, day);
CREATE INDEX IF NOT EXISTS trust_txns_client ON trust_txns (client_id);
CREATE TABLE IF NOT EXISTS reconciliations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES trust_accounts(id),
  statement_day   DATE NOT NULL,
  statement_cents BIGINT NOT NULL,
  outstanding_cents BIGINT NOT NULL DEFAULT 0,
  book_cents      BIGINT NOT NULL,
  clients_cents   BIGINT NOT NULL,
  balanced        BOOLEAN NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  done_by         TEXT NOT NULL,
  done_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id    UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL,
  bytes        BYTEA NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  pages        INTEGER,
  analysis     JSONB,
  analyzed_at  TIMESTAMPTZ,
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS documents_matter ON documents (matter_id);
CREATE TABLE IF NOT EXISTS matter_events (
  id         BIGSERIAL PRIMARY KEY,
  matter_id  UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  actor      TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matter_events_matter ON matter_events (matter_id, at);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __lawDb?: Db; __lawReady?: Promise<void> };

export function db(): Db {
  if (!g.__lawDb) g.__lawDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/law", max: 10 });
  return g.__lawDb;
}

export function ready(): Promise<void> {
  if (!g.__lawReady) {
    g.__lawReady = db().migrate(SCHEMA, "law").catch((e) => {
      g.__lawReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__lawReady;
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
