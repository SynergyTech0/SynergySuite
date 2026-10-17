import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { q, now } from './db';
import { findByEmail, b } from './users';
import { audit } from './audit';

/*
 * App passwords: for phone and desktop apps that sync calendars and contacts (CalDAV, CardDAV)
 * and can't do the suite's browser sign-in. Each is 16 random characters (about 79 bits), shown
 * once, stored only as a SHA-256 hash (random secrets this long don't need a slow hash), named
 * by the person and revocable one by one. Calendar and Contacts check them here over the
 * internal network (POST /api/internal/app-passwords/verify with PROXY_SHARED_SECRET).
 *
 * Wrong guesses lock that person's app passwords for 15 minutes after 10 failures, and an
 * address that fails 30 times in 15 minutes is refused for 15 minutes. Web sign-in has its own
 * lockout and isn't affected. App passwords skip two-step verification by design: that is
 * why they are random, separate from the account password, and can be revoked.
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 16;
const MAX_PER_USER = 25;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_USER_FAILURES = 10;
const MAX_IP_FAILURES = 30;

export type AppPassword = { id: string; name: string; created_ms: number; last_used_ms: number; last_used_app: string | null };

export function generate(): string {
  let s = '';
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s.match(/.{4}/g)!.join('-');
}

/** Spaces, dashes and case don't matter when typing one in. */
export const normalize = (pw: string) => pw.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashOf = (pw: string) => createHash('sha256').update(normalize(pw)).digest('hex');

export async function list(userId: string | number): Promise<AppPassword[]> {
  const rows = await q<{ id: string; name: string; created_ms: string; last_used_ms: string | null; last_used_app: string | null }>(
    `SELECT id, name, created_ms, last_used_ms, last_used_app FROM sa_app_passwords
      WHERE user_id + 0 = $1::bigint AND revoked = 0::bigint ORDER BY created_ms DESC LIMIT $2`,
    [userId, MAX_PER_USER + 5],
  );
  return rows.map((r) => ({
    id: String(r.id), name: r.name, created_ms: Number(r.created_ms), last_used_ms: Number(r.last_used_ms ?? 0), last_used_app: r.last_used_app,
  }));
}

export async function create(userId: string | number, name: string): Promise<{ id: string; password: string }> {
  if ((await list(userId)).length >= MAX_PER_USER) throw new Error(`You can have up to ${MAX_PER_USER} app passwords; revoke one first`);
  const password = generate();
  const rows = await q<{ id: string }>(
    `INSERT INTO sa_app_passwords (user_id, name, token_hash, created_ms, last_used_ms, revoked)
     VALUES ($1::bigint, $2::text, $3::text, $4::bigint, 0::bigint, 0::bigint) RETURNING id`,
    [userId, name, hashOf(password), now()],
  );
  return { id: String(rows[0].id), password };
}

export async function revoke(userId: string | number, id: string): Promise<boolean> {
  if (!/^\d+$/.test(id)) return false;
  const rows = await q<{ id: string }>(
    `UPDATE sa_app_passwords SET revoked = 1::bigint WHERE id + 0 = $1::bigint AND user_id + 0 = $2::bigint AND revoked = 0::bigint RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Revokes every app password of a person (on password reset). */
export async function revokeAll(userId: string | number): Promise<void> {
  await q(`UPDATE sa_app_passwords SET revoked = 1::bigint WHERE user_id + 0 = $1::bigint`, [userId]);
}

// ---- checking ----

type Window = { n: number; first: number; lockedUntil: number };
const byUser = new Map<string, Window>();
const byIp = new Map<string, Window>();

function locked(map: Map<string, Window>, key: string): boolean {
  const w = map.get(key);
  return Boolean(w && w.lockedUntil > Date.now());
}

function failure(map: Map<string, Window>, key: string, max: number): boolean {
  const t = Date.now();
  if (map.size > 10000) for (const [k, v] of map) if (t - v.first > WINDOW_MS && v.lockedUntil < t) map.delete(k);
  let w = map.get(key);
  if (!w || (t - w.first > WINDOW_MS && w.lockedUntil < t)) {
    w = { n: 0, first: t, lockedUntil: 0 };
    map.set(key, w);
  }
  w.n++;
  if (w.n >= max && w.lockedUntil < t) {
    w.lockedUntil = t + WINDOW_MS;
    return true;
  }
  return false;
}

export type VerifyResult = { ok: boolean; email?: string; reason?: 'invalid' | 'locked' };

export async function verify(emailIn: string, password: string, app: string, ip: string): Promise<VerifyResult> {
  const email = emailIn.toLowerCase().trim();
  if (locked(byIp, ip) || locked(byUser, email)) return { ok: false, reason: 'locked' };
  const pw = normalize(password);
  const user = pw.length === LENGTH ? await findByEmail(email) : null;
  let match = false;
  let id: string | null = null;
  if (user && !b(user.disabled)) {
    const want = Buffer.from(hashOf(pw), 'hex');
    const rows = await q<{ id: string; token_hash: string; last_used_ms: string | null }>(
      `SELECT id, token_hash, last_used_ms FROM sa_app_passwords WHERE user_id + 0 = $1::bigint AND revoked = 0::bigint`, [user.id],
    );
    for (const r of rows) {
      const have = Buffer.from(r.token_hash, 'hex');
      if (have.length === want.length && timingSafeEqual(have, want)) {
        match = true;
        id = String(r.id);
        // "Last used" is kept to the nearest few minutes; phones check in often.
        if (now() - Number(r.last_used_ms ?? 0) > 5 * 60 * 1000) {
          await q(`UPDATE sa_app_passwords SET last_used_ms = $2::bigint, last_used_app = $3::text WHERE id + 0 = $1::bigint`, [r.id, now(), app.slice(0, 40)]);
        }
      }
    }
  }
  if (match && user && id) {
    byUser.delete(email);
    return { ok: true, email: user.email };
  }
  const userLocked = failure(byUser, email, MAX_USER_FAILURES);
  const ipLocked = failure(byIp, ip, MAX_IP_FAILURES);
  if (userLocked || ipLocked) {
    await audit('app_password.locked', email, { app, ip, by: userLocked ? 'account' : 'address' }).catch(() => {});
  }
  return { ok: false, reason: userLocked || ipLocked ? 'locked' : 'invalid' };
}

/** For tests: forget the failure counts. */
export function resetLockouts() {
  byUser.clear();
  byIp.clear();
}
