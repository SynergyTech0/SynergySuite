// The long lists (accounts, contacts) come a page at a time: an import can bring 160,000 of each.

/** The most rows one request returns, and how many it returns when it doesn't say. */
export const PAGE = 1000;

export function pageSize(limit: unknown): number {
  const n = Math.floor(Number(limit) || PAGE);
  return Math.min(PAGE, Math.max(1, n));
}
