import { createDb } from "@synergy/db";

/**
 * The marketing model. `members` are the suite's people as Campaigns knows them, with a role.
 * An audience is a list of subscribers (one row per address per audience) that people join by
 * import, from CRM or Contacts, or through a public signup form; segments are saved filters over
 * one audience. A campaign is one email sent to an audience or segment: sending queues one
 * `deliveries` row per recipient, each with a random token that its open pixel, click links and
 * unsubscribe link carry. Opens, clicks, unsubscribes, bounces and complaints are `events`.
 * `suppressions` are addresses nothing may ever be sent to again (unsubscribed from everything,
 * hard bounced, or complained), whichever audience they turn up in.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','marketer','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row: who campaigns come from and the postal address the law asks every email to carry.
CREATE TABLE IF NOT EXISTS settings (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  from_name      TEXT NOT NULL DEFAULT '',
  from_email     TEXT NOT NULL DEFAULT '',
  reply_to       TEXT NOT NULL DEFAULT '',
  org_name       TEXT NOT NULL DEFAULT '',
  postal_address TEXT NOT NULL DEFAULT '',
  per_minute     INTEGER NOT NULL DEFAULT 60 CHECK (per_minute BETWEEN 1 AND 6000),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     TEXT
);

CREATE TABLE IF NOT EXISTS audiences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  -- The public signup form: off, or on with a confirmation email first (double opt-in).
  form_enabled  BOOLEAN NOT NULL DEFAULT false,
  double_opt_in BOOLEAN NOT NULL DEFAULT true,
  form_intro    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_by    TEXT
);

CREATE TABLE IF NOT EXISTS subscribers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  first_name  TEXT NOT NULL DEFAULT '',
  last_name   TEXT NOT NULL DEFAULT '',
  company     TEXT NOT NULL DEFAULT '',
  fields      JSONB NOT NULL DEFAULT '{}',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('pending','subscribed','unsubscribed','cleaned')),
  -- Where they came from: manual, csv, crm_contact, crm_lead, contacts, form.
  source      TEXT NOT NULL DEFAULT 'manual',
  source_ref  TEXT NOT NULL DEFAULT '',
  -- Proves a signup form address (double opt-in) before anything is sent to it.
  confirm_token TEXT UNIQUE,
  consent_at  TIMESTAMPTZ,
  consent_ip  TEXT NOT NULL DEFAULT '',
  unsubscribed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_audience_email_idx ON subscribers (audience_id, lower(email));
CREATE INDEX IF NOT EXISTS subscribers_email_idx ON subscribers (lower(email));

-- A sync source keeps an audience filled from CRM or Contacts, re-read before each send.
CREATE TABLE IF NOT EXISTS audience_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('crm_contacts','crm_leads','contacts_group')),
  params      JSONB NOT NULL DEFAULT '{}',
  label       TEXT NOT NULL DEFAULT '',
  -- The app is asked as this person, so it only hands over what they may see.
  owner       TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_result TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rules       JSONB NOT NULL DEFAULT '{"match":"all","conditions":[]}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS suppressions (
  email       TEXT PRIMARY KEY,
  reason      TEXT NOT NULL CHECK (reason IN ('unsubscribed','bounced','complained','manual')),
  detail      TEXT NOT NULL DEFAULT '',
  campaign_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  preheader  TEXT NOT NULL DEFAULT '',
  blocks     JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  audience_id UUID REFERENCES audiences(id) ON DELETE SET NULL,
  segment_id  UUID REFERENCES segments(id) ON DELETE SET NULL,
  subject     TEXT NOT NULL DEFAULT '',
  preheader   TEXT NOT NULL DEFAULT '',
  from_name   TEXT NOT NULL DEFAULT '',
  reply_to    TEXT NOT NULL DEFAULT '',
  blocks      JSONB NOT NULL DEFAULT '[]',
  -- Frozen when sending starts: the composed body (lib/render.ts, as JSON) and its links, by position.
  html        TEXT,
  links       JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','scheduled','sending','paused','sent','canceled')),
  scheduled_at TIMESTAMPTZ,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  recipients  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status, scheduled_at);

-- A welcome email (or any one email) sent a while after someone joins an audience.
CREATE TABLE IF NOT EXISTS automations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  audience_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  trigger     TEXT NOT NULL DEFAULT 'subscribed' CHECK (trigger IN ('subscribed','tagged')),
  tag         TEXT NOT NULL DEFAULT '',
  delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 525600),
  subject     TEXT NOT NULL DEFAULT '',
  preheader   TEXT NOT NULL DEFAULT '',
  blocks      JSONB NOT NULL DEFAULT '[]',
  active      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  due_at        TIMESTAMPTZ NOT NULL,
  done_at       TIMESTAMPTZ,
  UNIQUE (automation_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS automation_runs_due_idx ON automation_runs (due_at) WHERE done_at IS NULL;

-- One email to one person: a campaign's recipient, or an automation's.
CREATE TABLE IF NOT EXISTS deliveries (
  id            BIGSERIAL PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,
  campaign_id   UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  automation_id UUID REFERENCES automations(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  audience_id   UUID,
  email         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','bounced','skipped')),
  error         TEXT NOT NULL DEFAULT '',
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_try_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_id    TEXT,
  -- An automation's links as sent (a campaign's are on the campaign).
  links         JSONB,
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_campaign_email_idx ON deliveries (campaign_id, lower(email)) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deliveries_queue_idx ON deliveries (next_try_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS deliveries_subscriber_idx ON deliveries (subscriber_id);

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  campaign_id UUID,
  kind        TEXT NOT NULL CHECK (kind IN ('open','click','unsubscribe','bounce','complaint')),
  url         TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_campaign_idx ON events (campaign_id, kind);
CREATE INDEX IF NOT EXISTS events_delivery_idx ON events (delivery_id);

-- How far the bounce check has read each mailbox (lib/bounces.ts).
CREATE TABLE IF NOT EXISTS bounce_state (
  mailbox      TEXT PRIMARY KEY,
  uid_validity TEXT NOT NULL,
  last_uid     BIGINT NOT NULL
);

-- One row per AI request, for cost and audit; never the prompt or the answer.
CREATE TABLE IF NOT EXISTS ai_calls (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature    TEXT NOT NULL,
  model      TEXT NOT NULL,
  ok         BOOLEAN NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaigns and templates deleted while their author was on legal hold, kept for eDiscovery.
CREATE TABLE IF NOT EXISTS held_records (
  id         UUID PRIMARY KEY,
  kind       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  record     JSONB NOT NULL,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __campaignsDb?: Db; __campaignsReady?: Promise<void> };

export function db(): Db {
  if (!g.__campaignsDb) {
    g.__campaignsDb = createDb({
      // CAMPAIGNS_DATABASE_URL lets Campaigns share a host with apps that read DATABASE_URL.
      connectionString: process.env.CAMPAIGNS_DATABASE_URL || undefined,
      devUrl: "postgres://postgres@127.0.0.1:5499/campaigns",
      max: 10,
    });
  }
  return g.__campaignsDb;
}

export function ready(): Promise<void> {
  if (!g.__campaignsReady) {
    g.__campaignsReady = db().migrate(SCHEMA, "campaigns").catch((e) => {
      g.__campaignsReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__campaignsReady;
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
