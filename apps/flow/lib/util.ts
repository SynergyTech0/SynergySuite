export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Trimmed text without NULs, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** Today's date as YYYY-MM-DD in UTC. */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
