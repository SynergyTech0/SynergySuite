/**
 * Reports, as in Access: the records of a table or query laid out for reading and printing, in
 * groups (by value, or by year, quarter, month or first letter) with totals under each group and
 * at the end. Everything here is pure, so the browser, the print page and the tests share it.
 */
import type { ColumnKind } from "./sql";

export const TOTALS = ["sum", "avg", "count", "min", "max"] as const;
export type TotalFn = (typeof TOTALS)[number];
export const TOTAL_LABELS: Record<TotalFn, string> = { sum: "Sum", avg: "Average", count: "Count", min: "Min", max: "Max" };

export const FORMATS = ["auto", "currency", "whole", "decimal", "percent", "date", "text"] as const;
export type Format = (typeof FORMATS)[number];

export const GROUP_BY = ["value", "year", "quarter", "month", "letter"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export type ReportColumnDef = { name: string; label?: string; format?: Format; total?: TotalFn };
export type ReportGroupDef = { column: string; by?: GroupBy; dir?: "asc" | "desc"; totals?: boolean };
export type ReportSortDef = { column: string; dir?: "asc" | "desc" };

export type ReportLayout = {
  title?: string;
  /** The source's columns shown as details, in order; none means all of them. */
  columns: ReportColumnDef[];
  groups: ReportGroupDef[];
  sort: ReportSortDef[];
  landscape: boolean;
  /** Show only the group headers and totals, not each record (Access's "Summary Only"). */
  summaryOnly: boolean;
  currencyCode?: string;
};

export const MAX_GROUPS = 4;

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const pick = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);
const dir = (v: unknown): "desc" | undefined => (v === "desc" ? "desc" : undefined);

/** Keeps the known parts of a layout from the browser. */
export function cleanReportLayout(input: unknown): ReportLayout {
  const d = (input ?? {}) as Record<string, any>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((x: any) => typeof x?.column === "string" || typeof x?.name === "string");
  const seen = new Set<string>();
  const columns = list(d.columns)
    .filter((c: any) => typeof c.name === "string" && !seen.has(c.name) && seen.add(c.name))
    .slice(0, 100)
    .map((c: any) => ({ name: c.name.slice(0, 64), label: str(c.label, 100), format: c.format === "auto" ? undefined : pick(c.format, FORMATS), total: pick(c.total, TOTALS) }));
  const groups = list(d.groups)
    .filter((g: any) => typeof g.column === "string")
    .slice(0, MAX_GROUPS)
    .map((g: any) => ({ column: g.column.slice(0, 64), by: g.by === "value" ? undefined : pick(g.by, GROUP_BY), dir: dir(g.dir), totals: g.totals === false ? false : undefined }));
  const sort = list(d.sort)
    .filter((s: any) => typeof s.column === "string")
    .slice(0, 10)
    .map((s: any) => ({ column: s.column.slice(0, 64), dir: dir(s.dir) }));
  const code = typeof d.currencyCode === "string" && /^[A-Z]{3}$/.test(d.currencyCode) ? d.currencyCode : undefined;
  return { title: str(d.title, 200), columns, groups, sort, landscape: d.landscape === true, summaryOnly: d.summaryOnly === true, currencyCode: code };
}

/** A source column with what the report needs to show it. */
export type SourceColumn = { name: string; kind: ColumnKind; /** From the table's field type, when the source is a table. */ format?: Format };

export type ShownColumn = { index: number; name: string; label: string; kind: ColumnKind; format: Format; total?: TotalFn };

export type ReportGroup = {
  /** The grouping value as shown ("March 2026", "A", "Leeds"). */
  label: string;
  count: number;
  /** One per shown column; null where the column has no total. */
  totals: (string | null)[];
  groups?: ReportGroup[];
  rows?: string[][];
};

export type ReportData = {
  title: string;
  columns: ShownColumn[];
  /** The group levels, outermost first, with their headings. */
  levels: { label: string; totals: boolean }[];
  body: ReportGroup;
  truncated: boolean;
  /** Layout entries naming columns the source no longer has. */
  missing: string[];
  /** Every column of the source, for Design view. */
  source: SourceColumn[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function compare(a: unknown, b: unknown, kind: ColumnKind): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1; // empty last
  if (b === null || b === undefined) return -1;
  if (kind === "number") return (num(a) ?? 0) - (num(b) ?? 0);
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** The key a record falls under for a group level, and its label. */
function groupKey(v: unknown, by: GroupBy | undefined, kind: ColumnKind, format: Format, currency: string): { key: unknown; label: string } {
  if (v === null || v === undefined || v === "") return { key: null, label: "(Blank)" };
  const s = String(v);
  if ((by === "year" || by === "quarter" || by === "month") && /^\d{4}-\d{2}/.test(s)) {
    const y = s.slice(0, 4);
    const m = Number(s.slice(5, 7));
    if (by === "year") return { key: y, label: y };
    if (by === "quarter") return { key: `${y}-${Math.ceil(m / 3)}`, label: `Q${Math.ceil(m / 3)} ${y}` };
    return { key: s.slice(0, 7), label: `${MONTHS[m - 1]} ${y}` };
  }
  if (by === "letter") {
    const c = s.trim().charAt(0).toUpperCase();
    return { key: c, label: c || "(Blank)" };
  }
  return { key: v, label: formatValue(v, kind, format, currency) };
}

/** The format used for a column: the layout's, else the table field's, else from the values' kind. */
function formatOf(def: ReportColumnDef | undefined, src: SourceColumn): Format {
  return def?.format ?? src.format ?? (src.kind === "date" ? "date" : "auto");
}

/** A value as the report shows it. */
export function formatValue(v: unknown, kind: ColumnKind, format: Format, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "boolean" || kind === "yesno") return v === true || v === "true" ? "Yes" : "No";
  const n = num(v);
  switch (format) {
    case "currency":
      if (n === null) return String(v);
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
      } catch {
        return n.toFixed(2);
      }
    case "whole":
      return n === null ? String(v) : Math.round(n).toLocaleString("en-US");
    case "decimal":
      return n === null ? String(v) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "percent":
      return n === null ? String(v) : `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "date": {
      const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(v);
    }
    case "text":
      return String(v);
    default:
      if (kind === "datetime" && !Number.isNaN(Date.parse(String(v)))) return new Date(String(v)).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
      if (kind === "number" && n !== null) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
      return String(v);
  }
}

function total(fn: TotalFn, values: unknown[], c: ShownColumn, currency: string): string {
  if (fn === "count") return values.filter((v) => v !== null && v !== undefined && v !== "").length.toLocaleString("en-US");
  const ns = values.map(num).filter((n): n is number => n !== null);
  if (fn === "min" || fn === "max") {
    // Min and Max also work on text and dates, by the column's own order.
    const present = values.filter((v) => v !== null && v !== undefined && v !== "");
    if (!present.length) return "";
    const sorted = [...present].sort((a, b) => compare(a, b, c.kind));
    return formatValue(fn === "min" ? sorted[0] : sorted[sorted.length - 1], c.kind, c.format, currency);
  }
  if (!ns.length) return "";
  const sum = ns.reduce((a, b) => a + b, 0);
  const value = fn === "sum" ? sum : sum / ns.length;
  // An average of whole numbers usually isn't whole.
  const format = fn === "avg" && (c.format === "whole" || c.format === "auto") ? "decimal" : c.format;
  return formatValue(Math.round(value * 1e6) / 1e6, "number", format, currency);
}

/**
 * Lays out a source's records as a report: groups nested by the layout's levels, records sorted
 * within them, and totals for each group and for the whole report.
 */
export function buildReport(name: string, source: SourceColumn[], rows: unknown[][], layout: ReportLayout, truncated = false): ReportData {
  const currency = layout.currencyCode ?? "USD";
  const index = new Map(source.map((c, i) => [c.name.toLowerCase(), i]));
  const at = (column: string) => index.get(column.toLowerCase());
  const missing = [...layout.columns.map((c) => c.name), ...layout.groups.map((g) => g.column), ...layout.sort.map((s) => s.column)].filter((n) => at(n) === undefined);
  const groups = layout.groups.filter((g) => at(g.column) !== undefined);
  // A column grouped by its value shows in its group's heading, not on every record; one grouped
  // by month or first letter still differs from record to record, so it stays.
  const grouped = new Set(groups.filter((g) => !g.by || g.by === "value").map((g) => at(g.column)!));
  const defs = layout.columns.length ? layout.columns.filter((c) => at(c.name) !== undefined) : source.map((c) => ({ name: c.name }) as ReportColumnDef);
  const columns: ShownColumn[] = defs
    .map((d) => {
      const i = at(d.name)!;
      return { index: i, name: source[i].name, label: d.label ?? source[i].name, kind: source[i].kind, format: formatOf(d, source[i]), total: d.total };
    })
    .filter((c) => !grouped.has(c.index));
  const sortKeys = layout.sort.filter((s) => at(s.column) !== undefined).map((s) => ({ i: at(s.column)!, desc: s.dir === "desc" }));

  const totalsOf = (rs: unknown[][]) => columns.map((c) => (c.total ? total(c.total, rs.map((r) => r[c.index]), c, currency) : null));

  const build = (label: string, rs: unknown[][], level: number): ReportGroup => {
    const g: ReportGroup = { label, count: rs.length, totals: totalsOf(rs) };
    if (level < groups.length) {
      const def = groups[level];
      const i = at(def.column)!;
      const src = source[i];
      const fmt = formatOf(layout.columns.find((c) => c.name.toLowerCase() === def.column.toLowerCase()), src);
      const buckets = new Map<unknown, { label: string; first: unknown; rows: unknown[][] }>();
      for (const r of rs) {
        const { key, label: l } = groupKey(r[i], def.by, src.kind, fmt, currency);
        const k = key === null ? null : typeof key === "object" ? JSON.stringify(key) : key;
        const b = buckets.get(k) ?? { label: l, first: key, rows: [] };
        b.rows.push(r);
        buckets.set(k, b);
      }
      const kind = def.by && def.by !== "value" && def.by !== "letter" ? "text" : src.kind;
      const ordered = [...buckets.values()].sort((a, b) => {
        // Blank groups go last either way.
        if (a.first === null || b.first === null) return compare(a.first, b.first, kind);
        return (def.dir === "desc" ? -1 : 1) * compare(a.first, b.first, kind);
      });
      g.groups = ordered.map((b) => build(b.label, b.rows, level + 1));
    } else if (!layout.summaryOnly) {
      const sorted = sortKeys.length
        ? [...rs].sort((a, b) => {
            for (const k of sortKeys) {
              const d = compare(a[k.i], b[k.i], source[k.i].kind);
              if (d) return k.desc && a[k.i] !== null && b[k.i] !== null ? -d : d;
            }
            return 0;
          })
        : rs;
      g.rows = sorted.map((r) => columns.map((c) => formatValue(r[c.index], c.kind, c.format, currency)));
    }
    return g;
  };

  return {
    title: layout.title ?? name,
    columns,
    levels: groups.map((g) => ({ label: layout.columns.find((c) => c.name.toLowerCase() === g.column.toLowerCase())?.label ?? source[at(g.column)!].name, totals: g.totals !== false })),
    body: build("", rows, 0),
    truncated,
    missing,
    source,
  };
}

/** Whether a column's values line up on the right. */
export const rightAligned = (c: Pick<ShownColumn, "kind" | "format">) => c.kind === "number" || ["currency", "whole", "decimal", "percent"].includes(c.format);
