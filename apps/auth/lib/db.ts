import { Pool, type QueryResultRow } from 'pg';
import SUITE_APPS from './suite-apps.json';

/*
 * SynergyDB (Postgres-wire) data layer. Same quirk workarounds as SynergyMail:
 *   - BIGINT everywhere (never INT), epoch-ms BIGINT instead of TIMESTAMPTZ,
 *   - JSONB instead of native arrays, no SELECT DISTINCT / GROUP BY aggregates,
 *   - cast every param in SQL ($n::bigint / ::jsonb / ::text) EXCEPT LIMIT $n (bare).
 */

declare global {
  // eslint-disable-next-line no-var
  var __saPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __saSchema: Promise<void> | undefined;
}

export function pool(): Pool {
  if (!global.__saPool) {
    global.__saPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb',
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return global.__saPool;
}

/*
 * SynergyDB bugs (found 2026-07-04, on the :5499 build) that this layer works
 * around — both are engine defects, not app mistakes:
 *
 * 1. INTEGER PARAMETER CORRUPTION ON WRITE. A bigint passed as a bind param is,
 *    for many values, stored as the integer formed from the ASCII bytes of its
 *    decimal string (10 -> 0x3130 = 12592, 16 -> 12598, 1000 -> 825241648).
 *    Value-dependent (3, 100, 255, timestamps survive; 10, 16, 1000 don't) and
 *    100% reproducible per value. Inline integer LITERALS always store correctly.
 * 2. BIGINT PK INDEX PUSHDOWN MISSES on parameterized point/range lookups for
 *    multi-digit values (WHERE id = $1 finds nothing); literals work.
 *
 * Fix for both: `q()` rewrites the SQL to inline every integer parameter as a
 * literal before it reaches the wire. Text/jsonb params stay as real binds
 * (so no injection surface — only values already typed integer are inlined).
 * That makes writes store the right value AND makes PK lookups hit the index.
 * The remaining "id + 0 = $n" shapes were the earlier partial workaround and
 * are harmless (still correct once the value is inlined).
 */
function inlineIntParams(text: string, params: unknown[]): { text: string; params: unknown[] } {
  const isIntBound = (i: number): boolean => {
    const v = params[i];
    if (typeof v === 'number') return Number.isInteger(v);
    if (typeof v === 'bigint') return true;
    // digit-string ONLY when the placeholder is cast to an integer type in SQL
    if (typeof v === 'string' && /^-?\d+$/.test(v)) {
      return new RegExp(`\\$${i + 1}::(?:big)?int(?:eger)?\\b`).test(text)
        || new RegExp(`\\$${i + 1}::smallint\\b`).test(text);
    }
    return false;
  };
  // Assign new bind numbers to the params we keep (in original order).
  const remap = new Map<number, number>();
  const kept: unknown[] = [];
  for (let i = 0; i < params.length; i++) {
    if (!isIntBound(i)) { kept.push(params[i]); remap.set(i, kept.length); }
  }
  // Single pass keyed on the ORIGINAL index, so a rewritten token can never be
  // re-matched by a later replacement (that collision truncates values).
  const out = text.replace(/\$(\d+)/g, (_m, n) => {
    const i = Number(n) - 1;
    if (i < 0 || i >= params.length) return _m;
    return isIntBound(i) ? String(params[i]) : `$${remap.get(i)}`;
  });
  return { text: out, params: kept };
}

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const rewritten = inlineIntParams(text, params);
  const r = await pool().query<T>(rewritten.text, rewritten.params as never[]);
  return r.rows;
}

async function raw(text: string): Promise<void> {
  await pool().query(text);
}

export const now = () => Date.now();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sa_users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT,
  password_hash  TEXT,
  role           TEXT,            -- admin | user
  disabled       BIGINT DEFAULT 0,
  mfa_enabled    BIGINT DEFAULT 0,
  mfa_secret     TEXT,
  mfa_pending_secret TEXT,
  backup_codes   JSONB,           -- list of sha256 hex hashes, null = none
  mfa_required   BIGINT DEFAULT 0,-- admin-forced enrollment
  failed_logins  BIGINT DEFAULT 0,
  locked_until_ms BIGINT DEFAULT 0,
  created_ms     BIGINT,
  updated_ms     BIGINT
);
CREATE INDEX IF NOT EXISTS sa_users_email_idx ON sa_users(email);

CREATE TABLE IF NOT EXISTS sa_clients (
  id                 BIGSERIAL PRIMARY KEY,
  client_id          TEXT NOT NULL,
  client_secret_hash TEXT,          -- null for public clients
  name               TEXT,
  redirect_uris      JSONB,         -- list of exact-match URIs
  post_logout_uris   JSONB,
  grant_types        JSONB,         -- ["authorization_code","refresh_token","client_credentials"]
  scopes             JSONB,         -- allowed scopes
  first_party        BIGINT DEFAULT 0, -- skip consent
  public_client      BIGINT DEFAULT 0, -- PKCE required, no secret
  disabled           BIGINT DEFAULT 0,
  created_ms         BIGINT
);
CREATE INDEX IF NOT EXISTS sa_clients_cid_idx ON sa_clients(client_id);

CREATE TABLE IF NOT EXISTS sa_sessions (
  sid         TEXT PRIMARY KEY,     -- random 64 hex
  user_id     BIGINT,
  mfa_ok      BIGINT DEFAULT 0,     -- password ok but TOTP still pending when 0
  created_ms  BIGINT,
  expires_ms  BIGINT,
  ip          TEXT,
  user_agent  TEXT,
  revoked     BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sa_sessions_user_idx ON sa_sessions(user_id);

CREATE TABLE IF NOT EXISTS sa_auth_codes (
  code_hash    TEXT PRIMARY KEY,    -- sha256 of the code
  client_id    TEXT,
  user_id      BIGINT,
  redirect_uri TEXT,
  scope        TEXT,
  nonce        TEXT,
  code_challenge TEXT,
  challenge_method TEXT,
  session_sid  TEXT,
  expires_ms   BIGINT,
  used         BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sa_refresh_tokens (
  token_hash  TEXT PRIMARY KEY,     -- sha256 of the token
  family_id   TEXT,                 -- rotation family (reuse => revoke family)
  user_id     BIGINT,
  client_id   TEXT,
  scope       TEXT,
  session_sid TEXT,
  expires_ms  BIGINT,
  revoked     BIGINT DEFAULT 0,
  rotated     BIGINT DEFAULT 0,     -- superseded by a newer token in the family
  created_ms  BIGINT
);
CREATE INDEX IF NOT EXISTS sa_refresh_family_idx ON sa_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS sa_refresh_user_idx ON sa_refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS sa_grants (
  id         BIGSERIAL PRIMARY KEY, -- remembered third-party consent
  user_id    BIGINT,
  client_id  TEXT,
  scope      TEXT,
  created_ms BIGINT
);
CREATE INDEX IF NOT EXISTS sa_grants_user_idx ON sa_grants(user_id);

CREATE TABLE IF NOT EXISTS sa_keys (
  kid         TEXT PRIMARY KEY,
  private_pem TEXT,
  public_jwk  JSONB,
  active      BIGINT DEFAULT 1,
  created_ms  BIGINT
);

CREATE TABLE IF NOT EXISTS sa_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT,
  expires_ms BIGINT,
  used       BIGINT DEFAULT 0,
  created_ms BIGINT
);

CREATE TABLE IF NOT EXISTS sa_passkeys (
  cred_id    TEXT PRIMARY KEY,   -- base64url credential id
  user_id    BIGINT,
  public_key TEXT,               -- base64 COSE public key
  counter    BIGINT DEFAULT 0,
  transports JSONB,
  name       TEXT,
  created_ms BIGINT
);
CREATE INDEX IF NOT EXISTS sa_passkeys_user_idx ON sa_passkeys(user_id);

CREATE TABLE IF NOT EXISTS sa_challenges (
  ckey       TEXT PRIMARY KEY,   -- session sid or random handle
  challenge  TEXT,
  kind       TEXT,               -- webauthn_register or webauthn_login
  user_id    BIGINT,
  expires_ms BIGINT
);

CREATE TABLE IF NOT EXISTS sa_api_tokens (
  token_hash TEXT PRIMARY KEY,   -- sha256 of bearer token (SCIM etc)
  name       TEXT,
  revoked    BIGINT DEFAULT 0,
  created_ms BIGINT
);

CREATE TABLE IF NOT EXISTS sa_saml_sps (
  id         BIGSERIAL PRIMARY KEY,
  entity_id  TEXT,
  acs_url    TEXT,
  slo_url    TEXT,               -- SP SingleLogoutService (optional)
  name       TEXT,
  created_ms BIGINT
);

CREATE TABLE IF NOT EXISTS sa_saml_cert (
  id         BIGINT PRIMARY KEY, -- always 1 (single self-signed cert)
  key_pem    TEXT,
  cert_pem   TEXT,
  created_ms BIGINT
);

CREATE TABLE IF NOT EXISTS sa_app_passwords (
  id            BIGSERIAL PRIMARY KEY, -- per-device passwords for CalDAV/CardDAV (lib/app-passwords.ts)
  user_id       BIGINT,
  name          TEXT,
  token_hash    TEXT,                  -- sha256 of the normalized password
  created_ms    BIGINT,
  last_used_ms  BIGINT DEFAULT 0,
  last_used_app TEXT,
  revoked       BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sa_app_passwords_user_idx ON sa_app_passwords(user_id);

CREATE TABLE IF NOT EXISTS sa_audit (
  id         BIGSERIAL PRIMARY KEY,
  at_ms      BIGINT,
  actor      TEXT,     -- email or client_id or "system"
  event      TEXT,     -- login.success login.fail login.locked mfa.enroll ...
  detail     JSONB,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS sa_audit_at_idx ON sa_audit(at_ms);

CREATE TABLE IF NOT EXISTS sa_settings (
  key        TEXT PRIMARY KEY, -- device_compliance, ai_model
  value      JSONB,
  updated_ms BIGINT
);

CREATE TABLE IF NOT EXISTS sa_apps (
  id          BIGSERIAL PRIMARY KEY, -- Hub launcher tiles (lib/apps.ts)
  slug        TEXT NOT NULL,
  name        TEXT,
  description TEXT,
  url         TEXT,
  icon        TEXT,
  color       TEXT,
  category    TEXT,
  sort        BIGINT DEFAULT 100,
  open_to_all BIGINT DEFAULT 1,  -- 0 = only people with an sa_user_apps grant
  disabled    BIGINT DEFAULT 0,
  suite       BIGINT DEFAULT 0,  -- 1 = a suite app, kept in step with lib/suite-apps.json
  created_ms  BIGINT
);
CREATE INDEX IF NOT EXISTS sa_apps_slug_idx ON sa_apps(slug);

CREATE TABLE IF NOT EXISTS sa_user_apps (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  app_id     BIGINT,
  created_ms BIGINT
);
CREATE INDEX IF NOT EXISTS sa_user_apps_user_idx ON sa_user_apps(user_id);
`;

export function ensureSchema(): Promise<void> {
  if (!global.__saSchema) {
    global.__saSchema = (async () => {
      for (const stmt of SCHEMA.split(';')) {
        const s = stmt.trim();
        if (s) await raw(s);
      }
      // Tolerant migrations for tables that predate a column (SynergyDB has no
      // ADD COLUMN IF NOT EXISTS, so ignore the "already exists" on re-run).
      for (const m of MIGRATIONS) {
        try { await raw(m); } catch { /* column already present */ }
      }
      await seedSuiteApps();
    })().catch((e) => {
      global.__saSchema = undefined; // don't cache a failed init
      throw e;
    });
  }
  return global.__saSchema;
}

const MIGRATIONS = [
  `ALTER TABLE sa_saml_sps ADD COLUMN slo_url TEXT`,
  // sa_apps copied from an older Hub has no suite column.
  `ALTER TABLE sa_apps ADD COLUMN suite BIGINT DEFAULT 0`,
];

/** Where a suite app lives: its subdomain behind Caddy, or its own port without a domain. */
export function suiteAppUrl(app: { id: string; port: number }, domain = process.env.SUITE_DOMAIN): string {
  return domain ? `https://${app.id}.${domain}` : `http://localhost:${app.port}`;
}

/*
 * Every suite app gets a Hub tile. Tiles are added once and their address is
 * refreshed on each start, so a changed SUITE_DOMAIN follows; name, order and
 * who can see it stay whatever an admin set. Linked (non-suite) apps are left alone.
 */
async function seedSuiteApps(): Promise<void> {
  const existing = await pool().query<{ id: string; slug: string }>(`SELECT id, slug FROM sa_apps`);
  const bySlug = new Map(existing.rows.map((r) => [r.slug, r.id]));
  let sort = 10;
  for (const app of SUITE_APPS) {
    const url = suiteAppUrl(app);
    const id = bySlug.get(app.id);
    if (id) {
      await pool().query(`UPDATE sa_apps SET url = $1::text, suite = 1::bigint WHERE id = $2::bigint`, [url, id]);
    } else {
      await pool().query(
        `INSERT INTO sa_apps (slug, name, url, category, sort, open_to_all, disabled, suite, created_ms)
         VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint, 1::bigint, 0::bigint, 1::bigint, $6::bigint)`,
        [app.id, app.name, url, app.category, sort, now()],
      );
    }
    sort += 10;
  }
}
