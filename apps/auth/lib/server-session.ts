import { cookies } from 'next/headers';
import { SESSION_COOKIE, getSession, type Session } from './session';
import { findById, b, type User } from './users';

/* Session helpers for server components (cookies() is async in Next 15). */

export async function pageUser(): Promise<{ user: User; session: Session } | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value ?? null;
  const s = await getSession(sid);
  if (!s || Number(s.mfa_ok) !== 1) return null;
  const user = await findById(s.user_id);
  if (!user || b(user.disabled)) return null;
  return { user, session: s };
}

export async function pagePendingMfa(): Promise<User | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value ?? null;
  const s = await getSession(sid);
  if (!s || Number(s.mfa_ok) !== 0) return null;
  return findById(s.user_id);
}
