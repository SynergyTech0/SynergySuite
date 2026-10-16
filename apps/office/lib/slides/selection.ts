import type { Box } from "./model";

export type Positioned = Box & { id: string };
export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "horizontal" | "vertical";

export function clickSelection(selected: string[], id: string, additive: boolean): string[] {
  if (additive) return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  return selected.includes(id) && selected.length > 1 ? selected : [id];
}

export function boundsOf(elements: Positioned[]): Box | null {
  if (!elements.length) return null;
  const x = Math.min(...elements.map((el) => el.x));
  const y = Math.min(...elements.map((el) => el.y));
  const right = Math.max(...elements.map((el) => el.x + el.w));
  const bottom = Math.max(...elements.map((el) => el.y + el.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function inMarquee(elements: Positioned[], area: Box): string[] {
  return elements.filter((el) => el.x < area.x + area.w && el.x + el.w > area.x && el.y < area.y + area.h && el.y + el.h > area.y).map((el) => el.id);
}

/** Grouped objects select together: add every member of any group a selected object belongs to. */
export function withGroups(elements: (Positioned & { group?: string })[], ids: string[]): string[] {
  const groups = new Set(elements.filter((el) => ids.includes(el.id) && el.group).map((el) => el.group));
  const extra = elements.filter((el) => el.group && groups.has(el.group) && !ids.includes(el.id)).map((el) => el.id);
  return [...ids, ...extra];
}

/**
 * Only position fields change; dimensions and object order stay intact.
 * `to` is the box to align against (the slide, for a single object); default the selection's bounds.
 */
export function alignedPositions(elements: Positioned[], align: Align, to?: Box): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const bounds = to || boundsOf(elements);
  if (!bounds) return out;
  for (const el of elements) {
    const x = align === "left" ? bounds.x : align === "center" ? bounds.x + (bounds.w - el.w) / 2 : align === "right" ? bounds.x + bounds.w - el.w : el.x;
    const y = align === "top" ? bounds.y : align === "middle" ? bounds.y + (bounds.h - el.h) / 2 : align === "bottom" ? bounds.y + bounds.h - el.h : el.y;
    out.set(el.id, { x, y });
  }
  return out;
}

/**
 * Space the objects evenly between the outer edges of the first and last, or,
 * with `to` (the slide, PowerPoint's "Align to Slide"), across that box.
 */
export function distributedPositions(elements: Positioned[], axis: Axis, to?: Box): Map<string, { x: number; y: number }> {
  const out = new Map(elements.map((el) => [el.id, { x: el.x, y: el.y }]));
  if (!elements.length || (!to && elements.length < 3)) return out;
  const horizontal = axis === "horizontal";
  const sorted = [...elements].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const start = to ? (horizontal ? to.x : to.y) : horizontal ? first.x : first.y;
  const end = to ? (horizontal ? to.x + to.w : to.y + to.h) : horizontal ? last.x + last.w : last.y + last.h;
  const total = sorted.reduce((sum, el) => sum + (horizontal ? el.w : el.h), 0);
  const gap = sorted.length > 1 ? (end - start - total) / (sorted.length - 1) : 0;
  let cursor = sorted.length > 1 ? start : start + (end - start - total) / 2;
  for (const el of sorted) {
    out.set(el.id, horizontal ? { x: cursor, y: el.y } : { x: el.x, y: cursor });
    cursor += (horizontal ? el.w : el.h) + gap;
  }
  return out;
}

/**
 * New z values that make `members` contiguous just below the topmost member,
 * keeping everyone's relative order and reusing the existing z values (so objects
 * behind the placeholders stay behind them).
 */
export function groupZ(all: { id: string; z: number }[], members: Set<string>): Map<string, number> {
  const sorted = [...all].sort((a, b) => a.z - b.z);
  const zs = sorted.map((e) => e.z);
  const top = sorted.reduce((k, e, i) => (members.has(e.id) ? i : k), -1);
  if (top < 0) return new Map();
  const before = sorted.slice(0, top + 1).filter((e) => !members.has(e.id));
  const order = [...before, ...sorted.filter((e) => members.has(e.id)), ...sorted.slice(top + 1)];
  const out = new Map<string, number>();
  order.forEach((e, i) => e.z !== zs[i] && out.set(e.id, zs[i]));
  return out;
}

/** Angle (degrees, 0 = up, clockwise) from a centre to a pointer; Shift snaps to 15°. */
export function rotationFrom(cx: number, cy: number, px: number, py: number, snap15: boolean): number {
  let deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
  if (snap15) deg = Math.round(deg / 15) * 15;
  else {
    // a gentle pull towards the right angles, as in PowerPoint
    const near = Math.round(deg / 90) * 90;
    if (Math.abs(deg - near) < 3) deg = near;
  }
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

/** Where each object goes when the selection's bounds `from` are resized to `to` (positions and sizes scale together). */
export function resizedBoxes(elements: Positioned[], from: Box, to: Box): Map<string, Box> {
  const kx = from.w ? to.w / from.w : 1, ky = from.h ? to.h / from.h : 1;
  const r = (v: number) => Math.round(v * 10) / 10;
  return new Map(elements.map((e) => [e.id, { x: r(to.x + (e.x - from.x) * kx), y: r(to.y + (e.y - from.y) * ky), w: r(Math.max(1, e.w * kx)), h: r(Math.max(1, e.h * ky)) }]));
}

/** The selection's bounds while a handle is dragged: `handle` is the side(s) moving ("nw", "e", ...); `keep` keeps the proportions. */
export function dragBounds(b: Box, handle: string, dx: number, dy: number, keep: boolean, min = 8): Box {
  let { x, y, w, h } = b;
  if (handle.includes("e")) w = Math.max(min, b.w + dx);
  if (handle.includes("s")) h = Math.max(min, b.h + dy);
  if (handle.includes("w")) { w = Math.max(min, b.w - dx); x = b.x + b.w - w; }
  if (handle.includes("n")) { h = Math.max(min, b.h - dy); y = b.y + b.h - h; }
  if (keep && b.w && b.h) {
    const k = handle.length === 2 ? Math.max(w / b.w, h / b.h) : handle === "e" || handle === "w" ? w / b.w : h / b.h;
    w = Math.max(min, b.w * k);
    h = Math.max(min, b.h * k);
    if (handle.includes("w")) x = b.x + b.w - w;
    if (handle.includes("n")) y = b.y + b.h - h;
    if (handle === "e" || handle === "w") y = b.y + (b.h - h) / 2;
    if (handle === "n" || handle === "s") x = b.x + (b.w - w) / 2;
  }
  return { x, y, w, h };
}

type Grouped = { group?: string; sub?: string[] };
/** The groups that hold an object, outermost first. */
export const groupPath = (e: Grouped): string[] => (e.group ? [e.group, ...(e.sub || [])] : []);
/** Grouping objects (some of them groups already) into group `g`: their groups go inside it. */
export const groupedPatch = (e: Grouped, g: string): { group: string; sub: string[] | undefined } => {
  const path = groupPath(e);
  return { group: g, sub: path.length ? path : undefined };
};
/** Ungrouping: the outer group goes, the next one in (if any) becomes the outer group. */
export const ungroupedPatch = (e: Grouped): { group: string | undefined; sub: string[] | undefined } => {
  const [, next, ...rest] = groupPath(e);
  return { group: next, sub: next && rest.length ? rest : undefined };
};

/**
 * The groups of a slide as a tree, innermost first, each with its direct
 * members in stacking order: objects (by id) and the groups inside it (as
 * "group:<id>").
 */
export function groupTree(elements: (Grouped & { id: string; z: number })[]): { id: string; depth: number; members: string[] }[] {
  const map = new Map<string, { id: string; depth: number; members: string[]; z: number }>();
  for (const e of [...elements].sort((a, b) => a.z - b.z)) {
    const path = groupPath(e);
    path.forEach((g, d) => {
      let n = map.get(g);
      if (!n) map.set(g, (n = { id: g, depth: d, members: [], z: e.z }));
      const m = d === path.length - 1 ? e.id : `group:${path[d + 1]}`;
      if (!n.members.includes(m)) n.members.push(m);
    });
  }
  return [...map.values()].sort((a, b) => b.depth - a.depth || a.z - b.z).map(({ id, depth, members }) => ({ id, depth, members }));
}
