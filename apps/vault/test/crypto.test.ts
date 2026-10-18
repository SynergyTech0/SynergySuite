import { describe, expect, it } from "vitest";
import { VERIFIER_PLAINTEXT, decrypt, deriveKey, encrypt, fromB64, generatePassword, newKey, toB64, unlockKey } from "../lib/crypto";

// Few rounds keep the tests quick; the app uses KDF_ITERS.
const ITERS = 1000;

describe("vault crypto", () => {
  it("round-trips an entry and never sends the plaintext", async () => {
    const { key } = await newKey("correct horse battery", ITERS);
    const sealed = await encrypt(key, JSON.stringify({ title: "Router", password: "s3cret!" }));
    expect(sealed.ct).not.toContain("s3cret");
    expect(fromB64(sealed.iv)).toHaveLength(12);
    expect(JSON.parse(await decrypt(key, sealed.iv, sealed.ct))).toEqual({ title: "Router", password: "s3cret!" });
  });

  it("uses a fresh IV every time", async () => {
    const { key } = await newKey("correct horse battery", ITERS);
    const a = await encrypt(key, "same");
    const b = await encrypt(key, "same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("unlocks with the right passphrase only", async () => {
    const { params } = await newKey("correct horse battery", ITERS);
    expect(await unlockKey("correct horse battery", params)).not.toBeNull();
    expect(await unlockKey("wrong horse battery", params)).toBeNull();
  });

  it("refuses tampered ciphertext", async () => {
    const { key } = await newKey("correct horse battery", ITERS);
    const sealed = await encrypt(key, "hello");
    const bytes = fromB64(sealed.ct);
    bytes[0] ^= 1;
    await expect(decrypt(key, sealed.iv, toB64(bytes))).rejects.toThrow();
  });

  it("keeps the first version's verifier and key derivation, so existing vaults still unlock", async () => {
    // A verifier made the way the original Vault made it: PBKDF2-SHA256 -> AES-GCM over the same plaintext.
    const salt = toB64(new Uint8Array(16).fill(7));
    const key = await deriveKey("legacy passphrase!", salt, ITERS);
    const v = await encrypt(key, VERIFIER_PLAINTEXT);
    expect(VERIFIER_PLAINTEXT).toBe("synergyvault-verifier-v1");
    expect(await unlockKey("legacy passphrase!", { salt, kdfIters: ITERS, verifierIv: v.iv, verifierCt: v.ct })).not.toBeNull();
  });

  it("generates passwords of the length asked, from the allowed characters", () => {
    for (const len of [8, 20, 64]) {
      const p = generatePassword(len);
      expect(p).toHaveLength(len);
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9!@#$%^&*\-_=+]+$/);
    }
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
