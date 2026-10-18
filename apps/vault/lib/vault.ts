import type { Me } from "./api";
import { q, tx } from "./db";
import { UserError, blob } from "./util";

/** The fewest PBKDF2 rounds the server accepts from a browser setting up or rekeying the vault. */
export const MIN_KDF_ITERS = 100_000;
export const AUDIT_ACTIONS = ["unlock", "unlock.failed", "reveal", "copy", "lock"] as const;

export type VaultConfig =
  | { configured: false }
  | { configured: true; salt: string; kdfIters: number; verifierIv: string; verifierCt: string };

export type Entry = { id: string; iv: string; ct: string; created_by: string; updated_by: string; updated_at: string };
export type AuditRow = { id: string; user_email: string; action: string; entry_id: string | null; at: string };

type KeyParams = { salt: string; kdfIters: number; verifierIv: string; verifierCt: string };

function keyParams(b: Record<string, unknown>): KeyParams {
  const kdfIters = Number(b.kdfIters);
  if (!Number.isInteger(kdfIters) || kdfIters < MIN_KDF_ITERS || kdfIters > 10_000_000) {
    throw new UserError(`The key needs between ${MIN_KDF_ITERS} and 10000000 PBKDF2 rounds`);
  }
  return { salt: blob(b.salt, "Salt"), kdfIters, verifierIv: blob(b.verifierIv, "Verifier"), verifierCt: blob(b.verifierCt, "Verifier") };
}

function entryId(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new UserError("Not found", 404);
  return n;
}

async function audit(email: string, action: string, entryId: number | null = null): Promise<void> {
  await q("INSERT INTO audit (user_email, action, entry_id) VALUES ($1, $2, $3)", [email, action, entryId]).catch((e) =>
    console.error("[vault] audit", e),
  );
}

export async function getVault(): Promise<VaultConfig> {
  const [c] = await q<{ salt: string; kdf_iters: number; verifier_iv: string; verifier_ct: string }>(
    "SELECT salt, kdf_iters, verifier_iv, verifier_ct FROM vault_config WHERE id = 1",
  );
  if (!c) return { configured: false };
  return { configured: true, salt: c.salt, kdfIters: c.kdf_iters, verifierIv: c.verifier_iv, verifierCt: c.verifier_ct };
}

/** Sets the vault up once. The browser made the salt and verifier; the passphrase never left it. */
export async function initVault(me: Me, b: Record<string, unknown>): Promise<void> {
  const k = keyParams(b);
  const rows = await q(
    `INSERT INTO vault_config (id, salt, kdf_iters, verifier_iv, verifier_ct, created_by) VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [k.salt, k.kdfIters, k.verifierIv, k.verifierCt, me.email],
  );
  if (!rows.length) throw new UserError("The vault is already set up", 409);
  await audit(me.email, "vault.init");
}

/**
 * A passphrase change. The browser re-encrypts every entry under the new key and sends them all
 * with the new key parameters; they are swapped in one transaction, or not at all. An entry added
 * or removed by someone else meanwhile makes the set differ, and the change is refused.
 */
export async function rekey(me: Me, b: Record<string, unknown>): Promise<void> {
  const k = keyParams(b);
  if (!Array.isArray(b.entries)) throw new UserError("Send every entry, re-encrypted");
  const sent = (b.entries as Record<string, unknown>[]).map((e) => ({ id: entryId(e?.id), iv: blob(e?.iv), ct: blob(e?.ct) }));
  await tx(async (tq) => {
    const [cfg] = await tq("SELECT 1 FROM vault_config WHERE id = 1 FOR UPDATE");
    if (!cfg) throw new UserError("The vault is not set up yet", 409);
    const have = (await tq<{ id: string }>("SELECT id FROM entries ORDER BY id FOR UPDATE")).map((r) => Number(r.id));
    const got = sent.map((e) => e.id).sort((a, b) => a - b);
    if (have.length !== got.length || have.some((id, i) => id !== got[i])) {
      throw new UserError("Entries changed while you were changing the passphrase. Unlock again and retry.", 409);
    }
    for (const e of sent) await tq("UPDATE entries SET iv = $2, ct = $3, updated_at = now() WHERE id = $1", [e.id, e.iv, e.ct]);
    await tq("UPDATE vault_config SET salt = $1, kdf_iters = $2, verifier_iv = $3, verifier_ct = $4, updated_at = now() WHERE id = 1", [
      k.salt,
      k.kdfIters,
      k.verifierIv,
      k.verifierCt,
    ]);
  });
  await audit(me.email, "vault.rekey");
}

const ENTRY_COLS = "id::text, iv, ct, created_by, updated_by, updated_at";

export async function listEntries(): Promise<Entry[]> {
  return q<Entry>(`SELECT ${ENTRY_COLS} FROM entries ORDER BY id`);
}

export async function createEntry(me: Me, b: Record<string, unknown>): Promise<Entry> {
  const [row] = await q<Entry>(`INSERT INTO entries (iv, ct, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING ${ENTRY_COLS}`, [
    blob(b.iv),
    blob(b.ct),
    me.email,
  ]);
  await audit(me.email, "entry.create", Number(row.id));
  return row;
}

export async function updateEntry(me: Me, id: unknown, b: Record<string, unknown>): Promise<Entry> {
  const n = entryId(id);
  const [row] = await q<Entry>(`UPDATE entries SET iv = $2, ct = $3, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING ${ENTRY_COLS}`, [
    n,
    blob(b.iv),
    blob(b.ct),
    me.email,
  ]);
  if (!row) throw new UserError("Not found", 404);
  await audit(me.email, "entry.update", n);
  return row;
}

export async function deleteEntry(me: Me, id: unknown): Promise<void> {
  const n = entryId(id);
  const rows = await q("DELETE FROM entries WHERE id = $1 RETURNING id", [n]);
  if (!rows.length) throw new UserError("Not found", 404);
  await audit(me.email, "entry.delete", n);
}

/** What the browser reports (it alone knows when someone unlocked, revealed or copied). Best effort. */
export async function report(me: Me, b: Record<string, unknown>): Promise<void> {
  const action = String(b.action ?? "");
  if (!(AUDIT_ACTIONS as readonly string[]).includes(action)) throw new UserError("Unknown action");
  const id = b.entryId == null || b.entryId === "" ? null : entryId(b.entryId);
  await audit(me.email, action, id);
}

export async function auditLog(limit = 200): Promise<AuditRow[]> {
  return q<AuditRow>("SELECT id::text, user_email, action, entry_id::text, at FROM audit ORDER BY id DESC LIMIT $1", [limit]);
}
