// Row and column grouping ("outline"), as in Excel's Data > Group.
//
// Each row (or column) carries an outline level 0-7 in its Univer `custom`
// data (`ol`), so levels travel with the row when rows are inserted, removed
// or moved, are saved with the workbook and reach collaborators through the
// ordinary row/column data mutations. A group is a run of neighbouring rows
// whose level is at least L. Collapsing hides the group's rows and marks the
// row after it (Excel's "summary row") with `olc`, which is how Excel stores
// it too; that mark is what keeps an inner group collapsed when its outer
// group is expanded again.

export const MAX_OUTLINE_LEVEL = 7;

export type OutlineCustom = { ol?: number; olc?: boolean };
export type OutlineGroup = { level: number; start: number; end: number };
/** Sparse index -> level (only levels > 0). */
export type Levels = Map<number, number>;

export function levelsFrom(data: Record<string | number, { custom?: Record<string, unknown> | null } | null | undefined> | undefined): Levels {
  const levels: Levels = new Map();
  for (const [k, v] of Object.entries(data || {})) {
    const level = Number((v?.custom as OutlineCustom | undefined)?.ol) || 0;
    if (level > 0) levels.set(Number(k), Math.min(level, MAX_OUTLINE_LEVEL));
  }
  return levels;
}

export function collapsedFrom(data: Record<string | number, { custom?: Record<string, unknown> | null } | null | undefined> | undefined): Set<number> {
  const out = new Set<number>();
  for (const [k, v] of Object.entries(data || {})) if ((v?.custom as OutlineCustom | undefined)?.olc) out.add(Number(k));
  return out;
}

export const maxLevel = (levels: Levels) => Math.max(0, ...levels.values());

/** All groups, outer levels first, then by position. */
export function groupsOf(levels: Levels): OutlineGroup[] {
  const indices = [...levels.keys()].sort((a, b) => a - b);
  const groups: OutlineGroup[] = [];
  for (let level = 1; level <= maxLevel(levels); level++) {
    let start = -1;
    let prev = -2;
    for (const i of indices) {
      if ((levels.get(i) || 0) < level) {
        if (start >= 0) groups.push({ level, start, end: prev });
        start = -1;
        continue;
      }
      if (start >= 0 && i === prev + 1) {
        prev = i;
        continue;
      }
      if (start >= 0) groups.push({ level, start, end: prev });
      start = prev = i;
    }
    if (start >= 0) groups.push({ level, start, end: prev });
  }
  return groups;
}

/** New levels for start..end after grouping (+1) or ungrouping (-1). Only
 *  changed indices are returned. Grouping stops at the maximum depth. */
export function shiftLevels(levels: Levels, start: number, end: number, delta: 1 | -1): Map<number, number> {
  const changed = new Map<number, number>();
  for (let i = start; i <= end; i++) {
    const cur = levels.get(i) || 0;
    const next = Math.max(0, Math.min(MAX_OUTLINE_LEVEL, cur + delta));
    if (next !== cur) changed.set(i, next);
  }
  return changed;
}

/** Index of a group's summary row/column: the one after it (Excel's default),
 *  or before it when the sheet puts summaries above/left. */
export const summaryOf = (g: OutlineGroup, after = true) => (after ? g.end + 1 : g.start - 1);

/** The group at `level` that contains index i, if any. */
export function groupAt(levels: Levels, i: number, level: number): OutlineGroup | undefined {
  return groupsOf(levels).find((g) => g.level === level && g.start <= i && i <= g.end);
}

/** The innermost group touching index i, either inside it or on its summary. */
export function innermostGroupFor(levels: Levels, i: number, after = true): OutlineGroup | undefined {
  const all = groupsOf(levels).filter((g) => (g.start <= i && i <= g.end) || summaryOf(g, after) === i);
  return all.sort((a, b) => b.level - a.level)[0];
}

/** Indices to show when a group is expanded: its own, except those of inner
 *  groups that are still collapsed. */
export function indicesToShow(levels: Levels, group: OutlineGroup, collapsed: Set<number>, after = true): number[] {
  const hiddenInner = new Set<number>();
  for (const g of groupsOf(levels)) {
    if (g.level <= group.level || g.start < group.start || g.end > group.end) continue;
    if (!collapsed.has(summaryOf(g, after))) continue;
    for (let i = g.start; i <= g.end; i++) hiddenInner.add(i);
  }
  const out: number[] = [];
  for (let i = group.start; i <= group.end; i++) if (!hiddenInner.has(i)) out.push(i);
  return out;
}

/** "Show level n" (the 1, 2, 3 buttons): indices with level >= n are hidden,
 *  the rest of the grouped ones shown; groups at level >= n become collapsed. */
export function showLevel(levels: Levels, n: number, after = true): { hide: number[]; show: number[]; collapse: number[]; expand: number[] } {
  const hide: number[] = [];
  const show: number[] = [];
  for (const [i, level] of levels) (level >= n ? hide : show).push(i);
  const collapse: number[] = [];
  const expand: number[] = [];
  for (const g of groupsOf(levels)) (g.level >= n ? collapse : expand).push(summaryOf(g, after));
  const sort = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);
  // A summary shared by an outer expanded and an inner collapsed group stays collapsed.
  const collapsedSet = new Set(collapse);
  return { hide: sort(hide), show: sort(show), collapse: sort(collapse), expand: sort(expand.filter((i) => !collapsedSet.has(i))) };
}

/** Sorted indices -> [start, count] runs, for hideRows/showRows style calls. */
export function runs(indices: Iterable<number>): [number, number][] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === i) last[1]++;
    else out.push([i, 1]);
  }
  return out;
}
