import { generateKeyPairSync, createHash, randomBytes } from 'crypto';
import { importPKCS8, SignJWT, jwtVerify, importJWK, decodeProtectedHeader, type JWTPayload } from 'jose';
import { q, now } from './db';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto';
import { ISSUER_URL } from './config';

/*
 * RS256 signing keys. The newest active=1 key signs; ALL stored keys stay in
 * the JWKS so tokens signed before a rotation keep verifying until they expire
 * (Keycloak-style rotation). verifyJwt resolves the key by the token's kid.
 * Private keys are AES-256-GCM encrypted at rest (sa_keys.private_pem).
 */

type KeyRow = { kid: string; private_pem: string; public_jwk: unknown; active: string | number; created_ms: string | number };

type CachedKeys = { signing: KeyRow; all: KeyRow[] };
let cached: CachedKeys | null = null;

function makeKey(): { kid: string; privatePem: string; publicJwk: Record<string, unknown> } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const kid = createHash('sha256').update(JSON.stringify(jwk)).digest('hex').slice(0, 16);
  return { kid, privatePem, publicJwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } };
}

async function loadKeys(): Promise<CachedKeys> {
  if (cached) return cached;
  const all = await q<KeyRow>(`SELECT * FROM sa_keys ORDER BY created_ms DESC LIMIT $1`, [10]);
  // Lazily migrate any private keys stored plaintext (pre-encryption rows).
  for (const row of all) {
    if (!isEncrypted(row.private_pem)) {
      const enc = encryptSecret(row.private_pem);
      await q(`UPDATE sa_keys SET private_pem = $2::text WHERE kid = $1::text`, [row.kid, enc]);
      row.private_pem = enc;
    }
  }
  const signing = all.find((k) => Number(k.active) === 1);
  if (signing) {
    cached = { signing, all };
    return cached;
  }
  const k = makeKey();
  const rows = await q<KeyRow>(
    `INSERT INTO sa_keys (kid, private_pem, public_jwk, active, created_ms)
     VALUES ($1::text, $2::text, $3::jsonb, 1::bigint, $4::bigint) RETURNING *`,
    [k.kid, encryptSecret(k.privatePem), JSON.stringify(k.publicJwk), now()],
  );
  cached = { signing: rows[0], all: [rows[0], ...all] };
  return cached;
}

export async function rotateKey(): Promise<string> {
  await q(`UPDATE sa_keys SET active = 0::bigint WHERE active = 1::bigint`);
  const k = makeKey();
  await q(
    `INSERT INTO sa_keys (kid, private_pem, public_jwk, active, created_ms)
     VALUES ($1::text, $2::text, $3::jsonb, 1::bigint, $4::bigint)`,
    [k.kid, encryptSecret(k.privatePem), JSON.stringify(k.publicJwk), now()],
  );
  cached = null;
  return k.kid;
}

export async function activeKey() {
  const { signing } = await loadKeys();
  return {
    kid: signing.kid,
    privatePem: decryptSecret(signing.private_pem)!,
    publicJwk: signing.public_jwk as Record<string, unknown>,
  };
}

export async function jwks() {
  const { all } = await loadKeys();
  return { keys: all.map((k) => k.public_jwk) };
}

export function issuer(): string {
  return ISSUER_URL;
}

export async function signJwt(payload: JWTPayload, audience: string, ttlSeconds: number): Promise<string> {
  const k = await activeKey();
  const key = await importPKCS8(k.privatePem, 'RS256');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: k.kid, typ: 'JWT' })
    .setIssuer(issuer())
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .setJti(randomBytes(16).toString('hex'))
    .sign(key);
}

export async function verifyJwt(token: string): Promise<JWTPayload | null> {
  try {
    const { kid } = decodeProtectedHeader(token);
    const { all } = await loadKeys();
    const row = all.find((k) => k.kid === kid) ?? all.find((k) => Number(k.active) === 1);
    if (!row) return null;
    const key = await importJWK(row.public_jwk as never, 'RS256');
    const { payload } = await jwtVerify(token, key, { issuer: issuer() });
    return payload;
  } catch {
    return null;
  }
}
