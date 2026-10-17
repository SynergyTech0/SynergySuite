import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { q, now } from './db';
import { signJwt, issuer } from './keys';
import { findById, b, type User } from './users';

export const ACCESS_TTL_S = 15 * 60;
export const CODE_TTL_MS = 120 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SUPPORTED_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export type Client = {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  name: string;
  redirect_uris: string[] | null;
  post_logout_uris: string[] | null;
  grant_types: string[] | null;
  scopes: string[] | null;
  first_party: string | number;
  public_client: string | number;
  disabled: string | number;
};

export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export async function findClient(clientId: string): Promise<Client | null> {
  const rows = await q<Client>(`SELECT * FROM sa_clients WHERE client_id = $1::text`, [clientId]);
  const c = rows[0];
  if (!c || b(c.disabled)) return null;
  return c;
}

export async function createClient(p: {
  name: string;
  redirectUris: string[];
  postLogoutUris?: string[];
  grantTypes?: string[];
  scopes?: string[];
  firstParty?: boolean;
  publicClient?: boolean;
}): Promise<{ client: Client; clientSecret: string | null }> {
  const clientId = 'sa_' + randomBytes(12).toString('hex');
  const secret = p.publicClient ? null : randomBytes(32).toString('hex');
  const secretHash = secret ? await bcrypt.hash(secret, 10) : null;
  const rows = await q<Client>(
    `INSERT INTO sa_clients (client_id, client_secret_hash, name, redirect_uris, post_logout_uris, grant_types, scopes, first_party, public_client, created_ms)
     VALUES ($1::text, $2::text, $3::text, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::bigint, $9::bigint, $10::bigint)
     RETURNING *`,
    [
      clientId, secretHash, p.name,
      JSON.stringify(p.redirectUris),
      JSON.stringify(p.postLogoutUris ?? []),
      JSON.stringify(p.grantTypes ?? ['authorization_code', 'refresh_token']),
      JSON.stringify(p.scopes ?? SUPPORTED_SCOPES),
      p.firstParty ? 1 : 0,
      p.publicClient ? 1 : 0,
      now(),
    ],
  );
  return { client: rows[0], clientSecret: secret };
}

export async function verifyClientSecret(client: Client, secret: string): Promise<boolean> {
  if (!client.client_secret_hash) return false;
  return bcrypt.compare(secret, client.client_secret_hash);
}

/** Parse client auth from Basic header or body params (client_secret_post). */
export async function authenticateClient(req: Request, body: URLSearchParams): Promise<Client | null> {
  let clientId = body.get('client_id') ?? '';
  let secret = body.get('client_secret') ?? '';
  const basic = req.headers.get('authorization');
  if (basic?.startsWith('Basic ')) {
    const [u, p] = Buffer.from(basic.slice(6), 'base64').toString().split(':');
    clientId = decodeURIComponent(u ?? '');
    secret = decodeURIComponent(p ?? '');
  }
  if (!clientId) return null;
  const client = await findClient(clientId);
  if (!client) return null;
  if (b(client.public_client)) return client; // public clients auth via PKCE
  if (!secret || !(await verifyClientSecret(client, secret))) return null;
  return client;
}

/* ---- authorization codes ---- */

export async function issueCode(p: {
  clientId: string; userId: string | number; redirectUri: string; scope: string;
  nonce: string | null; codeChallenge: string | null; challengeMethod: string | null; sessionSid: string;
}): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO sa_auth_codes (code_hash, client_id, user_id, redirect_uri, scope, nonce, code_challenge, challenge_method, session_sid, expires_ms)
     VALUES ($1::text, $2::text, $3::bigint, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::bigint)`,
    [sha256hex(code), p.clientId, p.userId, p.redirectUri, p.scope, p.nonce, p.codeChallenge, p.challengeMethod, p.sessionSid, now() + CODE_TTL_MS],
  );
  return code;
}

export type CodeRow = {
  code_hash: string; client_id: string; user_id: string; redirect_uri: string; scope: string;
  nonce: string | null; code_challenge: string | null; challenge_method: string | null;
  session_sid: string; expires_ms: string | number; used: string | number;
};

export async function consumeCode(code: string): Promise<CodeRow | null> {
  const rows = await q<CodeRow>(`SELECT * FROM sa_auth_codes WHERE code_hash = $1::text`, [sha256hex(code)]);
  const c = rows[0];
  if (!c || Number(c.used) !== 0 || Number(c.expires_ms) < Date.now()) return null;
  await q(`UPDATE sa_auth_codes SET used = 1::bigint WHERE code_hash = $1::text`, [c.code_hash]);
  return c;
}

export function verifyPkce(row: CodeRow, verifier: string | null): boolean {
  if (!row.code_challenge) return true; // challenge not required (confidential client)
  if (!verifier) return false;
  const expected = row.code_challenge;
  const actual = row.challenge_method === 'plain'
    ? verifier
    : createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(actual);
  const e = Buffer.from(expected);
  return a.length === e.length && timingSafeEqual(a, e);
}

/* ---- refresh tokens (rotating, Auth0-style family reuse detection) ---- */

export async function issueRefreshToken(p: {
  userId: string | number; clientId: string; scope: string; sessionSid: string | null; familyId?: string;
}): Promise<string> {
  const token = 'sart_' + randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO sa_refresh_tokens (token_hash, family_id, user_id, client_id, scope, session_sid, expires_ms, created_ms)
     VALUES ($1::text, $2::text, $3::bigint, $4::text, $5::text, $6::text, $7::bigint, $8::bigint)`,
    [sha256hex(token), p.familyId ?? randomBytes(16).toString('hex'), p.userId, p.clientId, p.scope, p.sessionSid, now() + REFRESH_TTL_MS, now()],
  );
  return token;
}

export type RefreshRow = {
  token_hash: string; family_id: string; user_id: string; client_id: string; scope: string;
  session_sid: string | null; expires_ms: string | number; revoked: string | number; rotated: string | number;
};

export async function revokeFamily(familyId: string): Promise<void> {
  await q(`UPDATE sa_refresh_tokens SET revoked = 1::bigint WHERE family_id = $1::text`, [familyId]);
}

export type RotateResult = { ok: boolean; newToken?: string; row?: RefreshRow; error?: 'invalid' | 'reused' };

export async function rotateRefreshToken(token: string, clientId: string): Promise<RotateResult> {
  const rows = await q<RefreshRow>(`SELECT * FROM sa_refresh_tokens WHERE token_hash = $1::text`, [sha256hex(token)]);
  const r = rows[0];
  if (!r || r.client_id !== clientId || Number(r.expires_ms) < Date.now()) return { ok: false, error: 'invalid' };
  if (Number(r.revoked) !== 0) return { ok: false, error: 'invalid' };
  if (Number(r.rotated) !== 0) {
    // Reuse of a rotated token => the family is compromised. Kill it all.
    await revokeFamily(r.family_id);
    return { ok: false, error: 'reused' };
  }
  await q(`UPDATE sa_refresh_tokens SET rotated = 1::bigint WHERE token_hash = $1::text`, [r.token_hash]);
  const newToken = await issueRefreshToken({
    userId: r.user_id, clientId: r.client_id, scope: r.scope, sessionSid: r.session_sid, familyId: r.family_id,
  });
  return { ok: true, newToken, row: r };
}

export async function findRefreshToken(token: string): Promise<RefreshRow | null> {
  const rows = await q<RefreshRow>(`SELECT * FROM sa_refresh_tokens WHERE token_hash = $1::text`, [sha256hex(token)]);
  return rows[0] ?? null;
}

/* ---- token minting ---- */

export function userClaims(user: User, scope: string): Record<string, unknown> {
  const scopes = scope.split(' ');
  const claims: Record<string, unknown> = { sub: String(user.id) };
  if (scopes.includes('email')) {
    claims.email = user.email;
    claims.email_verified = true;
  }
  if (scopes.includes('profile')) {
    claims.name = user.name ?? user.email;
    // The gateway passes only preferred_username on to the apps, so it carries the display name.
    claims.preferred_username = user.name ?? user.email;
    claims.role = user.role;
  }
  return claims;
}

export async function mintTokens(p: {
  user: User | null; client: Client; scope: string; nonce?: string | null; sessionSid?: string | null;
  includeRefresh: boolean;
}) {
  const scopes = p.scope.split(' ');
  const subject = p.user ? String(p.user.id) : p.client.client_id;
  const access_token = await signJwt(
    {
      sub: subject,
      scope: p.scope,
      client_id: p.client.client_id,
      ...(p.user ? { email: p.user.email, role: p.user.role } : { gty: 'client_credentials' }),
    },
    `${issuer()}/api`, // audience: the resource API surface
    ACCESS_TTL_S,
  );
  const out: Record<string, unknown> = {
    access_token,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    scope: p.scope,
  };
  if (p.user && scopes.includes('openid')) {
    out.id_token = await signJwt(
      { ...userClaims(p.user, p.scope), ...(p.nonce ? { nonce: p.nonce } : {}), ...(p.sessionSid ? { sid: p.sessionSid } : {}) },
      p.client.client_id,
      ACCESS_TTL_S,
    );
  }
  if (p.user && p.includeRefresh) {
    out.refresh_token = await issueRefreshToken({
      userId: p.user.id, clientId: p.client.client_id, scope: p.scope, sessionSid: p.sessionSid ?? null,
    });
  }
  return out;
}

/* ---- consent grants ---- */

export async function hasGrant(userId: string | number, clientId: string, scope: string): Promise<boolean> {
  const rows = await q<{ scope: string }>(
    `SELECT scope FROM sa_grants WHERE user_id = $1::bigint AND client_id = $2::text`,
    [userId, clientId],
  );
  const wanted = new Set(scope.split(' '));
  for (const r of rows) for (const s of r.scope.split(' ')) wanted.delete(s);
  return wanted.size === 0;
}

export async function saveGrant(userId: string | number, clientId: string, scope: string): Promise<void> {
  await q(
    `INSERT INTO sa_grants (user_id, client_id, scope, created_ms) VALUES ($1::bigint, $2::text, $3::text, $4::bigint)`,
    [userId, clientId, scope, now()],
  );
}

export async function userForRow(userId: string | number): Promise<User | null> {
  return findById(userId);
}
