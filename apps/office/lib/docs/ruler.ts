// The horizontal ruler: where the margins, indents and tab stops of the
// cursor's paragraph sit on the page, and what dragging each marker does.
// All positions are points from the page's left edge.
import type { Section } from "./model";
import type { TabStop } from "./para-format";

export type Indents = { left: number; right: number; first: number };
export type RulerMarks = {
  pageWidth: number;
  /** the text area: left and right margin edges */
  textLeft: number;
  textRight: number;
  /** first-line, hanging (left) and right indent markers */
  first: number;
  left: number;
  right: number;
  tabs: { at: number; stop: TabStop }[];
};
export type RulerHandle = "marginLeft" | "marginRight" | "first" | "hanging" | "leftBox" | "right" | `tab:${number}`;

/** 1/16 inch, the step Word's ruler snaps to. */
export const RULER_STEP = 4.5;
export const snap = (pt: number, step = RULER_STEP) => Math.round(pt / step) * step;

/** The left and right margins of a page, inside margin and gutter swapped to the right on even pages when margins are mirrored. */
export function pageMargins(s: Section, mirrored: boolean): { left: number; right: number } {
  const inside = s.margins.left + (s.margins.gutter || 0);
  return mirrored ? { left: s.margins.right, right: inside } : { left: inside, right: s.margins.right };
}

export function rulerMarks(s: Section, ind: Indents, tabs: TabStop[], mirrored = false): RulerMarks {
  const m = pageMargins(s, mirrored);
  const textLeft = m.left;
  const textRight = s.pageWidth - m.right;
  return {
    pageWidth: s.pageWidth,
    textLeft,
    textRight,
    left: textLeft + ind.left,
    first: textLeft + ind.left + ind.first,
    right: textRight - ind.right,
    tabs: tabs.map((stop) => ({ at: textLeft + stop.pos, stop })),
  };
}

/** Ruler numbers: whole inches (or centimetres) counted from the left margin, negative into the margin as Word shows them. */
export function rulerTicks(marks: RulerMarks, unit: "in" | "cm" = "in"): { at: number; label?: string; major: boolean }[] {
  const step = unit === "in" ? 72 / 8 : 72 / 2.54 / 4;
  const per = unit === "in" ? 8 : 4;
  const out: { at: number; label?: string; major: boolean }[] = [];
  const n0 = Math.ceil(-marks.textLeft / step);
  const n1 = Math.floor((marks.pageWidth - marks.textLeft) / step);
  for (let n = n0; n <= n1; n++) {
    const at = marks.textLeft + n * step;
    const major = n % per === 0;
    out.push({ at, major, ...(major && n !== 0 ? { label: String(Math.abs(n / per)) } : {}) });
  }
  return out;
}

/**
 * New paragraph indents after dragging a marker by `dx` points (snapped).
 * first: the first line only; hanging: the left indent, the first line stays put;
 * leftBox: the left indent with the first line moving along; right: the right indent.
 */
export function dragIndents(start: Indents, handle: "first" | "hanging" | "leftBox" | "right", dx: number, marks: RulerMarks): Indents {
  const width = marks.textRight - marks.textLeft;
  const clampL = (v: number) => Math.max(-marks.textLeft, Math.min(v, width - 18));
  const d = snap(dx);
  const out = { ...start };
  if (handle === "first") out.first = clampL(start.left + start.first + d) - start.left;
  else if (handle === "hanging") {
    out.left = clampL(start.left + d);
    out.first = start.left + start.first - out.left;
  } else if (handle === "leftBox") out.left = clampL(start.left + d);
  else out.right = Math.max(-(marks.pageWidth - marks.textRight), Math.min(start.right - d, width - 18 - start.left));
  return out;
}

/** New page margins after dragging a margin edge by `dx` points; the text keeps at least an inch. */
export function dragMargins(s: Section, edge: "marginLeft" | "marginRight", dx: number, mirrored = false): Section["margins"] {
  const d = snap(dx);
  const m = { ...s.margins };
  // on a mirrored even page the left edge on screen is the outside (right) margin
  const key: "left" | "right" = (edge === "marginLeft") !== mirrored ? "left" : "right";
  const sign = edge === "marginLeft" ? 1 : -1;
  const other = key === "left" ? m.right : m.left;
  const max = s.pageWidth - other - (m.gutter || 0) - 72;
  m[key] = Math.max(0, Math.min(max, m[key] + sign * d));
  return m;
}

/** Tab stops after a click on the ruler (adds a stop), a drag (moves it) or a drag off the ruler (removes it). */
export function addTab(tabs: TabStop[], pos: number, align: TabStop["align"] = "left"): TabStop[] {
  const p = snap(pos);
  if (p <= 0 || tabs.some((t) => Math.abs(t.pos - p) < 1)) return tabs;
  return [...tabs, { pos: p, align }].sort((a, b) => a.pos - b.pos);
}
export function moveTab(tabs: TabStop[], index: number, pos: number | null): TabStop[] {
  if (pos === null) return tabs.filter((_, i) => i !== index);
  const p = Math.max(0, snap(pos));
  return tabs
    .map((t, i) => (i === index ? { ...t, pos: p } : t))
    .filter((t, i) => i === index || Math.abs(t.pos - p) >= 1)
    .sort((a, b) => a.pos - b.pos);
}
/** Word's tab selector order. */
export const TAB_KINDS: TabStop["align"][] = ["left", "center", "right", "decimal"];
