export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Trimmed text without NULs, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/**
 * Removes characters a person can't see but a model reads: control characters (keeping tab and
 * newline), zero-width and joiner characters, bidirectional overrides, the BOM, soft hyphens,
 * Unicode tag characters and variation selectors. Used on everything that reaches the assistant's prompt.
 */
export function scrub(v: unknown, max = 4000): string {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￹-￻]/g, "")
    .replace(/[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\u{1D173}-\u{1D17A}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
