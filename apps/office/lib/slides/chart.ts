// Chart maths shared by the renderer and the .pptx/.odp writers: value-axis
// ticks (automatic "nice" steps or the user's min/max/unit), Excel-style
// number formats for axis and data labels, and trendline fitting.
import type { ChartAxis, Trendline } from "./model";

export type AxisScale = { lo: number; hi: number; step: number; ticks: number[]; minor: number[] };

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const clean = (v: number) => Number(v.toPrecision(12));

/** A "nice" step near range / ticks: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(range: number, ticks = 5): number {
  const raw = Math.abs(range) / ticks || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999) || raw;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Axis bounds and tick positions for data in [min, max]. Fixed bounds and a
 * fixed major unit win; anything left automatic is rounded to the step, as
 * PowerPoint does. At most 200 ticks are produced.
 */
export function axisScale(min: number, max: number, ax: ChartAxis = {}, ticks = 5): AxisScale {
  let lo = finite(ax.min) ? ax.min : min;
  let hi = finite(ax.max) ? ax.max : max;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) hi = lo + (finite(ax.major) && ax.major > 0 ? ax.major : 1);
  let step = finite(ax.major) && ax.major > 0 ? ax.major : niceStep(hi - lo, ticks);
  if ((hi - lo) / step > 200) step = niceStep(hi - lo, 200);
  if (!finite(ax.min)) lo = Math.floor(clean(lo / step)) * step;
  if (!finite(ax.max)) hi = Math.ceil(clean(hi / step)) * step;
  lo = clean(lo);
  hi = clean(hi);
  const out: number[] = [];
  for (let v = lo; v <= hi + step * 1e-9 && out.length < 201; v += step) out.push(clean(finite(ax.min) ? v : roundTo(v, step)));
  const minorStep = finite(ax.minor) && ax.minor > 0 ? ax.minor : step / 5;
  const minor: number[] = [];
  if (ax.minorGrid && (hi - lo) / minorStep <= 1000) for (let v = lo; v <= hi + minorStep * 1e-9; v += minorStep) minor.push(clean(v));
  return { lo, hi, step, ticks: out, minor };
}

/** Number formats offered in the chart pane (Excel format codes). */
export const NUMBER_FORMATS: { code: string; label: string }[] = [
  { code: "General", label: "General" },
  { code: "0", label: "Number (0)" },
  { code: "0.0", label: "Number (0.0)" },
  { code: "0.00", label: "Number (0.00)" },
  { code: "#,##0", label: "Thousands (1,234)" },
  { code: "#,##0.00", label: "Thousands (1,234.00)" },
  { code: "0%", label: "Percent (12%)" },
  { code: "0.0%", label: "Percent (12.3%)" },
  { code: "$#,##0", label: "Currency ($1,234)" },
  { code: "$#,##0.00", label: "Currency ($1,234.00)" },
  { code: "€#,##0", label: "Currency (€1,234)" },
  { code: "0.00E+00", label: "Scientific (1.23E+03)" },
];

const generalFmt = (v: number) => String(Number(v.toFixed(2)));

/**
 * Format a number with an Excel number format code: literal prefix/suffix
 * text, decimals (0 and #), thousands separators, percent and scientific
 * notation. The first section is used (the second, if any, for negatives).
 */
export function formatNumber(v: number, code?: string): string {
  if (!Number.isFinite(v)) return "";
  if (!code || /^general$/i.test(code.trim())) return generalFmt(v);
  const sections = splitSections(code);
  let sec = sections[0];
  let neg = v < 0;
  if (neg && sections[1] !== undefined) {
    sec = sections[1];
    v = -v;
    neg = false;
  }
  // [$€-407] -> €, other bracketed codes ([Red], [>100]) are dropped
  sec = sec.replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, (_, sym: string) => (sym ? `"${sym}"` : "")).replace(/\[[^\]]*\]/g, "");
  const tokens: { lit: boolean; s: string }[] = [];
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    if (ch === '"') {
      const j = sec.indexOf('"', i + 1);
      tokens.push({ lit: true, s: sec.slice(i + 1, j < 0 ? undefined : j) });
      i = j < 0 ? sec.length : j;
    } else if (ch === "\\" && i + 1 < sec.length) tokens.push({ lit: true, s: sec[++i] });
    else if (ch === "_" && i + 1 < sec.length) {
      tokens.push({ lit: true, s: " " });
      i++;
    } else if (ch === "*") i++;
    else tokens.push({ lit: false, s: ch });
  }
  const isNum = (t: { lit: boolean; s: string }) => !t.lit && /[0#?.,]/.test(t.s);
  const first = tokens.findIndex(isNum);
  if (first < 0) return tokens.map((t) => t.s).join("").replace(/@/g, generalFmt(v));
  let last = first;
  for (let i = first; i < tokens.length; i++) {
    if (isNum(tokens[i]) || (!tokens[i].lit && /[Ee]/.test(tokens[i].s) && /^[+-]$/.test(tokens[i + 1]?.s || ""))) last = i;
    else if (!tokens[i].lit && /^[+-]$/.test(tokens[i].s) && /[Ee]/.test(tokens[i - 1]?.s || "")) last = i;
    else break;
  }
  const core = tokens.slice(first, last + 1).map((t) => t.s).join("");
  const prefix = tokens.slice(0, first).map((t) => t.s).join("");
  const suffix = tokens.slice(last + 1).map((t) => t.s).join("");
  const pct = (prefix + suffix).split("").filter((c) => c === "%").length;
  let x = Math.abs(v) * 100 ** pct;
  const [mant, expo] = core.split(/[Ee][+-]?/);
  const [intPart, decPart = ""] = mant.split(".");
  // trailing commas scale by thousands
  const scale = (intPart.match(/,+$/)?.[0].length || 0);
  x /= 1000 ** scale;
  const maxDec = (decPart.match(/[0#?]/g) || []).length;
  const minDec = (decPart.match(/0/g) || []).length;
  let body: string;
  if (expo !== undefined) {
    const e = x === 0 ? 0 : Math.floor(Math.log10(x));
    const m = x / 10 ** e;
    const ms = trimDec(m.toFixed(maxDec), minDec);
    const digits = Math.max(1, (expo.match(/0/g) || []).length);
    body = `${ms}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(digits, "0")}`;
  } else {
    let s = trimDec(x.toFixed(maxDec), minDec);
    let [ip, dp] = s.split(".");
    const minInt = (intPart.replace(/,/g, "").match(/0/g) || []).length;
    if (ip === "0" && minInt === 0) ip = dp ? "" : "0";
    ip = ip.padStart(minInt, "0");
    if (/,/.test(intPart.replace(/,+$/, ""))) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    s = dp ? `${ip}.${dp}` : ip;
    body = s || "0";
  }
  const zero = Number(body.replace(/[^\d.]/g, "")) === 0;
  return `${neg && !zero ? "-" : ""}${prefix}${body}${suffix}`;
}

function trimDec(s: string, minDec: number): string {
  if (!s.includes(".")) return s;
  let [i, d] = s.split(".");
  while (d.length > minDec && d.endsWith("0")) d = d.slice(0, -1);
  return d ? `${i}.${d}` : i;
}

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of code) {
    if (ch === '"') q = !q;
    if (ch === ";" && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export const TRENDLINE_TYPES: { id: Trendline["type"]; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "exp", label: "Exponential" },
  { id: "log", label: "Logarithmic" },
  { id: "poly", label: "Polynomial" },
  { id: "power", label: "Power" },
  { id: "movingAvg", label: "Moving average" },
];

export type TrendFit = {
  /** the fitted curve (absent for a moving average) */
  f?: (x: number) => number;
  /** a moving average's points */
  points?: [number, number][];
  eq?: string;
  r2?: number;
};

const n4 = (v: number) => String(Number(v.toPrecision(4)));
const term = (c: number, first: boolean) => (first ? n4(c) : `${c < 0 ? "−" : "+"} ${n4(Math.abs(c))}`);

/** Least-squares polynomial coefficients c0..ck (Gaussian elimination on the normal equations). */
function polyFit(xs: number[], ys: number[], k: number): number[] | null {
  const m = k + 1;
  const A = Array.from({ length: m }, (_, r) => Array.from({ length: m + 1 }, (_, c) => (c < m ? xs.reduce((a, x) => a + x ** (r + c), 0) : xs.reduce((a, x, i) => a + ys[i] * x ** r, 0))));
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= m; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[m] / row[i]);
}

/** Fit a trendline to (x, y) points; null when the data cannot take it (too few points, or non-positive values for log/exp/power). */
export function fitTrend(xs: number[], ys: number[], t: Trendline): TrendFit | null {
  const pts = xs.map((x, i) => [x, ys[i]] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (t.type === "movingAvg") {
    const p = Math.max(2, Math.min(255, Math.round(t.period || 2)));
    if (pts.length < p) return null;
    const out: [number, number][] = [];
    for (let i = p - 1; i < pts.length; i++) out.push([pts[i][0], pts.slice(i - p + 1, i + 1).reduce((a, q) => a + q[1], 0) / p]);
    return { points: out };
  }
  if (pts.length < 2) return null;
  const X = pts.map((q) => q[0]), Y = pts.map((q) => q[1]);
  let f: (x: number) => number;
  let eq: string;
  if (t.type === "linear" || t.type === "poly") {
    const k = t.type === "linear" ? 1 : Math.max(2, Math.min(6, Math.round(t.order || 2)));
    if (pts.length <= k) return null;
    const c = polyFit(X, Y, k);
    if (!c) return null;
    f = (x) => c.reduce((a, ci, i) => a + ci * x ** i, 0);
    const sup = ["", "", "²", "³", "⁴", "⁵", "⁶"];
    const parts = c.map((ci, i) => ({ ci, i })).reverse().filter(({ ci }) => Math.abs(ci) > 1e-12);
    eq = `y = ${parts.map(({ ci, i }, j) => `${term(ci, j === 0)}${i ? `x${sup[i]}` : ""}`).join(" ") || "0"}`;
  } else {
    const lx = t.type === "log" || t.type === "power";
    const ly = t.type === "exp" || t.type === "power";
    if ((lx && X.some((x) => x <= 0)) || (ly && Y.some((y) => y <= 0))) return null;
    const c = polyFit(lx ? X.map(Math.log) : X, ly ? Y.map(Math.log) : Y, 1);
    if (!c) return null;
    const [a, b] = c;
    if (t.type === "exp") {
      f = (x) => Math.exp(a) * Math.exp(b * x);
      eq = `y = ${n4(Math.exp(a))}e^(${n4(b)}x)`;
    } else if (t.type === "log") {
      f = (x) => a + b * Math.log(x);
      eq = `y = ${n4(b)}ln(x) ${term(a, false)}`;
    } else {
      f = (x) => Math.exp(a) * x ** b;
      eq = `y = ${n4(Math.exp(a))}x^${n4(b)}`;
    }
  }
  const mean = Y.reduce((p, q) => p + q, 0) / Y.length;
  const ssTot = Y.reduce((p, y) => p + (y - mean) ** 2, 0);
  const ssRes = pts.reduce((p, [x, y]) => p + (y - f(x)) ** 2, 0);
  return { f, eq, r2: ssTot ? 1 - ssRes / ssTot : 1 };
}

/** OOXML trendlineType value <-> ours (identical names). */
export const isTrendType = (v: string | undefined): v is Trendline["type"] => !!v && TRENDLINE_TYPES.some((t) => t.id === v);
