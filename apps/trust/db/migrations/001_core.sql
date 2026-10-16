-- Synergy Trust 001: core schema.
--
-- Design decisions worth knowing before you change anything here:
--
-- 1. THE UNIFIED CONTROL MODEL. Framework `requirements` are normative text we do not own
--    (SOC 2 CC6.1, ISO A.8.5, HIPAA 164.312(d), GDPR Art.32). `controls` are what a tenant
--    actually does. The many-to-many `control_requirement_map` is the product: one control
--    ("MFA enforced on admin access") satisfies requirements in all four frameworks at once.
--    Adding a fifth framework is therefore seeding rows, never a migration.
--
-- 2. EVIDENCE IS APPEND-ONLY. Never UPDATE, never DELETE - enforced by trigger, not by
--    convention. A correction inserts a new row pointing at its predecessor via supersedes_id.
--    Evidence you can quietly rewrite is evidence an auditor is right to reject.
--
-- 3. TENANT ISOLATION IS IN THE DATABASE (see 002_rls.sql), not in application WHERE clauses.
--    One forgotten WHERE in app code leaks tenant A's control gaps to tenant B. For a
--    compliance product that is a terminal event, so RLS carries it.
--
-- 4. MONITOR RUNS ARE A TIME SERIES, not a current-state flag. SOC 2 Type II opines on
--    operating effectiveness ACROSS A WINDOW; "it passes today" is a Type I answer. The
--    history IS the deliverable.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Roles are deliberately few. `auditor` is read-only by design: an external auditor gets a
-- scoped seat rather than a shared export, so what they saw is itself auditable.
CREATE TABLE tenant_members (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner','admin','contributor','auditor','viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Framework catalog  (GLOBAL - shipped with the product, not tenant data)
-- ---------------------------------------------------------------------------

CREATE TABLE frameworks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL,
  version      text NOT NULL,
  name         text NOT NULL,
  authority    text NOT NULL,          -- AICPA, ISO/IEC, HHS, EU
  description  text,
  UNIQUE (key, version)
);

-- Hierarchy within a framework: ISO theme -> control; SOC 2 category -> criterion;
-- HIPAA part -> standard -> implementation spec. `kind` names the local level.
CREATE TABLE framework_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id  uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES framework_sections(id) ON DELETE CASCADE,
  key           text NOT NULL,
  title         text NOT NULL,
  kind          text NOT NULL,
  -- Optional framework categories (SOC 2 Availability, Confidentiality, Privacy...) are only
  -- in scope if the tenant selects them. The Common Criteria are never optional.
  selectable    boolean NOT NULL DEFAULT false,
  ordinal       int NOT NULL DEFAULT 0,
  UNIQUE (framework_id, key)
);

CREATE TABLE requirements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id  uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  section_id    uuid NOT NULL REFERENCES framework_sections(id) ON DELETE CASCADE,
  key           text NOT NULL,          -- 'CC6.1', 'A.8.5', '164.312(d)', 'Art.32(1)'
  title         text NOT NULL,
  text          text NOT NULL,          -- normative statement, paraphrased (see NOTICE.md)
  -- HIPAA's required/addressable split is load-bearing: 'addressable' does NOT mean optional,
  -- it means implement-or-document-why-not. Modelling it as a boolean loses that.
  obligation    text NOT NULL DEFAULT 'required'
                CHECK (obligation IN ('required','addressable','optional')),
  guidance      text,
  ordinal       int NOT NULL DEFAULT 0,
  UNIQUE (framework_id, key)
);

CREATE INDEX requirements_section_idx ON requirements(section_id);

-- ---------------------------------------------------------------------------
-- Control library  (GLOBAL templates + the shipped cross-framework mappings)
-- ---------------------------------------------------------------------------

CREATE TABLE control_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  title       text NOT NULL,
  objective   text NOT NULL,
  category    text NOT NULL,
  guidance    text
);

-- The intelligence we ship. Mapping a template to requirements across four frameworks is
-- what lets a tenant adopt one control and watch four coverage numbers move.
CREATE TABLE control_template_requirement_map (
  template_id     uuid NOT NULL REFERENCES control_templates(id) ON DELETE CASCADE,
  requirement_id  uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  coverage        text NOT NULL CHECK (coverage IN ('full','partial','supporting')),
  rationale       text NOT NULL,
  PRIMARY KEY (template_id, requirement_id)
);

COMMIT;
