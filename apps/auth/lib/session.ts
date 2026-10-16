import { randomBytes } from 'crypto';
import { q, now } from './db';
import { findById, b, type User } from './users';

export const SESSION_COOKIE = 'sa_sess';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30-day SSO session (Keycloak-style)

export type Session = {
  sid: string;
  user_id: string;
  mfa_ok: string | number;
  created_ms: string | number;
  expires_ms: string | number;
  ip: string | null;
  user_agent: string | null;
  revoked: string | number;
};

export async function createSession(userId: string | number, mfaOk: boolean, req?: Request): Promise<string> {
  const sid = randomBytes(32).toString('hex');
  const ip = req?.headers.get('x-forwarded-for') ?? '';
  const ua = req?.headers.get('user-agent') ?? '';
  await q(
    `INSERT INTO sa_sessions (sid, user_id, mfa_ok, created_ms, expires_ms, ip, user_agent)
     VALUES ($1::text, $2::bigint, $3::bigint, $4::bigint, $5::bigint, $6::text, $7::text)`,
    [sid, userId, mfaOk ? 1 : 0, now(), now() + SESSION_TTL_MS, ip, ua.slice(0, 300)],
  );
  return sid;
}

export function cookieFor(sid: string): string {
  return `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function sidFromRequest(req: Request): string | null {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

export async function getSession(sid: string | null): Promise<Session | null> {
  if (!sid) return null;
  const rows = await q<Session>(`SELECT * FROM sa_sessions WHERE sid = $1::text`, [sid]);
  const s = rows[0];
  if (!s || Number(s.revoked) !== 0 || Number(s.expires_ms) < Date.now()) return null;
  return s;
}

/** Fully authenticated user for a request (session exists AND MFA satisfied). */
export async function currentUser(req: Request): Promise<{ user: User; session: Session } | null> {
  const s = await getSession(sidFromRequest(req));
  if (!s || Number(s.mfa_ok) !== 1) return null;
  const user = await findById(s.user_id);
  if (!user || b(user.disabled)) return null;
  return { user, session: s };
}

/** Session where the password step passed but TOTP is still pending. */
export async function pendingMfaSession(req: Request): Promise<{ user: User; session: Session } | null> {
  const s = await getSession(sidFromRequest(req));
  if (!s || Number(s.mfa_ok) !== 0) return null;
  const user = await findById(s.user_id);
  if (!user || b(user.disabled)) return null;
  return { user, session: s };
}

export async function markMfaOk(sid: string): Promise<void> {
  await q(`UPDATE sa_sessions SET mfa_ok = 1::bigint WHERE sid = $1::text`, [sid]);
}

export async function revokeSession(sid: string): Promise<void> {
  await q(`UPDATE sa_sessions SET revoked = 1::bigint WHERE sid = $1::text`, [sid]);
}

export async function listSessions(userId: string | number): Promise<Session[]> {
  const rows = await q<Session>(
    `SELECT * FROM sa_sessions WHERE user_id = $1::bigint AND revoked = 0::bigint ORDER BY created_ms DESC LIMIT $2`,
    [userId, 50],
  );
  return rows.filter((s) => Number(s.expires_ms) > Date.now());
}
