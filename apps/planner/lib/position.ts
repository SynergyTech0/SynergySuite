/** Fractional indexing: a position strictly between a and b, so a drop never rewrites siblings. */
const STEP = 1024;

export function between(a: number | null, b: number | null): number {
  if (a == null && b == null) return STEP;
  if (a == null) return (b as number) - STEP;
  if (b == null) return (a as number) + STEP;
  return (a + b) / 2;
}

/**
 * The position for the item now at `index` of an already-reordered array: between its new neighbours.
 * Compute this from the array AFTER the move. Reading neighbours from state captured before the move
 * saves the item's old position, and the reorder silently reverts on the next refetch.
 */
export function positionAt<T extends { position: number }>(ordered: T[], index: number): number {
  const prev = index > 0 ? ordered[index - 1].position : null;
  const next = index < ordered.length - 1 ? ordered[index + 1].position : null;
  return between(prev, next);
}

/** Position to append after the last item in a list. */
export function afterLast(positions: number[]): number {
  return positions.length ? Math.max(...positions) + STEP : STEP;
}
