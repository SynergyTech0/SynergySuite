-- Synergy Trust 010: the public trust centre.
--
-- WHAT A TRUST CENTRE MUST NOT DO
--
-- The obvious implementation publishes the dashboard. That would be a vulnerability
-- disclosure: "CC6.6 not implemented" on a public page tells an attacker exactly where to
-- start, and "backups failing since Tuesday" tells them when. A trust centre exists to
-- answer a buyer's security questionnaire, not to narrate the gaps.
--
-- So the public surface is AGGREGATE and CURATED:
--
--   * which frameworks are being pursued, and how far along  - yes
--   * how many controls are implemented                      - yes, as a count
--   * WHICH controls are not implemented                     - never
--   * policy titles                                          - yes, opt-in
--   * policy contents, evidence, monitor results, hostnames  - never
--   * subprocessors                                          - yes, opt-in (GDPR Art.28
--                                                              expects them to be listed)
--
-- Disabled by default, and every section is opt-in. A trust centre that switches itself on
-- and starts publishing is a product that leaks by default.

BEGIN;

CREATE TABLE trust_centers (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Off until somebody deliberately turns it on.
  enabled          boolean NOT NULL DEFAULT false,
  -- Separate from tenants.slug so a tenant can change its public URL without renaming
  -- itself, and so an internal slug is never forced into public view.
  public_slug      text NOT NULL UNIQUE
                   CHECK (public_slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  headline         text,
  intro            text,
  security_contact text,
  -- Per-section opt-in. Defaults are the conservative reading of each.
  show_frameworks   boolean NOT NULL DEFAULT true,
  show_control_counts boolean NOT NULL DEFAULT true,
  show_policies     boolean NOT NULL DEFAULT false,
  show_subprocessors boolean NOT NULL DEFAULT false,
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Which specific frameworks appear publicly. Absent means not shown: a tenant exploring
-- HIPAA in private should not have that become public the moment it is adopted.
CREATE TABLE trust_center_frameworks (
  tenant_id    uuid NOT NULL REFERENCES trust_centers(tenant_id) ON DELETE CASCADE,
  framework_id uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, framework_id)
);

ALTER TABLE trust_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_centers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trust_centers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE trust_center_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_center_frameworks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trust_center_frameworks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON trust_centers, trust_center_frameworks TO strust_app;
GRANT SELECT ON trust_centers, trust_center_frameworks TO strust_app_ro;

COMMIT;
