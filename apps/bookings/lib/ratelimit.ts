import { UserError } from "./util";

/**
 * A per-process limit on the public routes, so a script can't fill a page with bookings or
 * crawl every free slot. Counts reset each window; the map is swept as it grows.
 */
const g = globalThis as unknown as { __bookingsRate?: Map<string, { n: number; until: number }> };

export function limit(key: string, max: number, windowMs: number, now = Date.now()): void {
  const m = (g.__bookingsRate ??= new Map());
  if (m.size > 20_000) for (const [k, v] of m) if (v.until <= now) m.delete(k);
  const cur = m.get(key);
  if (!cur || cur.until <= now) {
    m.set(key, { n: 1, until: now + windowMs });
    return;
  }
  if (++cur.n > max) throw new UserError("Too many requests. Please wait a moment and try again.", 429);
}
