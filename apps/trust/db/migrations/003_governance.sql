-- Synergy Trust 003: governance registers, GDPR records, and audit engagements.

BEGIN;

-- ---------------------------------------------------------------------------
-- Policies  (ISO 27001 cl.5.2 + Annex A.5.1, SOC 2 CC5)
-- ---------------------------------------------------------------------------

CREATE TABLE policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key            text NOT NULL,
  title          text NOT NULL,
  owner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','in_review','approved','retired')),
  review_cadence text NOT NULL DEFAULT 'annual'
                 CHECK (review_cadence IN ('annual','biannual','quarterly')),
  review_due     date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

-- Versions are immutable once written (trigger in 004). Auditors test that the policy in
-- force during the window was approved before it; a mutable body makes that unanswerable.
CREATE TABLE policy_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id       uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version         int NOT NULL,
  body_md         text NOT NULL,
  content_hash    text NOT NULL,
  author_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  effective_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version),
  CONSTRAINT effective_needs_approval
    CHECK (effective_at IS NULL OR approved_at IS NOT NULL)
);

CREATE TABLE policy_acknowledgements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_version_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Risk register  (ISO 27001 cl.6.1, SOC 2 CC3)
-- ---------------------------------------------------------------------------

CREATE TABLE risks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key                 text NOT NULL,
  title               text NOT NULL,
  description         text,
  category            text,
  likelihood          int NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact              int NOT NULL CHECK (impact BETWEEN 1 AND 5),
  treatment           text NOT NULL DEFAULT 'mitigate'
                      CHECK (treatment IN ('mitigate','accept','transfer','avoid')),
  residual_likelihood int CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_impact     int CHECK (residual_impact BETWEEN 1 AND 5),
  owner_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','treated','accepted','closed')),
  review_due          date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  -- An accepted risk with no named owner is nobody's risk. ISO auditors look for exactly this.
  CONSTRAINT accepted_needs_owner
    CHECK (treatment <> 'accept' OR owner_user_id IS NOT NULL)
);

-- Scores are derived, never stored: a stored score drifts from its inputs the first time
-- somebody edits likelihood and forgets to redo the multiplication.
CREATE VIEW risk_scores AS
SELECT id, tenant_id, key, title,
       likelihood * impact AS inherent_score,
       COALESCE(residual_likelihood, likelihood)
         * COALESCE(residual_impact, impact) AS residual_score
FROM risks;

CREATE TABLE risk_control_map (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  risk_id    uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  control_id uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  PRIMARY KEY (risk_id, control_id)
);

-- ---------------------------------------------------------------------------
-- Third parties  (SOC 2 CC9, ISO A.5.19-A.5.22, GDPR Art.28, HIPAA BAAs)
-- ---------------------------------------------------------------------------

CREATE TABLE vendors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  category                text,
  criticality             text NOT NULL DEFAULT 'medium'
                          CHECK (criticality IN ('low','medium','high','critical')),
  processes_personal_data boolean NOT NULL DEFAULT false,
  processes_phi           boolean NOT NULL DEFAULT false,
  is_subprocessor         boolean NOT NULL DEFAULT false,
  dpa_status              text CHECK (dpa_status IN ('not_required','pending','signed')),
  baa_status              text CHECK (baa_status IN ('not_required','pending','signed')),
  assurance_report        text,           -- e.g. 'SOC 2 Type II through 2026-03-31'
  review_due              date,
  owner_user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- Letting a vendor touch PHI without a signed BAA is a HIPAA violation on its face,
  -- not a backlog item. The database refuses to record it as acceptable.
  CONSTRAINT phi_requires_baa
    CHECK (NOT processes_phi OR baa_status = 'signed')
);

-- ---------------------------------------------------------------------------
-- People and assets  (SOC 2 CC1, ISO A.6 / A.5.9)
-- ---------------------------------------------------------------------------

CREATE TABLE personnel (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name            text NOT NULL,
  email                text NOT NULL,
  role_title           text,
  start_date           date,
  end_date             date,
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','offboarded','contractor')),
  background_check_at  date,
  security_training_at date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offboarded_needs_end_date
    CHECK (status <> 'offboarded' OR end_date IS NOT NULL)
);

CREATE TABLE assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key            text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL,   -- host | container | database | saas | endpoint | repo
  classification text NOT NULL DEFAULT 'internal'
                 CHECK (classification IN ('public','internal','confidential','restricted')),
  owner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  location       text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

-- ---------------------------------------------------------------------------
-- GDPR records  (Art.30 ROPA, Art.12-22 data subject rights)
-- ---------------------------------------------------------------------------

CREATE TABLE processing_activities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  purpose               text NOT NULL,
  lawful_basis          text NOT NULL CHECK (lawful_basis IN
                          ('consent','contract','legal_obligation','vital_interests',
                           'public_task','legitimate_interests')),
  data_categories       text[] NOT NULL DEFAULT '{}',
  special_category      boolean NOT NULL DEFAULT false,
  data_subjects         text[] NOT NULL DEFAULT '{}',
  recipients            text[] NOT NULL DEFAULT '{}',
  retention             text NOT NULL,
  transfers_outside_eea boolean NOT NULL DEFAULT false,
  transfer_safeguard    text,
  dpia_required         boolean NOT NULL DEFAULT false,
  dpia_ref              text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Art.44-49: an international transfer needs a named safeguard, not an intention.
  CONSTRAINT transfer_needs_safeguard
    CHECK (NOT transfers_outside_eea OR transfer_safeguard IS NOT NULL),
  CONSTRAINT dpia_needs_ref
    CHECK (NOT dpia_required OR dpia_ref IS NOT NULL)
);

-- Art.12(3): one month to respond. due_at is stored, not computed at read time, so the
-- clock is explicit, reportable, and survives a change to our own default assumptions.
CREATE TABLE dsar_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_email  text NOT NULL,
  kind           text NOT NULL CHECK (kind IN
                   ('access','rectification','erasure','restriction',
                    'portability','objection')),
  received_at    timestamptz NOT NULL,
  due_at         timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','fulfilled','refused','extended')),
  refusal_reason text,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refusal_needs_reason
    CHECK (status <> 'refused' OR refusal_reason IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Audit engagements
-- ---------------------------------------------------------------------------

CREATE TABLE audits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  framework_id uuid NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN
                 ('readiness','type_1','type_2','stage_1','stage_2',
                  'surveillance','internal')),
  period_start date,
  period_end   date,
  auditor_firm text,
  status       text NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','fieldwork','draft_report','issued','qualified')),
  report_uri   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_ordered
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  -- A Type II or surveillance opinion covers a window. Without one there is nothing to test.
  CONSTRAINT window_kinds_need_period
    CHECK (kind NOT IN ('type_2','surveillance')
           OR (period_start IS NOT NULL AND period_end IS NOT NULL))
);

COMMIT;
