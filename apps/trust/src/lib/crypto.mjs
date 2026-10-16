// Opaque tokens for collector agents.
//
// Plain .mjs so the scripts can import it under bare `node`, the same reasoning as db.mjs.
// Declarations live in crypto.d.mts. Sign-in belongs to the suite, so nothing here hashes
// passwords or second factors any more; agent tokens are the only secret Trust issues.

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** 256 bits, URL-safe. The raw value is shown once and never stored. */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 of a token, hex. These values are already high-entropy, so a fast hash is correct
 * here — a slow KDF would add latency to every agent call without adding security, since
 * there is no low-entropy space to brute force.
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
