// Word's document protection password (w:documentProtection): the password
// is first reduced to Word's legacy 32-bit key, its bytes reversed and written
// as hex, and that text (UTF-16LE) is hashed with the salt and then re-hashed
// spinCount times with the iteration appended ([MS-OFFCRYPTO] 2.3.7.1, ECMA-376
// Part 4 documentProtection). Checking it lets a Word file's restriction be
// lifted with its password, and writing it makes Word honour ours.
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";

const INITIAL_CODE = [0xe1f0, 0x1d0f, 0xcc9c, 0x84c0, 0x110c, 0x0e10, 0xf1ce, 0x313e, 0x1872, 0xe139, 0xd40f, 0x84f9, 0x280c, 0xa96a, 0x4ec3];
const MATRIX = [
  [0xaefc, 0x4dd9, 0x9bb2, 0x2745, 0x4e8a, 0x9d14, 0x2a09],
  [0x7b61, 0xf6c2, 0xfda5, 0xeb6b, 0xc6f7, 0x9dcf, 0x2bbf],
  [0x4563, 0x8ac6, 0x05ad, 0x0b5a, 0x16b4, 0x2d68, 0x5ad0],
  [0x0375, 0x06ea, 0x0dd4, 0x1ba8, 0x3750, 0x6ea0, 0xdd40],
  [0xd849, 0xa0b3, 0x5147, 0xa28e, 0x553d, 0xaa7a, 0x44d5],
  [0x6f45, 0xde8a, 0xad35, 0x4a4b, 0x9496, 0x390d, 0x721a],
  [0xeb23, 0xc667, 0x9cef, 0x29ff, 0x53fe, 0xa7fc, 0x5fd9],
  [0x47d3, 0x8fa6, 0x0f6d, 0x1eda, 0x3db4, 0x7b68, 0xf6d0],
  [0xb861, 0x60e3, 0xc1c6, 0x93ad, 0x377b, 0x6ef6, 0xddec],
  [0x45a0, 0x8b40, 0x06a1, 0x0d42, 0x1a84, 0x3508, 0x6a10],
  [0xaa51, 0x4483, 0x8906, 0x022d, 0x045a, 0x08b4, 0x1168],
  [0x76b4, 0xed68, 0xcaf1, 0x85c3, 0x1ba7, 0x374e, 0x6e9c],
  [0x3730, 0x6e60, 0xdcc0, 0xa9a1, 0x4363, 0x86c6, 0x1dad],
  [0x3331, 0x6662, 0xccc4, 0x89a9, 0x0373, 0x06e6, 0x0dcc],
  [0x1021, 0x2042, 0x4084, 0x8108, 0x1231, 0x2462, 0x48c4],
];

/** Word's legacy 32-bit password key (high word from the matrix, low word the XOR verifier). */
export function legacyWordKey(password: string): number {
  const pw = password.slice(0, 15);
  if (!pw) return 0;
  // one byte per character: the low byte, or the high byte when the low one is 0
  const bytes = [...pw].map((c) => {
    const n = c.charCodeAt(0);
    return n & 0xff || (n >> 8) & 0xff;
  });
  let high = INITIAL_CODE[bytes.length - 1];
  let line = 15 - bytes.length;
  for (let ch of bytes) {
    for (const x of MATRIX[line++]) {
      if (ch & 1) high ^= x;
      ch >>>= 1;
    }
  }
  const rot = (v: number) => ((v & 0x4000 ? 1 : 0) | ((v << 1) & 0x7fff)) & 0xffff;
  let low = 0;
  for (let i = bytes.length - 1; i >= 0; i--) low = rot(low) ^ bytes[i];
  low = rot(low) ^ bytes.length ^ 0xce4b;
  return ((high & 0xffff) * 0x10000 + (low & 0xffff)) >>> 0;
}

/** The legacy key with its bytes reversed, as upper-case hex ("Example" -> "7EEDCE64"). */
export function legacyWordKeyHex(password: string): string {
  const k = legacyWordKey(password);
  return [k & 0xff, (k >>> 8) & 0xff, (k >>> 16) & 0xff, (k >>> 24) & 0xff].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

const ALGOS: Record<string, string> = { "4": "SHA-1", "12": "SHA-256", "13": "SHA-384", "14": "SHA-512", "SHA-1": "SHA-1", SHA1: "SHA-1", "SHA-256": "SHA-256", SHA256: "SHA-256", "SHA-384": "SHA-384", SHA384: "SHA-384", "SHA-512": "SHA-512", SHA512: "SHA-512" };
const utf16le = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[i * 2] = c & 0xff;
    b[i * 2 + 1] = c >> 8;
  }
  return b;
};
const b64 = (u: Uint8Array) => (typeof Buffer !== "undefined" ? Buffer.from(u).toString("base64") : btoa(String.fromCharCode(...u)));
const unb64 = (s: string) => (typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(s, "base64")) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

const HASHES: Record<string, (b: Uint8Array) => Uint8Array> = { "SHA-1": sha1, "SHA-256": sha256, "SHA-384": sha384, "SHA-512": sha512 };

/** H(salt + text), then H(previous + iteration as 4 little-endian bytes), spinCount times (synchronous: 100,000 rounds take well under a second). */
export function spinHash(text: string, salt: Uint8Array, spinCount: number, algo: string): Uint8Array {
  const h = HASHES[algo];
  const pw = utf16le(text);
  const first = new Uint8Array(salt.length + pw.length);
  first.set(salt);
  first.set(pw, salt.length);
  let hash = h(first);
  const buf = new Uint8Array(hash.length + 4);
  for (let i = 0; i < spinCount; i++) {
    buf.set(hash);
    buf[hash.length] = i & 0xff;
    buf[hash.length + 1] = (i >>> 8) & 0xff;
    buf[hash.length + 2] = (i >>> 16) & 0xff;
    buf[hash.length + 3] = (i >>> 24) & 0xff;
    hash = h(buf);
  }
  return hash;
}

const get = (w: Record<string, string>, ...names: string[]) => {
  for (const n of names) {
    const v = w[`w:${n}`] ?? w[n];
    if (v !== undefined) return v;
  }
  return undefined;
};

/** Whether a Word file's protection carries a password hash we can check. */
export function hasWordPassword(w: Record<string, string> | undefined): boolean {
  return !!w && !!get(w, "hash", "hashValue") && !!get(w, "salt", "saltValue");
}

/** Whether the hash uses an algorithm we can compute. */
export function canCheckWordPassword(w: Record<string, string> | undefined): boolean {
  return !!w && !!ALGOS[get(w, "cryptAlgorithmSid", "algorithmName") || ""];
}

/**
 * Check a password against a Word file's w:documentProtection attributes
 * (cryptAlgorithmSid/hash/salt/cryptSpinCount, or algorithmName/hashValue/saltValue/spinCount).
 * Returns null when there is no hash, or it uses an algorithm we can't compute.
 */
export async function checkWordPassword(w: Record<string, string> | undefined, password: string): Promise<boolean | null> {
  if (!w) return null;
  const hash = get(w, "hash", "hashValue");
  const salt = get(w, "salt", "saltValue");
  if (!hash || !salt) return null;
  const algo = ALGOS[get(w, "cryptAlgorithmSid", "algorithmName") || ""];
  if (!algo) return null;
  const spin = Number(get(w, "cryptSpinCount", "spinCount") || 0) || 0;
  const want = b64(unb64(hash));
  const s = unb64(salt);
  // Word hashes its legacy key; some writers hash the password itself
  for (const text of [legacyWordKeyHex(password), password]) if (b64(spinHash(text, s, spin, algo)) === want) return true;
  return false;
}

/** The attributes Word writes for a password: SHA-512, a 16-byte salt, 100,000 rounds. */
export async function wordPasswordAttrs(password: string, spinCount = 100000): Promise<Record<string, string>> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = spinHash(legacyWordKeyHex(password), salt, spinCount, "SHA-512");
  return {
    "w:cryptProviderType": "rsaAES",
    "w:cryptAlgorithmClass": "hash",
    "w:cryptAlgorithmType": "typeAny",
    "w:cryptAlgorithmSid": "14",
    "w:cryptSpinCount": String(spinCount),
    "w:hash": b64(hash),
    "w:salt": b64(salt),
  };
}
