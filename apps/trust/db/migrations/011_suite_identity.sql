-- Trust 011: sign-in moves to the suite.
--
-- Trust no longer authenticates anyone itself. The suite gateway (SynergyAuth behind
-- oauth2-proxy) signs people in and passes their email to the app on every request; Trust
-- finds or creates the matching `users` row and decides what that person may see from
-- `tenant_members`. Passwords, second factors, lockout and Trust's own session rows are
-- therefore gone, and invitations become "add a member by email": a pending row that turns
-- into a membership the first time that email arrives through the gateway.
--
-- Kept as they were: membership roles, the read-only database role for auditor and viewer
-- seats, row-level security with the per-request tenant setting, and the append-only
-- `auth_events` log, which now records access events (first arrival, denied access,
-- invitations claimed, tenant switches, membership changes).

BEGIN;

-- ---------------------------------------------------------------------------
-- Users: identity comes from the suite
-- ---------------------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT IF EXISTS active_user_has_password;
ALTER TABLE users
  DROP COLUMN IF EXISTS password_hash,
  DROP COLUMN IF EXISTS password_set_at,
  DROP COLUMN IF EXISTS mfa_secret_enc,
  DROP COLUMN IF EXISTS mfa_enrolled_at,
  DROP COLUMN IF EXISTS failed_logins,
  DROP COLUMN IF EXISTS locked_until;

-- A user row now exists only because that person arrived through the gateway, so it is
-- active from the start. 'suspended' still refuses access; 'invited' is kept as a legal
-- value so rows written before this migration stay valid.
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
UPDATE users SET status = 'active' WHERE status = 'invited';
-- The gateway's email is matched lower-cased; users_email_lower_idx already rules out two
-- rows differing only in case, so this cannot collide.
UPDATE users SET email = lower(email) WHERE email <> lower(email);

-- When this person last started using Trust (refreshed at most every 30 minutes).
COMMENT ON COLUMN users.last_login_at IS
  'Start of the most recent visit through the suite gateway; refreshed after 30 idle minutes.';

-- ---------------------------------------------------------------------------
-- Trust's own sessions and second factors are gone
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS recovery_codes;

-- ---------------------------------------------------------------------------
-- Invitations: add a member by email
-- ---------------------------------------------------------------------------
--
-- No token and no link: the gateway has already proved who the person is, so the email
-- alone decides which pending invitation is theirs. Password-reset rows have no meaning any
-- more and are retired as revoked so the history stays readable.

UPDATE invitations SET revoked_at = now()
 WHERE kind = 'password_reset' AND accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitations DROP COLUMN IF EXISTS token_hash;
ALTER TABLE invitations DROP COLUMN IF EXISTS kind;
-- Pending until claimed or revoked; there is no link to go stale.
ALTER TABLE invitations ALTER COLUMN expires_at DROP NOT NULL;

UPDATE invitations SET email = lower(trim(email)) WHERE email <> lower(trim(email));

-- One pending invitation per address per organisation. Adding someone again replaces it.
UPDATE invitations i SET revoked_at = now()
 WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
   AND EXISTS (SELECT 1 FROM invitations j
                WHERE j.tenant_id = i.tenant_id AND j.email = i.email
                  AND j.accepted_at IS NULL AND j.revoked_at IS NULL
                  AND (j.created_at, j.id) > (i.created_at, i.id));
CREATE UNIQUE INDEX invitations_pending_idx
  ON invitations (tenant_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_email_pending_idx
  ON invitations (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Tenant provisioning, shared by the app and the seed script
-- ---------------------------------------------------------------------------
--
-- Creates an organisation, adopts SOC 2 with the Common Criteria in scope, and instantiates
-- every library control at `not_started` with its framework mappings. Adopting a control is
-- not implementing it, so nothing starts in any other status.
--
-- Runs on the owner connection. The tenant-scoped tables have FORCE ROW LEVEL SECURITY, so
-- the new tenant is set as app.tenant_id for the rest of the calling transaction before
-- anything is written to them; without it a non-superuser owner would be refused.

CREATE OR REPLACE FUNCTION trust_provision_tenant(p_slug text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
  v_soc2   uuid;
  v_tf     uuid;
BEGIN
  SELECT id INTO v_soc2 FROM frameworks WHERE key = 'soc2' ORDER BY version DESC LIMIT 1;
  IF v_soc2 IS NULL THEN
    RAISE EXCEPTION 'framework catalog is not seeded (run scripts/seed.mjs)';
  END IF;

  INSERT INTO tenants (slug, name) VALUES (p_slug, p_name)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_tenant;

  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  INSERT INTO tenant_frameworks (tenant_id, framework_id, status, scope_note)
  VALUES (v_tenant, v_soc2, 'scoping',
          'Security (Common Criteria) only. Consider Availability and Confidentiality once CC coverage is evidenced.')
  ON CONFLICT (tenant_id, framework_id) DO UPDATE SET scope_note = tenant_frameworks.scope_note
  RETURNING id INTO v_tf;

  INSERT INTO tenant_framework_scope (tenant_framework_id, section_id)
  SELECT v_tf, s.id FROM framework_sections s
   WHERE s.framework_id = v_soc2 AND s.key = 'CC'
  ON CONFLICT DO NOTHING;

  INSERT INTO controls (tenant_id, template_id, key, title, objective, status)
  SELECT v_tenant, t.id, t.key, t.title, t.objective, 'not_started'
    FROM control_templates t
  ON CONFLICT (tenant_id, key) DO NOTHING;

  INSERT INTO control_requirement_map (tenant_id, control_id, requirement_id, coverage, rationale)
  SELECT v_tenant, c.id, m.requirement_id, m.coverage, m.rationale
    FROM controls c
    JOIN control_template_requirement_map m ON m.template_id = c.template_id
   WHERE c.tenant_id = v_tenant
  ON CONFLICT (control_id, requirement_id) DO NOTHING;

  RETURN v_tenant;
END
$$;

-- ---------------------------------------------------------------------------
-- The connecting role may assume the application roles
-- ---------------------------------------------------------------------------
--
-- Requests run under SET LOCAL ROLE strust_app / strust_app_ro. A superuser can always do
-- that; a dedicated non-superuser owner needs membership, which this grants. Harmless when
-- the migration runs as a superuser.

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT strust_app, strust_app_ro TO %I', current_user);
  END IF;
END
$$;

COMMIT;
