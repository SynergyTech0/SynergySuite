/**
 * Report maths, kept pure so the numbers can be tested without a database.
 *
 * Velocity reads sprint snapshots, not today's sprint membership: completing a sprint sends unfinished
 * cards back to the backlog, so after the fact there is no honest way to know what the sprint
 * contained. The snapshot is written at the moment of completion (see /api/sprints/[id]).
 */
const WEEK = 7 * 86400000;

export type SprintSnapshot = {
  name: string;
  committedPoints: number;
  completedPoints: number;
  completedAt: Date | string | null;
};

export function velocityFrom(snapshots: SprintSnapshot[]) {
  const sprints = [...snapshots]
    .sort((a, b) => new Date(a.completedAt ?? 0).getTime() - new Date(b.completedAt ?? 0).getTime())
    .map((s) => ({ name: s.name, committed: s.committedPoints, completed: s.completedPoints }));
  const averageCompleted = sprints.length
    ? Math.round((sprints.reduce((n, s) => n + s.completed, 0) / sprints.length) * 10) / 10
    : 0;
  return { sprints, averageCompleted };
}

type Timed = { createdAt: Date | string; completedAt: Date | string | null };

/** Created and resolved counts per week, oldest bucket first, ending with the week containing `now`. */
export function createdVsResolved(cards: Timed[], weeks = 8, now = new Date()) {
  const end = now.getTime();
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    // Bucket i covers [start, start + WEEK); the last one ends at `now`.
    start: new Date(end - (weeks - i) * WEEK),
    label: new Date(end - (weeks - i) * WEEK).toISOString().slice(0, 10),
    created: 0,
    resolved: 0,
  }));
  const indexOf = (when: Date | string | null) => {
    if (!when) return -1;
    const t = new Date(when).getTime();
    const i = Math.floor((t - (end - weeks * WEEK)) / WEEK);
    return i >= 0 && i < weeks ? i : -1;
  };
  for (const c of cards) {
    const ci = indexOf(c.createdAt);
    if (ci >= 0) buckets[ci].created++;
    const ri = indexOf(c.completedAt);
    if (ri >= 0) buckets[ri].resolved++;
  }
  return buckets;
}

/** Cards finished per week — the simplest honest measure of flow when no daily snapshots exist. */
export function throughput(cards: Timed[], weeks = 8, now = new Date()) {
  return createdVsResolved(cards, weeks, now).map(({ label, resolved }) => ({ label, done: resolved }));
}
