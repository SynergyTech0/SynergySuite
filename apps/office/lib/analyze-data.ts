// Analyze Data: suggested charts, pivot tables and insights for a table, the
// way Excel's Analyze Data pane offers them. Everything here is worked out
// locally from the values (no model needed); an AI model, when one is set up,
// only adds plainly worded insights on top (see lib/sheet-ai.ts).

export type Cell = string | number | boolean | null | undefined;
export type ColumnKind = "number" | "text" | "date" | "empty";

export type ColumnProfile = {
  index: number;
  name: string;
  kind: ColumnKind;
  count: number; // non-empty values
  distinct: number;
  /** Numbers only. */
  sum?: number;
  min?: number;
  max?: number;
  mean?: number;
  stdev?: number;
  /** Looks like a year, an ID or a running number: not something to add up. */
  identifier?: boolean;
};

export type ChartSuggestion = {
  kind: "chart";
  id: string;
  title: string;
  chartType: "column" | "bar" | "line" | "pie";
  /** Column offsets within the table. */
  category: number;
  values: number[];
};
export type PivotSuggestion = {
  kind: "pivot";
  id: string;
  title: string;
  rows: string[];
  values: { field: string; agg: "sum" | "count" | "average" }[];
  /** Also chart the pivot table. */
  chart?: "column" | "bar" | "line" | "pie";
};
export type Insight = { kind: "insight"; id: string; title: string; text: string };
export type Suggestion = ChartSuggestion | PivotSuggestion | Insight;

export type Analysis = { columns: ColumnProfile[]; rows: number; suggestions: Suggestion[] };

const isBlank = (v: Cell) => v === null || v === undefined || v === "";
const num = (v: Cell): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*-?[\d,]*\.?\d+(e-?\d+)?\s*%?\s*$/i.test(v)) {
    const n = Number(v.replace(/[,%\s]/g, ""));
    return Number.isFinite(n) ? (v.includes("%") ? n / 100 : n) : null;
  }
  return null;
};
const DATE_TEXT = /^(\d{4}-\d{1,2}(-\d{1,2})?|\d{1,2}\/\d{1,2}\/\d{2,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s+\d{2,4})?|q[1-4](\s+\d{4})?)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Human-sized numbers for insight text: 1,234 / 12.5 / 3.1M. */
export function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1000) return Math.round(n).toLocaleString("en-US");
  if (Number.isInteger(n)) return String(n);
  return String(+n.toFixed(a < 1 ? 3 : 2));
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function profileColumns(header: Cell[], rows: Cell[][]): ColumnProfile[] {
  return header.map((h, index) => {
    const name = isBlank(h) ? `Column ${index + 1}` : String(h).trim();
    const vals = rows.map((r) => r[index]).filter((v) => !isBlank(v));
    const nums = vals.map(num).filter((n): n is number => n !== null);
    const dates = vals.filter((v) => typeof v === "string" && DATE_TEXT.test(v.trim())).length;
    const distinct = new Set(vals.map((v) => String(v).trim().toLowerCase())).size;
    let kind: ColumnKind = "empty";
    if (vals.length) kind = nums.length >= vals.length * 0.8 ? "number" : dates >= vals.length * 0.8 ? "date" : "text";
    const p: ColumnProfile = { index, name, kind, count: vals.length, distinct };
    if (kind === "number" && nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const stdev = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, nums.length - 1));
      Object.assign(p, { sum, mean, stdev, min: Math.min(...nums), max: Math.max(...nums) });
      const ints = nums.every((n) => Number.isInteger(n));
      const yearish = ints && nums.every((n) => n >= 1900 && n <= 2100);
      const running = ints && distinct === nums.length && nums.length > 2 && nums.every((n, i) => i === 0 || n - nums[i - 1] === 1);
      const named = /\b(id|no|number|code|zip|year|phone)\b|#/i.test(name);
      p.identifier = yearish || running || (named && ints);
      // A year column reads as a timeline.
      if (yearish) p.kind = "date";
    }
    return p;
  });
}

/** Slope and fit (r²) of y against its position. */
export function trend(ys: number[]): { slope: number; r2: number } {
  const n = ys.length;
  if (n < 3) return { slope: 0, r2: 0 };
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  ys.forEach((y, x) => {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  });
  const slope = sxx ? sxy / sxx : 0;
  return { slope, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Totals of a numeric column by the values of a text column, largest first. */
export function totalsBy(rows: Cell[][], cat: number, val: number): { key: string; total: number }[] {
  const m = new Map<string, { key: string; total: number }>();
  for (const r of rows) {
    if (isBlank(r[cat])) continue;
    const n = num(r[val]);
    if (n === null) continue;
    const key = String(r[cat]).trim();
    const k = key.toLowerCase();
    const e = m.get(k) || { key, total: 0 };
    e.total += n;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** Values more than three robust deviations from the median (median absolute deviation). */
export function outliers(values: (number | null)[]): number[] {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 8) return [];
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const m = med(nums);
  const mad = med(nums.map((x) => Math.abs(x - m))) * 1.4826;
  if (!mad) return [];
  return values.flatMap((v, i) => (v !== null && Math.abs(v - m) / mad > 3.5 ? [i] : []));
}

const timeOrder = (v: Cell): number | null => {
  const n = num(v);
  if (n !== null) return n;
  const s = String(v ?? "").trim().toLowerCase();
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  const mo = MONTHS.indexOf(s.slice(0, 3));
  return mo >= 0 ? mo : null;
};
const ascending = (vals: Cell[]) => {
  const t = vals.map(timeOrder);
  return t.every((x) => x !== null) && t.every((x, i) => i === 0 || (x as number) >= (t[i - 1] as number));
};

/**
 * Suggestions for a table whose first row holds the column names. At most
 * `limit` of each kind, the most telling first.
 */
export function analyzeTable(table: Cell[][], limit = 4): Analysis {
  const header = table[0] || [];
  const rows = table.slice(1).filter((r) => r.some((v) => !isBlank(v)));
  const columns = profileColumns(header, rows);
  const out: Suggestion[] = [];
  if (rows.length < 2) return { columns, rows: rows.length, suggestions: out };
  const measures = columns.filter((c) => c.kind === "number" && !c.identifier && c.count >= rows.length * 0.6);
  const groups = columns.filter((c) => c.kind === "text" && c.distinct >= 2 && c.distinct <= Math.min(30, Math.max(2, rows.length - 1)));
  const labels = columns.filter((c) => (c.kind === "text" || c.kind === "date") && c.distinct === c.count && c.count === rows.length);
  const times = columns.filter((c) => c.kind === "date" || (c.kind === "text" && ascending(rows.map((r) => r[c.index])) && c.distinct === rows.length));
  const charts: ChartSuggestion[] = [];
  const pivots: PivotSuggestion[] = [];
  const insights: Insight[] = [];
  const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // A label per row: chart the values against it, over time as a line.
  const time = times.find((t) => t.distinct === rows.length);
  if (time && measures.length) {
    charts.push({ kind: "chart", id: id(`line-${time.name}`), title: `${measures.slice(0, 3).map((m) => m.name).join(", ")} over ${time.name}`, chartType: "line", category: time.index, values: measures.slice(0, 3).map((m) => m.index) });
  }
  for (const l of labels) {
    if (l === time || rows.length > 50) continue;
    for (const m of measures.slice(0, 2)) {
      const pie = rows.length <= 8 && (m.min ?? -1) >= 0;
      charts.push({ kind: "chart", id: id(`by-${l.name}-${m.name}`), title: `${m.name} by ${l.name}`, chartType: pie && charts.length ? "pie" : "column", category: l.index, values: [m.index] });
    }
  }
  // Repeated groups: a pivot table summing each measure by the group (and its chart).
  for (const g of groups) {
    if (g.distinct === rows.length) continue;
    for (const m of measures.slice(0, 1)) {
      pivots.push({ kind: "pivot", id: id(`pivot-${g.name}-${m.name}`), title: `Total ${m.name} by ${g.name}`, rows: [g.name], values: [{ field: m.name, agg: "sum" }], chart: g.distinct <= 6 && (m.min ?? -1) >= 0 ? "pie" : g.distinct <= 12 ? "column" : "bar" });
    }
    if (!measures.length) pivots.push({ kind: "pivot", id: id(`count-${g.name}`), title: `Count of rows by ${g.name}`, rows: [g.name], values: [{ field: g.name, agg: "count" }], chart: "column" });
  }
  // Two groups: a cross tab of the first measure.
  if (groups.length >= 2 && measures.length) {
    const [a, b] = [...groups].filter((g) => g.distinct < rows.length).sort((x, y) => x.distinct - y.distinct);
    if (a && b) pivots.push({ kind: "pivot", id: id(`pivot-${b.name}-${a.name}-${measures[0].name}`), title: `${measures[0].name} by ${b.name} and ${a.name}`, rows: [b.name, a.name], values: [{ field: measures[0].name, agg: "sum" }] });
  }

  // Insights.
  for (const g of groups) {
    for (const m of measures.slice(0, 2)) {
      const t = totalsBy(rows, g.index, m.index);
      const all = t.reduce((a, b) => a + b.total, 0);
      if (t.length < 2 || all <= 0 || t.some((x) => x.total < 0)) continue;
      const share = t[0].total / all;
      if (share >= 1.5 / t.length)
        insights.push({ kind: "insight", id: id(`top-${g.name}-${m.name}`), title: `${t[0].key} leads ${m.name}`, text: `${t[0].key} has the most ${m.name} (${fmt(t[0].total)}), ${pct(share)} of the total across ${t.length} ${g.name} values.` });
    }
  }
  const ordered = time;
  for (const m of measures.slice(0, 3)) {
    const ys = rows.map((r) => num(r[m.index]));
    if (ordered && ys.every((y) => y !== null) && ys.length >= 4) {
      const { slope, r2 } = trend(ys as number[]);
      const first = ys[0] as number;
      const last = ys[ys.length - 1] as number;
      if (r2 >= 0.6 && slope)
        insights.push({ kind: "insight", id: id(`trend-${m.name}`), title: `${m.name} is ${slope > 0 ? "rising" : "falling"}`, text: `${m.name} ${slope > 0 ? "rises" : "falls"} steadily over ${ordered.name}, from ${fmt(first)} to ${fmt(last)}${first ? ` (${slope > 0 ? "+" : ""}${pct((last - first) / Math.abs(first))})` : ""}.` });
    }
    const odd = outliers(ys);
    if (odd.length && odd.length <= Math.max(1, rows.length * 0.05)) {
      const lbl = labels[0] || groups[0];
      const names = odd.slice(0, 3).map((i) => (lbl ? `${rows[i][lbl.index]} (${fmt(ys[i] as number)})` : `row ${i + 2} (${fmt(ys[i] as number)})`));
      insights.push({ kind: "insight", id: id(`outlier-${m.name}`), title: `Unusual ${m.name}`, text: `${names.join(", ")} ${odd.length === 1 ? "stands" : "stand"} out from the other ${m.name} values (typical: ${fmt(m.mean ?? 0)}).` });
    }
  }
  for (let i = 0; i < measures.length; i++)
    for (let j = i + 1; j < measures.length; j++) {
      const a = measures[i];
      const b = measures[j];
      const pairs = rows.map((r) => [num(r[a.index]), num(r[b.index])]).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
      if (pairs.length < 5) continue;
      const r = correlation(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
      if (Math.abs(r) >= 0.8) insights.push({ kind: "insight", id: id(`corr-${a.name}-${b.name}`), title: `${a.name} and ${b.name} move together`, text: `${a.name} and ${b.name} are ${r > 0 ? "strongly correlated" : "strongly inversely correlated"} (r = ${r.toFixed(2)}).` });
    }
  if (!insights.length && measures.length) {
    const m = measures[0];
    insights.push({ kind: "insight", id: id(`summary-${m.name}`), title: `${m.name} at a glance`, text: `${m.name} totals ${fmt(m.sum ?? 0)} over ${m.count} rows, averaging ${fmt(m.mean ?? 0)} (from ${fmt(m.min ?? 0)} to ${fmt(m.max ?? 0)}).` });
  }

  // One of each kind of insight before a second of any.
  const kindOf = (x: Insight) => x.id.split("-")[0];
  const rank = new Map<string, number>();
  const spread = insights.map((x, i) => {
    const k = rank.get(kindOf(x)) ?? 0;
    rank.set(kindOf(x), k + 1);
    return { x, k, i };
  });
  insights.splice(0, insights.length, ...spread.sort((a, b) => a.k - b.k || a.i - b.i).map((e) => e.x));
  const seen = new Set<string>();
  const uniq = <T extends Suggestion>(xs: T[]) => xs.filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, limit);
  out.push(...uniq(insights), ...uniq(charts), ...uniq(pivots));
  return { columns, rows: rows.length, suggestions: out };
}

/** A short description of the table for a model: column profiles and a sample of rows. */
export function describeTable(table: Cell[][], maxRows = 30): string {
  const header = table[0] || [];
  const rows = table.slice(1);
  const cols = profileColumns(header, rows);
  const lines = cols.map((c) =>
    c.kind === "number" ? `- ${c.name}: number, ${c.count} values, sum ${fmt(c.sum ?? 0)}, mean ${fmt(c.mean ?? 0)}, min ${fmt(c.min ?? 0)}, max ${fmt(c.max ?? 0)}` : `- ${c.name}: ${c.kind}, ${c.count} values, ${c.distinct} distinct`,
  );
  const sample = rows.slice(0, maxRows).map((r) => header.map((_, i) => String(r[i] ?? "").slice(0, 40)).join(" | "));
  return `Columns (${rows.length} rows):\n${lines.join("\n")}\n\nFirst rows:\n${header.map((h) => String(h ?? "")).join(" | ")}\n${sample.join("\n")}`;
}
