import { createDb } from "@synergy/db";

/**
 * One shared vault per install. The server never sees the passphrase, the key or any entry in
 * the clear: the browser derives an AES-256-GCM key from the passphrase (PBKDF2-SHA256) and sends
 * only ciphertext. vault_config keeps the KDF salt and iterations and a verifier (a known
 * plaintext encrypted with the key) so the browser can tell a wrong passphrase from a right one.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS vault_config (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  salt        TEXT NOT NULL,
  kdf_iters   INTEGER NOT NULL,
  verifier_iv TEXT NOT NULL,
  verifier_ct TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id         BIGSERIAL PRIMARY KEY,
  iv         TEXT NOT NULL,
  ct         TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit (
  id         BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  action     TEXT NOT NULL,
  entry_id   BIGINT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __vaultDb?: Db; __vaultReady?: Promise<void> };

export function db(): Db {
  if (!g.__vaultDb) g.__vaultDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/vault", max: 10 });
  return g.__vaultDb;
}

export function ready(): Promise<void> {
  if (!g.__vaultReady) {
    g.__vaultReady = db().migrate(SCHEMA, "vault").catch((e) => {
      g.__vaultReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__vaultReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

export type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: Tq) => Promise<T>): Promise<T> {
  await ready();
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => (await client.query(text, params as unknown[])).rows);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
