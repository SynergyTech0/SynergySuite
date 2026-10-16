import { createDb } from "@synergy/db";

/**
 * A contract belongs to its owner and the people shared on it. The legal team
 * (CONTRACTS_ADMIN_EMAILS, default ADMIN_EMAILS) sees every contract and keeps the template and
 * clause library. Approvers see the contracts they are asked to approve.
 *
 * The text of a contract is kept as plain text with light Markdown (headings, lists, bold), with
 * every saved change as a version so a later draft can be compared with an earlier one.
 * Money is whole cents. Dates are calendar days.
 */
const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS contract_number_seq;
CREATE TABLE IF NOT EXISTS contracts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number             TEXT NOT NULL,
  title              TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'Other',
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'review', 'approved', 'signing', 'active', 'expired', 'terminated')),
  counterparty       TEXT NOT NULL DEFAULT '',
  counterparty_email TEXT NOT NULL DEFAULT '',
  owner              TEXT NOT NULL,
  value_cents        BIGINT,
  currency           TEXT NOT NULL DEFAULT 'USD',
  start_day          DATE,
  end_day            DATE,
  auto_renew         BOOLEAN NOT NULL DEFAULT false,
  renewal_months     INTEGER NOT NULL DEFAULT 12 CHECK (renewal_months BETWEEN 1 AND 120),
  notice_days        INTEGER NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 0 AND 730),
  body               TEXT NOT NULL DEFAULT '',
  template_id        UUID,
  crm_deal           TEXT NOT NULL DEFAULT '',
  sign_ref           TEXT,
  sign_url           TEXT NOT NULL DEFAULT '',
  signed_at          TIMESTAMPTZ,
  terminated_at      TIMESTAMPTZ,
  ai_review          JSONB,
  ai_reviewed_at     TIMESTAMPTZ,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_number_uniq ON contracts (number);
CREATE INDEX IF NOT EXISTS contracts_owner_idx ON contracts (owner);
CREATE INDEX IF NOT EXISTS contracts_end_idx ON contracts (status, end_day);

CREATE TABLE IF NOT EXISTS contract_people (
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor', 'viewer')),
  added_by    TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, email)
);
CREATE INDEX IF NOT EXISTS contract_people_email_idx ON contract_people (email);

CREATE TABLE IF NOT EXISTS contract_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  body        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, n)
);

-- One row per approval step. Steps run in order: only the lowest pending step can decide.
CREATE TABLE IF NOT EXISTS approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  round        INTEGER NOT NULL,
  step         INTEGER NOT NULL,
  approver     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  comment      TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS approvals_contract_idx ON approvals (contract_id, round, step);
CREATE INDEX IF NOT EXISTS approvals_approver_idx ON approvals (approver, status);

CREATE TABLE IF NOT EXISTS obligations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  due_day         DATE,
  assignee        TEXT,
  done_at         TIMESTAMPTZ,
  done_by         TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS obligations_contract_idx ON obligations (contract_id, due_day);

CREATE TABLE IF NOT EXISTS contract_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'attachment' CHECK (kind IN ('attachment', 'executed')),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  bytes           BYTEA NOT NULL,
  uploaded_by     TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS contract_files_contract_idx ON contract_files (contract_id);

CREATE TABLE IF NOT EXISTS contract_events (
  id          BIGSERIAL PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_events_contract_idx ON contract_events (contract_id, at);
-- Signature events are applied once each (the sender retries until it hears back).
CREATE TABLE IF NOT EXISTS sign_events_seen (ref TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'Other',
  description TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clauses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'General',
  body        TEXT NOT NULL,
  guidance    TEXT NOT NULL DEFAULT '',
  fallback    TEXT NOT NULL DEFAULT '',
  required    BOOLEAN NOT NULL DEFAULT false,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clauses_title_uniq ON clauses (lower(title)) WHERE NOT archived;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __contractsDb?: Db; __contractsReady?: Promise<void> };

export function db(): Db {
  if (!g.__contractsDb) g.__contractsDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/contracts", max: 10 });
  return g.__contractsDb;
}

export function ready(): Promise<void> {
  if (!g.__contractsReady) {
    g.__contractsReady = db().migrate(SCHEMA, "contracts").catch((e) => {
      g.__contractsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__contractsReady;
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
