// Slicers and timelines: buttons over the grid that filter a table or a pivot
// table by one field. A slicer picks values; a timeline picks a run of
// periods (years, quarters, months or days) of a date field. They are
// floating DOM drawings whose data holds the source, the field and what is
// picked; picking sets the table's column filter or the pivot's field filter.
import { compareKeys, keyText } from "./pivot.ts";

export const SLICER_COMPONENT = "SynergySlicer";

export type SlicerSource = { type: "table"; tableId: string; name: string } | { type: "pivot"; pivotId: string; name: string };
export type TimeLevel = "years" | "quarters" | "months" | "days";
export type SlicerData = {
  kind: "slicer" | "timeline";
  caption: string;
  source: SlicerSource;
  field: string;
  /** Slicer: the picked values (as shown), or null for all. */
  selected?: string[] | null;
  /** Timeline: the picked periods (first and last key), or null for all. */
  period?: { from: string; to: string } | null;
  level?: TimeLevel;
  /** Slicer: buttons per row. */
  columns?: number;
};

export type SlicerItem = { key: string; label: string; selected: boolean };

/** The slicer's buttons: each distinct value, sorted like the pivot table sorts them. */
export function slicerItems(values: unknown[], selected: string[] | null | undefined): SlicerItem[] {
  const keys = [...new Set(values.map(keyText))].sort(compareKeys);
  const on = selected ? new Set(selected) : null;
  return keys.map((key) => ({ key, label: key, selected: !on || on.has(key) }));
}

/** Clicking a button: alone it picks just that value (or all again); with Ctrl it adds or removes it. */
export function toggleItem(items: SlicerItem[], key: string, multi: boolean): string[] | null {
  const all = items.map((i) => i.key);
  const picked = items.filter((i) => i.selected).map((i) => i.key);
  let next: string[];
  if (!multi) next = picked.length === 1 && picked[0] === key ? all : [key];
  else if (picked.length === all.length) next = all.filter((k) => k !== key);
  else next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
  if (!next.length) return [key];
  return next.length === all.length ? null : all.filter((k) => next.includes(k));
}

// ---- Dates -------------------------------------------------------------------

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;

/** A cell value as a date (UTC): Excel serial numbers and ISO-like text. */
export function asDate(v: unknown): Date | null {
  if (typeof v === "number" && v >= 1 && v < 2958466) return new Date(EXCEL_EPOCH + Math.floor(v) * DAY);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const d = new Date(v.trim().slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
export const toSerial = (d: Date) => Math.round((d.getTime() - EXCEL_EPOCH) / DAY);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export type Period = { key: string; label: string; group: string; start: Date; end: Date };

/** The period a date falls in, at a level. */
export function periodOf(d: Date, level: TimeLevel): Period {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (level === "years") return { key: `${y}`, label: `${y}`, group: "", start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1) - 1) };
  if (level === "quarters") {
    const q = Math.floor(m / 3);
    return { key: `${y}-Q${q + 1}`, label: `Q${q + 1}`, group: `${y}`, start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 1) - 1) };
  }
  if (level === "months") return { key: `${y}-${pad(m + 1)}`, label: MONTHS[m], group: `${y}`, start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1) - 1) };
  const day = d.getUTCDate();
  return { key: `${y}-${pad(m + 1)}-${pad(day)}`, label: `${day}`, group: `${MONTHS[m]} ${y}`, start: new Date(Date.UTC(y, m, day)), end: new Date(Date.UTC(y, m, day + 1) - 1) };
}

/** Every period from the first date to the last (gaps included, as Excel's timeline shows them). */
export function timelinePeriods(values: unknown[], level: TimeLevel): Period[] {
  const dates = values.map(asDate).filter((d): d is Date => !!d);
  if (!dates.length) return [];
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  const out: Period[] = [];
  for (let p = periodOf(min, level); p.start.getTime() <= max.getTime() && out.length < 2000; p = periodOf(new Date(p.end.getTime() + 1), level)) out.push(p);
  return out;
}

/** The date range a timeline's pick covers, or null for all. */
export function timelineRange(data: Pick<SlicerData, "period" | "level">): { start: Date; end: Date } | null {
  if (!data.period) return null;
  const level = data.level || "months";
  const parse = (key: string): Date | null => {
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})$/.exec(key))) return new Date(Date.UTC(+m[1], 0, 1));
    if ((m = /^(\d{4})-Q([1-4])$/.exec(key))) return new Date(Date.UTC(+m[1], (+m[2] - 1) * 3, 1));
    if ((m = /^(\d{4})-(\d{2})$/.exec(key))) return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key))) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return null;
  };
  const a = parse(data.period.from);
  const b = parse(data.period.to);
  if (!a || !b) return null;
  const [lo, hi] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  return { start: periodOf(lo, level).start, end: periodOf(hi, level).end };
}

/** Clicking a period: alone it picks that period; with Shift it stretches the pick to it. */
export function pickPeriod(current: SlicerData["period"], key: string, extend: boolean): { from: string; to: string } {
  if (extend && current) return { from: current.from, to: key };
  return { from: key, to: key };
}

// ---- What a pick filters -------------------------------------------------------

/** True when a value passes the slicer or timeline. */
export function passes(data: SlicerData, v: unknown): boolean {
  if (data.kind === "timeline") {
    const r = timelineRange(data);
    if (!r) return true;
    const d = asDate(v);
    return !!d && d.getTime() >= r.start.getTime() && d.getTime() <= r.end.getTime();
  }
  return !data.selected || data.selected.includes(keyText(v));
}

export const TABLE_EMPTY = "__UNIVER_TABLE_FILTER_EMPTY__";

/** The table column filter for a pick (undefined clears it). `values` is the column's data. */
export function tableFilter(data: SlicerData, values: unknown[]): unknown {
  if (data.kind === "timeline") {
    const r = timelineRange(data);
    if (!r) return undefined;
    return { filterType: "condition", filterInfo: { conditionType: "date", compareType: "between", expectedValue: [r.start.toISOString(), r.end.toISOString()] } };
  }
  if (!data.selected) return undefined;
  const keep = new Set<unknown>();
  for (const v of values) if (passes(data, v)) keep.add(v == null || v === "" ? TABLE_EMPTY : v);
  return { filterType: "manual", values: [...keep] };
}

/** The values a pivot's field filter leaves out for a pick. */
export function pivotExclude(data: SlicerData, values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) if (!passes(data, v)) out.add(keyText(v));
  return [...out].sort(compareKeys);
}
