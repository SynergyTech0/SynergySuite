import { createDb } from "@synergy/db";

/**
 * The sales model. `members` are the suite's people as the CRM knows them (keyed by email,
 * with a role); every record has an owner among them. Accounts hold contacts and opportunities;
 * leads are prospects not yet qualified, converted into an account, a contact and maybe a deal.
 * Activities (tasks, events, calls, notes) hang off any record by type and id.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('admin','manager','rep')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  industry   TEXT NOT NULL DEFAULT '',
  website    TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'prospect' CHECK (type IN ('prospect','customer','partner','competitor','other')),
  owner      TEXT NOT NULL REFERENCES members(email) ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS accounts_name_idx ON accounts (lower(name));

CREATE TABLE IF NOT EXISTS contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  owner      TEXT NOT NULL REFERENCES members(email) ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS contacts_account_idx ON contacts (account_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      NUMERIC(14,2),
  stage       TEXT NOT NULL DEFAULT 'prospecting'
              CHECK (stage IN ('prospecting','qualification','proposal','negotiation','closed_won','closed_lost')),
  close_date  DATE,
  probability INTEGER CHECK (probability BETWEEN 0 AND 100),
  owner       TEXT NOT NULL REFERENCES members(email) ON UPDATE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS opportunities_account_idx ON opportunities (account_id);

CREATE TABLE IF NOT EXISTS leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  company                  TEXT NOT NULL DEFAULT '',
  email                    TEXT NOT NULL DEFAULT '',
  phone                    TEXT NOT NULL DEFAULT '',
  status                   TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','working','nurturing','qualified','unqualified','converted')),
  source                   TEXT NOT NULL DEFAULT 'other'
                           CHECK (source IN ('web','referral','event','cold_outreach','partner','other')),
  owner                    TEXT NOT NULL REFERENCES members(email) ON UPDATE CASCADE,
  -- AI scoring; a person's manual score (is_override) is never replaced by the model.
  score                    INTEGER CHECK (score BETWEEN 0 AND 100),
  score_rationale          TEXT NOT NULL DEFAULT '',
  score_model              TEXT NOT NULL DEFAULT '',
  score_updated_at         TIMESTAMPTZ,
  score_is_override        BOOLEAN NOT NULL DEFAULT false,
  -- Where a web lead came from.
  utm_source               TEXT NOT NULL DEFAULT '',
  utm_medium               TEXT NOT NULL DEFAULT '',
  utm_campaign             TEXT NOT NULL DEFAULT '',
  landing_path             TEXT NOT NULL DEFAULT '',
  converted_at             TIMESTAMPTZ,
  converted_account_id     UUID REFERENCES accounts(id) ON DELETE SET NULL,
  converted_contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  converted_opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT,
  updated_by               TEXT
);
CREATE INDEX IF NOT EXISTS leads_updated_idx ON leads (updated_at DESC);

CREATE TABLE IF NOT EXISTS activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL CHECK (type IN ('task','event','call','note')),
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  due_at       TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','canceled')),
  assignee     TEXT NOT NULL REFERENCES members(email) ON UPDATE CASCADE,
  related_type TEXT NOT NULL CHECK (related_type IN ('account','contact','lead','opportunity')),
  related_id   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_by   TEXT
);
CREATE INDEX IF NOT EXISTS activities_related_idx ON activities (related_type, related_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_assignee_idx ON activities (assignee, status);

-- One row per AI request, for cost and audit; never the prompt or the answer.
CREATE TABLE IF NOT EXISTS ai_calls (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature    TEXT NOT NULL,
  model      TEXT NOT NULL,
  ok         BOOLEAN NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  user_email TEXT,
  meta       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who can see what (lib/access.ts). rep_read is 'own' (the default) or 'all'.
CREATE TABLE IF NOT EXISTS crm_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- A record shared, read-only, with a person (email), a suite group (group:<uuid>) or everyone (*).
CREATE TABLE IF NOT EXISTS record_shares (
  kind       TEXT NOT NULL CHECK (kind IN ('account','contact','lead','opportunity')),
  record_id  UUID NOT NULL,
  principal  TEXT NOT NULL,
  shared_by  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, record_id, principal)
);
CREATE INDEX IF NOT EXISTS record_shares_principal_idx ON record_shares (principal);
CREATE INDEX IF NOT EXISTS opportunities_owner_idx ON opportunities (owner);
CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts (owner);

-- Records deleted while their owner was on legal hold, kept whole for eDiscovery (lib/ediscovery.ts).
CREATE TABLE IF NOT EXISTS held_records (
  id         UUID PRIMARY KEY,
  kind       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  record     JSONB NOT NULL,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Where an account is, and whatever else is known about it that has no column of its own
-- (details: label -> text, shown as facts on the account page). Imports fill these
-- (scripts/import-hub.mjs brings SynergyRoutes' 160,000 healthcare accounts), so the list's
-- sort, filters and search have indexes that hold up at that size.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS city        TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS state       TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lat         DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lng         DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS details     JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts (owner);
CREATE INDEX IF NOT EXISTS accounts_industry_name_idx ON accounts (industry, lower(name));
CREATE INDEX IF NOT EXISTS accounts_state_name_idx ON accounts (state, lower(name));
CREATE INDEX IF NOT EXISTS contacts_name_idx ON contacts (lower(name));
-- What the list search and suite search look in, kept by Postgres, with trigram indexes so a
-- search doesn't read every row. Without pg_trgm (no rights to add it) search still works, slower.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS search_text TEXT GENERATED ALWAYS AS (
  name || ' ' || industry || ' ' || website || ' ' || phone || ' ' || address || ' ' || city || ' ' || state || ' ' || postal_code || ' ' || type
) STORED;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS search_text TEXT GENERATED ALWAYS AS (
  name || ' ' || email || ' ' || phone || ' ' || title
) STORED;
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'crm: pg_trgm is not available (%), so search runs without its indexes', SQLERRM;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS accounts_search_trgm_idx ON accounts USING gin (search_text gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS accounts_name_trgm_idx ON accounts USING gin (name gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contacts_search_trgm_idx ON contacts USING gin (search_text gin_trgm_ops)';
  END IF;
END $$;
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __crmDb?: Db; __crmReady?: Promise<void> };

export function db(): Db {
  if (!g.__crmDb) {
    g.__crmDb = createDb({
      // CRM_DATABASE_URL lets the CRM share a host with apps that read DATABASE_URL.
      connectionString: process.env.CRM_DATABASE_URL || undefined,
      devUrl: "postgres://postgres@127.0.0.1:5499/crm",
      max: 10,
      // Postgres' JIT compiles any plan that touches a large table (an imported 160,000
      // accounts), which adds a third of a second to list, count and search queries that
      // themselves take less; the CRM's queries are short, so it is off for its connections.
      options: "-c jit=off",
    });
  }
  return g.__crmDb;
}

export function ready(): Promise<void> {
  if (!g.__crmReady) {
    g.__crmReady = db().migrate(SCHEMA, "crm").catch((e) => {
      g.__crmReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__crmReady;
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
