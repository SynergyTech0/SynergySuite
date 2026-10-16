import { randomBytes } from 'crypto';
import { q, now } from './db';
import { RP_ID, RP_ORIGIN } from './config';

/* WebAuthn support glue: RP identity from config (SA_RP_ID / ISSUER_URL) + a
 * one-time challenge store in sa_challenges (keyed by session sid for
 * enrollment, by a random handle for usernameless login). */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function rpID(): string {
  return RP_ID;
}

export function rpOrigin(): string {
  return RP_ORIGIN;
}

export async function storeChallenge(key: string, challenge: string, kind: string, userId: string | number | null): Promise<void> {
  await q(`DELETE FROM sa_challenges WHERE ckey = $1::text`, [key]);
  await q(
    `INSERT INTO sa_challenges (ckey, challenge, kind, user_id, expires_ms)
     VALUES ($1::text, $2::text, $3::text, $4::bigint, $5::bigint)`,
    [key, challenge, kind, userId ?? 0, now() + CHALLENGE_TTL_MS],
  );
}

export async function consumeChallenge(key: string, kind: string): Promise<{ challenge: string; userId: string } | null> {
  const rows = await q<{ ckey: string; challenge: string; kind: string; user_id: string; expires_ms: string | number }>(
    `SELECT * FROM sa_challenges WHERE ckey = $1::text`, [key],
  );
  const r = rows[0];
  await q(`DELETE FROM sa_challenges WHERE ckey = $1::text`, [key]);
  if (!r || r.kind !== kind || Number(r.expires_ms) < Date.now()) return null;
  return { challenge: r.challenge, userId: r.user_id };
}

export const newHandle = () => randomBytes(16).toString('hex');

export type PasskeyRow = {
  cred_id: string; user_id: string; public_key: string; counter: string | number;
  transports: string[] | null; name: string | null; created_ms: string | number;
};

export async function passkeysForUser(userId: string | number): Promise<PasskeyRow[]> {
  return q<PasskeyRow>(`SELECT * FROM sa_passkeys WHERE user_id = $1::bigint ORDER BY created_ms LIMIT $2`, [userId, 20]);
}

export async function findPasskey(credId: string): Promise<PasskeyRow | null> {
  const rows = await q<PasskeyRow>(`SELECT * FROM sa_passkeys WHERE cred_id = $1::text`, [credId]);
  return rows[0] ?? null;
}

export async function savePasskey(p: { credId: string; userId: string | number; publicKey: string; counter: number; transports: string[]; name: string }): Promise<void> {
  await q(
    `INSERT INTO sa_passkeys (cred_id, user_id, public_key, counter, transports, name, created_ms)
     VALUES ($1::text, $2::bigint, $3::text, $4::bigint, $5::jsonb, $6::text, $7::bigint)`,
    [p.credId, p.userId, p.publicKey, p.counter, JSON.stringify(p.transports), p.name, now()],
  );
}

export async function updateCounter(credId: string, counter: number): Promise<void> {
  await q(`UPDATE sa_passkeys SET counter = $2::bigint WHERE cred_id = $1::text`, [credId, counter]);
}
