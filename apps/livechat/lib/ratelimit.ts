/**
 * A per-process limit on the chat widget, so one address can't flood the inbox. Counts
 * reset each window; the map is swept as it grows. Returns false when the limit is reached.
 */
const g = globalThis as unknown as { __livechatRate?: Map<string, { n: number; until: number }> };

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const m = (g.__livechatRate ??= new Map());
  if (m.size > 50_000) for (const [k, v] of m) if (v.until <= now) m.delete(k);
  const cur = m.get(key);
  if (!cur || cur.until <= now) {
    m.set(key, { n: 1, until: now + windowMs });
    return true;
  }
  return ++cur.n <= max;
}
