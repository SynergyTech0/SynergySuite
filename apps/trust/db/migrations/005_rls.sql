-- Synergy Trust 005: tenant isolation via row-level security.
--
-- WHY RLS RATHER THAN APPLICATION FILTERING
-- A compliance product holds, for every customer, a precise map of where that customer is
-- weakest. Cross-tenant leakage is not a bug here, it is the end of the company. Relying on
-- every query carrying a correct `WHERE tenant_id = $1` means one forgotten clause in one
-- rarely-hit report is a breach - and it fails silently, returning MORE data, which no test
-- that asserts "rows came back" will ever catch.
--
-- So isolation lives in the database. The app connects as `strust_app`, which cannot bypass
-- RLS, and sets `app.tenant_id` per transaction. A query with no tenant set returns zero
-- rows rather than everything: fail-closed.

BEGIN;

-- The application role. No BYPASSRLS, no superuser, not the table owner.
-- (Owners ignore RLS unless FORCE is set, which is precisely the trap we are avoiding.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strust_app') THEN
    CREATE ROLE strust_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO strust_app;

-- Global catalog: readable by every tenant, writable by nobody at runtime. The framework
-- text is shipped product, not tenant data, so it carries no RLS - only a read grant.
GRANT SELECT ON frameworks, framework_sections, requirements,
                control_templates, control_template_requirement_map TO strust_app;

-- Tenant-scoped tables.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_members','tenant_frameworks','controls','control_requirement_map',
    'evidence','monitors','monitor_runs','policies','policy_versions',
    'policy_acknowledgements','risks','risk_control_map','vendors','personnel',
    'assets','processing_activities','dsar_requests','audits','audit_events'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO strust_app', t);
  END LOOP;
END
$$;

-- tenant_framework_scope has no tenant_id of its own; it inherits through its parent.
ALTER TABLE tenant_framework_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_framework_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_framework_scope
  USING (EXISTS (
    SELECT 1 FROM tenant_frameworks tf
    WHERE tf.id = tenant_framework_scope.tenant_framework_id
      AND tf.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tenant_frameworks tf
    WHERE tf.id = tenant_framework_scope.tenant_framework_id
      AND tf.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_framework_scope TO strust_app;

-- `tenants` and `users` are visible only where the caller has a membership row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, UPDATE ON tenants TO strust_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_in_tenant ON users
  USING (EXISTS (
    SELECT 1 FROM tenant_members m
    WHERE m.user_id = users.id
      AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
GRANT SELECT ON users TO strust_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO strust_app;

COMMIT;
