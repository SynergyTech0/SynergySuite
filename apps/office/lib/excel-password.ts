// Excel's sheet and range passwords, as .xlsx stores them: a salted hash
// repeated spinCount times (ECMA-376 Part 1, 18.2.29 and 18.3.1.85), or the
// old 16-bit hash in a `password` attribute. Like Excel's, these keep honest
// people from changing a sheet by accident; they are not encryption.
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";

/** The attributes Excel writes: algorithmName, hashValue, saltValue and spinCount, or the legacy password. */
export type PasswordHash = Record<string, string>;

const HASHES: Record<string, (b: Uint8Array) => Uint8Array> = { "SHA-512": sha512, "SHA-384": sha384, "SHA-256": sha256, "SHA-1": sha1 };
const PASSWORD_KEYS = ["algorithmName", "hashValue", "saltValue", "spinCount", "password"];

const utf16le = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
};
const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};
const toB64 = (b: Uint8Array) => (typeof Buffer !== "undefined" ? Buffer.from(b).toString("base64") : btoa(String.fromCharCode(...b)));
const fromB64 = (s: string) => (typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(s, "base64")) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

function spin(hash: (b: Uint8Array) => Uint8Array, salt: Uint8Array, password: string, count: number): Uint8Array {
  let h = hash(concat(salt, utf16le(password)));
  const buf = new Uint8Array(h.length + 4);
  for (let i = 0; i < count; i++) {
    buf.set(h);
    buf[h.length] = i & 0xff;
    buf[h.length + 1] = (i >>> 8) & 0xff;
    buf[h.length + 2] = (i >>> 16) & 0xff;
    buf[h.length + 3] = (i >>> 24) & 0xff;
    h = hash(buf);
  }
  return h;
}

/** Excel's old 16-bit password hash (the `password` attribute), as 4 hex digits. */
export function legacyPasswordHash(password: string): string {
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    const v = password.charCodeAt(i) << (i + 1);
    h ^= (v & 0x7fff) | (v >> 15);
  }
  h ^= password.length;
  h ^= 0xce4b;
  return h.toString(16).toUpperCase().padStart(4, "0");
}

/** A new password as Excel 2013 and later write it (SHA-512, 16 random bytes of salt, 100,000 rounds). */
export function hashPassword(password: string, spinCount = 100_000, salt?: Uint8Array): PasswordHash {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  return { algorithmName: "SHA-512", hashValue: toB64(spin(sha512, s, password, spinCount)), saltValue: toB64(s), spinCount: String(spinCount) };
}

/** Does the password match? False when there is no password to match. */
export function verifyPassword(password: string, h: PasswordHash | null | undefined): boolean {
  if (!h) return false;
  if (h.hashValue) {
    const hash = HASHES[(h.algorithmName || "SHA-512").toUpperCase()];
    if (!hash) return false;
    const got = toB64(spin(hash, fromB64(h.saltValue || ""), password, Math.max(0, Number(h.spinCount) || 0)));
    return got === h.hashValue;
  }
  if (h.password) return legacyPasswordHash(password) === h.password.toUpperCase().padStart(4, "0");
  return false;
}

export const hasPassword = (h: PasswordHash | null | undefined): boolean => !!h && (!!h.hashValue || !!h.password);

/** Just the password attributes of a sheetProtection or protectedRange. */
export function passwordAttrs(attrs: Record<string, string> | null | undefined): PasswordHash | null {
  if (!attrs) return null;
  const out: PasswordHash = {};
  for (const k of PASSWORD_KEYS) if (attrs[k]) out[k] = attrs[k];
  return hasPassword(out) ? out : null;
}

/** Attributes without the password ones. */
export function withoutPassword(attrs: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs || {})) if (!PASSWORD_KEYS.includes(k)) out[k] = v;
  return out;
}
