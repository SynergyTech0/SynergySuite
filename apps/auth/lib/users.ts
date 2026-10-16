import bcrypt from 'bcryptjs';
import { q, now } from './db';
import { isDemoUser } from './config';

export type User = {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  role: string;
  disabled: string | number;
  mfa_enabled: string | number;
  mfa_secret: string | null;
  mfa_pending_secret: string | null;
  backup_codes: string[] | null;
  mfa_required: string | number;
  failed_logins: string | number;
  locked_until_ms: string | number;
  created_ms: string | number;
};

export const b = (v: string | number | null | undefined) => Number(v ?? 0) !== 0;

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/* Password policy: 12+ chars, at least one letter and one digit (NIST-ish, no forced symbols). */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain a letter and a digit';
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function findByEmail(email: string): Promise<User | null> {
  const rows = await q<User>(`SELECT * FROM sa_users WHERE email = $1::text`, [email.toLowerCase().trim()]);
  return rows[0] ?? null;
}

export async function findById(id: string | number): Promise<User | null> {
  const rows = await q<User>(`SELECT * FROM sa_users WHERE id + 0 = $1::bigint`, [id]);
  return rows[0] ?? null;
}

export async function createUser(p: { email: string; name?: string; password: string; role?: string; mfaRequired?: boolean }): Promise<User> {
  const hash = await hashPassword(p.password);
  const rows = await q<User>(
    `INSERT INTO sa_users (email, name, password_hash, role, mfa_required, created_ms, updated_ms)
     VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $6::bigint)
     RETURNING *`,
    [p.email.toLowerCase().trim(), p.name ?? null, hash, p.role ?? 'user', p.mfaRequired ? 1 : 0, now()],
  );
  return rows[0];
}

export type LoginResult = { ok: boolean; user?: User; reason?: 'invalid' | 'locked' | 'disabled' };

export async function checkLogin(email: string, password: string): Promise<LoginResult> {
  const user = await findByEmail(email);
  if (!user || !user.password_hash) return { ok: false, reason: 'invalid' };
  if (b(user.disabled)) return { ok: false, reason: 'disabled' };
  if (Number(user.locked_until_ms) > Date.now()) return { ok: false, reason: 'locked' };

  const good = await bcrypt.compare(password, user.password_hash);
  if (!good) {
    const fails = Number(user.failed_logins) + 1;
    // The demo login's password is public: locking it out would only lock out every visitor.
    const lock = fails >= MAX_FAILURES && !isDemoUser(user.email) ? Date.now() + LOCKOUT_MS : 0;
    await q(
      `UPDATE sa_users SET failed_logins = $2::bigint, locked_until_ms = $3::bigint WHERE id + 0 = $1::bigint`,
      [user.id, fails, lock],
    );
    return { ok: false, reason: lock ? 'locked' : 'invalid' };
  }
  if (Number(user.failed_logins) > 0) {
    await q(`UPDATE sa_users SET failed_logins = 0::bigint, locked_until_ms = 0::bigint WHERE id + 0 = $1::bigint`, [user.id]);
  }
  return { ok: true, user };
}

export async function setPassword(userId: string | number, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await q(`UPDATE sa_users SET password_hash = $2::text, updated_ms = $3::bigint WHERE id + 0 = $1::bigint`, [
    userId, hash, now(),
  ]);
}
