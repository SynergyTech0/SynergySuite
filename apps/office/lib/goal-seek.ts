// Goal Seek: find the input value that makes a formula reach a target, like
// Excel's What-If Analysis > Goal Seek. The search only needs a way to try a
// value and read the result back, so it runs against the live workbook (the
// formula engine recalculates each try) and in tests against plain functions.

export type GoalSeekResult = { found: boolean; value: number; result: number; iterations: number };

export type GoalSeekOptions = { maxIterations?: number; tolerance?: number };

/**
 * Secant steps from the current value, alternating with bisection once a sign
 * change is bracketed (so the bracket at least halves every other step). Stops when |f(x) - target| <= tolerance (Excel uses
 * 100 iterations and 0.001).
 */
export async function goalSeek(evaluate: (x: number) => Promise<number> | number, target: number, start: number, options: GoalSeekOptions = {}): Promise<GoalSeekResult> {
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 0.001;
  const err = async (x: number) => {
    const y = await evaluate(x);
    return { y, e: Number.isFinite(y) ? y - target : NaN };
  };
  let x0 = Number.isFinite(start) ? start : 0;
  let p0 = await err(x0);
  let best = { x: x0, y: p0.y, e: Math.abs(p0.e) };
  if (Math.abs(p0.e) <= tolerance) return { found: true, value: x0, result: p0.y, iterations: 0 };
  let x1 = x0 === 0 ? 1 : x0 * 1.01;
  let p1 = await err(x1);
  // Closest tries below and above the target, once there are any.
  const bracket: { lo: { x: number; e: number } | null; hi: { x: number; e: number } | null } = { lo: null, hi: null };
  const note = (x: number, p: { y: number; e: number }) => {
    if (!Number.isFinite(p.e)) return;
    if (Math.abs(p.e) < best.e) best = { x, y: p.y, e: Math.abs(p.e) };
    const { lo, hi } = bracket;
    // Inside a bracket a try always narrows it; before that, keep the closest.
    const within = lo && hi && x > Math.min(lo.x, hi.x) && x < Math.max(lo.x, hi.x);
    if (p.e < 0 && (within || !lo || (!hi && Math.abs(p.e) < Math.abs(lo.e)))) bracket.lo = { x, e: p.e };
    if (p.e > 0 && (within || !hi || (!lo && Math.abs(p.e) < Math.abs(hi.e)))) bracket.hi = { x, e: p.e };
  };
  note(x0, p0);
  note(x1, p1);
  for (let i = 1; i <= maxIterations; i++) {
    if (Number.isFinite(p1.e) && Math.abs(p1.e) <= tolerance) return { found: true, value: x1, result: p1.y, iterations: i };
    let next: number;
    const { lo, hi } = bracket;
    const slope = (p1.e - p0.e) / (x1 - x0);
    if (lo && hi && (!Number.isFinite(slope) || slope === 0 || i % 2 === 0)) next = (lo.x + hi.x) / 2;
    else if (Number.isFinite(slope) && slope !== 0) next = x1 - p1.e / slope;
    else next = x1 + (Math.abs(x1) || 1) * (i % 2 ? 1 : -1) * 2 ** Math.min(i, 30) * 0.01;
    // Keep a secant step inside a known bracket.
    if (lo && hi) {
      const a = Math.min(lo.x, hi.x);
      const b = Math.max(lo.x, hi.x);
      if (!(next > a && next < b)) next = (a + b) / 2;
    }
    if (!Number.isFinite(next)) break;
    x0 = x1;
    p0 = p1;
    x1 = next;
    p1 = await err(x1);
    note(x1, p1);
  }
  // Not found: leave the closest try in place, as Excel does.
  return { found: best.e <= tolerance, value: best.x, result: best.y, iterations: maxIterations };
}
