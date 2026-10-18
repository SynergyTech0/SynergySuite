/**
 * All of the vault's cryptography, run in the browser with WebCrypto. The key is
 * PBKDF2-SHA256(passphrase, salt, 600k) -> AES-256-GCM, non-extractable and kept in memory only.
 * The server stores ciphertext, IVs, the salt and a verifier; it can never decrypt anything.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERS = 600_000;
/** Encrypted with the key at setup; decrypting it proves a passphrase is right. Kept from the first version so existing vaults unlock. */
export const VERIFIER_PLAINTEXT = "synergyvault-verifier-v1";
export const MIN_PASSPHRASE = 12;

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function newSalt(): string {
  return toB64(randomBytes(16));
}

export async function deriveKey(passphrase: string, saltB64: string, iters: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(saltB64), iterations: iters, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type Sealed = { iv: string; ct: string };

export async function encrypt(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** Throws when the key is wrong or the data was changed (AES-GCM checks both). */
export async function decrypt(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return dec.decode(pt);
}

/** A fresh salt and key for a passphrase, with the verifier the server keeps. */
export async function newKey(passphrase: string, iters = KDF_ITERS) {
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt, iters);
  const v = await encrypt(key, VERIFIER_PLAINTEXT);
  return { key, params: { salt, kdfIters: iters, verifierIv: v.iv, verifierCt: v.ct } };
}

/** The key for a passphrase when it is the vault's, otherwise null. */
export async function unlockKey(
  passphrase: string,
  cfg: { salt: string; kdfIters: number; verifierIv: string; verifierCt: string },
): Promise<CryptoKey | null> {
  const key = await deriveKey(passphrase, cfg.salt, cfg.kdfIters);
  try {
    return (await decrypt(key, cfg.verifierIv, cfg.verifierCt)) === VERIFIER_PLAINTEXT ? key : null;
  } catch {
    return null;
  }
}

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

/** A random password without look-alike characters. Rejection sampling keeps every character equally likely. */
export function generatePassword(len = 20): string {
  const limit = 256 - (256 % PASSWORD_CHARS.length);
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < limit) out += PASSWORD_CHARS[b % PASSWORD_CHARS.length];
      if (out.length === len) break;
    }
  }
  return out;
}

/** What one entry holds once decrypted. */
export type EntryData = { title: string; username: string; password: string; url: string; notes: string };
