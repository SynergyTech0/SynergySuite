-- Synergy Trust 006: authentication, sessions, roles.
--
-- Design notes that matter before changing anything here:
--
-- 1. SESSIONS ARE ROWS, NOT TOKENS. A JWT cannot be revoked without a blocklist, and a
--    blocklist is a worse session table. This product's own control library promises
--    same-day access revocation (AC-JOINER-LEAVER -> CC6.2, 164.308(a)(3)(ii)(C)); we have
--    to be able to keep that promise about ourselves.
--
-- 2. SECRETS ARE STORED HASHED, INCLUDING SESSION TOKENS. A database read must not yield
--    anything replayable. The cookie holds the raw token; only its SHA-256 is stored, the
--    same reasoning that applies to passwords.
--
-- 3. THE AUTH PLANE SITS ABOVE THE TENANT PLANE. `users`, `sessions` and `auth_events` are
--    not RLS-scoped: a login has to resolve an identity before any tenant is known, and a
--    user may belong to several tenants. These tables are reachable only through the owner
--    connection in the auth layer, never from request handling.
--
-- 4. AUDITOR IS READ-ONLY IN POSTGRES, not in the UI. An auditor seat enforced by a GRANT
--    is a claim that survives a bug in a React component.

BEGIN;

-- ---------------------------------------------------------------------------
-- Users gain credentials
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN password_hash    text,
  ADD COLUMN password_set_at  timestamptz,
  -- 'invited' means no credential yet: the row exists so it can be granted membership and
  -- shown in the member list, but it cannot authenticate.
  ADD COLUMN status           text NOT NULL DEFAULT 'invited'
                              CHECK (status IN ('invited','active','suspended')),
  -- AES-256-GCM ciphertext, keyed from STRUST_SECRET_KEY. A TOTP secret in plaintext means
  -- a database leak defeats the second factor entirely, which would make enrolling in it
  -- close to pointless.
  ADD COLUMN mfa_secret_enc   text,
  ADD COLUMN mfa_enrolled_at  timestamptz,
  ADD COLUMN failed_logins    int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until     timestamptz,
  ADD COLUMN last_login_at    timestamptz;

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- An active user must be able to authenticate; a credential-less active user would be a
-- silently unreachable account.
ALTER TABLE users ADD CONSTRAINT active_user_has_password
  CHECK (status <> 'active' OR password_hash IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The tenant this session is currently acting in. Null between login and tenant
  -- selection for a user who belongs to more than one.
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  -- False until the second factor is presented. A session in this state may do nothing
  -- except complete or abandon the MFA step.
  mfa_satisfied  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- Two clocks: idle (164.312(a)(2)(iii) automatic logoff) and absolute (a forgotten
  -- session on a shared machine should not live forever just because it is poked daily).
  idle_expires_at timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  ip             text,
  user_agent     text,
  revoked_at     timestamptz,
  revoked_reason text
);

CREATE INDEX sessions_user_idx ON sessions(user_id, created_at DESC);
CREATE INDEX sessions_live_idx ON sessions(expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- MFA recovery codes
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz,
  UNIQUE (user_id, code_hash)
);

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
-- Also the password-reset path: SMTP is not wired, so an admin issues a link rather than
-- the user requesting one by email. Stated plainly rather than left looking complete.

CREATE TABLE invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            text NOT NULL CHECK (role IN ('owner','admin','contributor','auditor','viewer')),
  kind            text NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite','password_reset')),
  token_hash      text NOT NULL UNIQUE,
  invited_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  accepted_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at      timestamptz
);

CREATE INDEX invitations_tenant_idx ON invitations(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Authentication event log (global, append-only)
-- ---------------------------------------------------------------------------
--
-- Separate from audit_events because a failed login for an unknown address belongs to no
-- tenant, and audit_events.tenant_id is NOT NULL and hash-chained per tenant. Forcing
-- auth-plane events into that table would either break the chain or drop the events that
-- matter most — 164.308(a)(5)(ii)(C) log-in monitoring is precisely about failed attempts.

CREATE TABLE auth_events (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  event      text NOT NULL,
  email      text,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  tenant_id  uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ip         text,
  user_agent text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX auth_events_at_idx ON auth_events(at DESC);
CREATE INDEX auth_events_email_idx ON auth_events(lower(email), at DESC);

CREATE TRIGGER auth_events_no_update BEFORE UPDATE ON auth_events
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER auth_events_no_delete BEFORE DELETE ON auth_events
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER recovery_codes_no_delete BEFORE DELETE ON recovery_codes
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

-- ---------------------------------------------------------------------------
-- Read-only application role
-- ---------------------------------------------------------------------------
--
-- The `auditor` and `viewer` roles connect as this. The RLS policies from 005 are not
-- role-qualified, so they apply here unchanged — this role adds the second constraint that
-- no statement can write, whatever the application code believes it is doing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strust_app_ro') THEN
    CREATE ROLE strust_app_ro NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO strust_app_ro;
GRANT SELECT ON frameworks, framework_sections, requirements,
                control_templates, control_template_requirement_map TO strust_app_ro;

-- ---------------------------------------------------------------------------
-- The identity plane is exempt from FORCE
-- ---------------------------------------------------------------------------
--
-- 005 put FORCE ROW LEVEL SECURITY on every table including these three. FORCE is what
-- makes RLS apply to the TABLE OWNER as well, and the owner connection is exactly what the
-- auth layer uses: a login has to find a user by email, and list that user's memberships
-- ACROSS tenants, before any tenant is known. Under FORCE those queries return zero rows
-- and every login fails — and it fails silently, as "wrong password", which is a miserable
-- thing to debug.
--
-- It happens to work in the local container only because POSTGRES_USER is a superuser and
-- superusers bypass RLS regardless. Relying on that would mean the app breaks the first time
-- it is deployed against a properly de-privileged owner role.
--
-- ENABLE stays on all three, so `strust_app` and `strust_app_ro` remain fully constrained by
-- the policies from 005. Only the owner regains access, and only to the identity tables.
ALTER TABLE users          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenants        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_members NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_members','tenant_frameworks','tenant_framework_scope','controls',
    'control_requirement_map','evidence','monitors','monitor_runs','policies',
    'policy_versions','policy_acknowledgements','risks','risk_control_map','vendors',
    'personnel','assets','processing_activities','dsar_requests','audits','audit_events',
    'tenants','users'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('GRANT SELECT ON %I TO strust_app_ro', t);
  END LOOP;
END
$$;

COMMIT;
