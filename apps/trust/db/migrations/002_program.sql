-- Synergy Trust 002: the tenant's compliance program.

BEGIN;

-- Which frameworks a tenant is pursuing, and how far along.
CREATE TABLE tenant_frameworks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  framework_id  uuid NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'scoping'
                CHECK (status IN ('scoping','implementing','audit_ready','under_audit','certified','lapsed')),
  target_date   date,
  scope_note    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, framework_id)
);

-- Scope selection for frameworks with optional categories (SOC 2 A1/C1/PI1/P). Absent row
-- means out of scope, so coverage maths never silently counts criteria nobody signed up for.
CREATE TABLE tenant_framework_scope (
  tenant_framework_id uuid NOT NULL REFERENCES tenant_frameworks(id) ON DELETE CASCADE,
  section_id          uuid NOT NULL REFERENCES framework_sections(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_framework_id, section_id)
);

-- ---------------------------------------------------------------------------
-- Controls - what the tenant actually does
-- ---------------------------------------------------------------------------

CREATE TABLE controls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id     uuid REFERENCES control_templates(id) ON DELETE SET NULL,
  key             text NOT NULL,
  title           text NOT NULL,
  objective       text NOT NULL,
  owner_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 'not_applicable' demands a reason. An N/A without justification is the single most
  -- common finding in a first audit, so the constraint refuses it outright.
  status          text NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started','in_progress','implemented','not_applicable')),
  na_rationale    text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CONSTRAINT na_needs_rationale CHECK (status <> 'not_applicable' OR na_rationale IS NOT NULL)
);

CREATE TABLE control_requirement_map (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  control_id      uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  requirement_id  uuid NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  coverage        text NOT NULL CHECK (coverage IN ('full','partial','supporting')),
  rationale       text,
  PRIMARY KEY (control_id, requirement_id)
);

CREATE INDEX crm_tenant_req_idx ON control_requirement_map(tenant_id, requirement_id);

-- ---------------------------------------------------------------------------
-- Evidence - APPEND ONLY (trigger-enforced in 003)
-- ---------------------------------------------------------------------------

CREATE TABLE evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  control_id        uuid REFERENCES controls(id) ON DELETE SET NULL,
  kind              text NOT NULL CHECK (kind IN
                      ('automated','document','attestation','screenshot','ticket','config_snapshot')),
  title             text NOT NULL,
  -- When the evidence was TRUE, not when we happened to record it. An auditor testing a
  -- window cares about the former; confusing the two is how evidence lands outside the period.
  collected_at      timestamptz NOT NULL,
  collector         text,
  collector_version text,
  content_hash      text NOT NULL,   -- sha256 of the artifact; makes tampering detectable
  content_type      text,
  storage_uri       text,
  payload           jsonb,
  supersedes_id     uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_tenant_control_idx ON evidence(tenant_id, control_id, collected_at DESC);
CREATE INDEX evidence_window_idx ON evidence(tenant_id, collected_at);

-- ---------------------------------------------------------------------------
-- Continuous monitoring
-- ---------------------------------------------------------------------------

CREATE TABLE monitors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  control_id  uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  key         text NOT NULL,
  title       text NOT NULL,
  kind        text NOT NULL,          -- tls_endpoint | cert_expiry | backup_recoverable | ...
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule    text NOT NULL DEFAULT 'daily' CHECK (schedule IN ('hourly','daily','weekly','monthly')),
  severity    text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

-- Append-only time series. 'error' is distinct from 'fail' on purpose: a collector that
-- could not run is NOT a passing control, and it is not a failing one either - conflating
-- them is exactly the silent-success class this estate keeps getting bitten by.
CREATE TABLE monitor_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  monitor_id   uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('pass','fail','error','skipped')),
  message      text,
  observed     jsonb,
  evidence_id  uuid REFERENCES evidence(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monitor_runs_series_idx ON monitor_runs(tenant_id, monitor_id, started_at DESC);

COMMIT;
