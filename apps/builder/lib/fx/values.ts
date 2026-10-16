/**
 * Formula values. Blank is null; numbers, text and booleans are themselves; dates are Date
 * objects; a record is a plain object and a table is an array of records. Controls, screens and
 * other things with properties are Objects (`.get(name)`), read lazily so a control's property
 * formulas only run when something asks for them.
 */

export type Rec = { [field: string]: Value };
export type Value = null | number | string | boolean | Date | Rec | Value[] | FxObject;

/** Something with named properties that are worked out on demand: a control, a screen, an enum. */
export class FxObject {
  constructor(public kind: string, public name: string, private read: (prop: string) => Value) {}
  get(prop: string): Value {
    return this.read(prop);
  }
}

/** On a table that is a data source or collection: its name, so Patch and Remove know where to write. */
export const SOURCE = Symbol("source");
/** On a record read from a data source: which source and which record (its ID there). */
export const ROW = Symbol("row");

export type RowRef = { source: string; id: string };

export const sourceOf = (t: unknown): string | undefined => (Array.isArray(t) ? (t as unknown as Record<symbol, string>)[SOURCE] : undefined);
export const rowOf = (r: unknown): RowRef | undefined =>
  r && typeof r === "object" && !Array.isArray(r) && !(r instanceof Date) ? (r as Record<symbol, RowRef>)[ROW] : undefined;

export function withSource<T extends Value[]>(t: T, name: string): T {
  Object.defineProperty(t, SOURCE, { value: name, enumerable: false, configurable: true });
  return t;
}

export function withRow(r: Rec, ref: RowRef): Rec {
  Object.defineProperty(r, ROW, { value: ref, enumerable: false, configurable: true, writable: true });
  return r;
}

/** A copy of a record that keeps which data source row it came from. */
export function copyRec(r: Rec, changes: Rec = {}): Rec {
  const out: Rec = { ...r, ...changes };
  const ref = rowOf(r);
  if (ref) withRow(out, ref);
  return out;
}

export class FxError extends Error {
  constructor(message: string, public at = -1) {
    super(message);
  }
}

export const isBlank = (v: Value): boolean => v === null || v === undefined || v === "";
export const isRec = (v: Value): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof FxObject);
export const isTable = (v: Value): v is Value[] => Array.isArray(v);

export function typeName(v: Value): string {
  if (v === null || v === undefined) return "blank";
  if (v instanceof Date) return "date";
  if (Array.isArray(v)) return "table";
  if (v instanceof FxObject) return v.kind;
  if (typeof v === "object") return "record";
  return typeof v === "string" ? "text" : typeof v;
}

export function toNumber(v: Value): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, "").replace(/^\$/, ""));
    if (Number.isFinite(n)) return n;
    throw new FxError(`"${v.length > 30 ? `${v.slice(0, 30)}…` : v}" isn't a number`);
  }
  throw new FxError(`Expected a number, not a ${typeName(v)}`);
}

export function toBool(v: Value): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false" || s === "") return false;
    throw new FxError(`"${v}" isn't true or false`);
  }
  throw new FxError(`Expected true or false, not a ${typeName(v)}`);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A number as text: up to 15 significant digits, no exponent for ordinary sizes. */
export function numberText(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function toText(v: Value): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numberText(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return dateText(v);
  if (v instanceof FxObject) throw new FxError(`${v.name} is a ${v.kind}, not text`);
  if (Array.isArray(v)) throw new FxError("Expected text, not a table");
  // A one-column record (a Dropdown's Selected, for instance) reads as its value.
  const keys = Object.keys(v);
  if (keys.length === 1) return toText(v[keys[0]]);
  if ("Value" in v) return toText(v.Value);
  throw new FxError("Expected text, not a record");
}

/** Dates show as the browser shows them; a date with no time shows only the date. */
export function dateText(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
  return hasTime ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : d.toLocaleDateString();
}

export function toDate(v: Value): Date | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    // A plain date is that day at local midnight, as a date picker means it.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
    throw new FxError(`"${v}" isn't a date`);
  }
  throw new FxError(`Expected a date, not a ${typeName(v as Value)}`);
}

/** A table from a list of plain values: each becomes { Value: v }, as Power Fx's [1, 2, 3]. */
export function singleColumn(items: Value[]): Rec[] {
  return items.map((v) => (isRec(v) ? v : { Value: v }));
}

export function asTable(v: Value, what = "a table"): Rec[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v as Rec[];
  throw new FxError(`Expected ${what}, not a ${typeName(v)}`);
}

export function asRec(v: Value, what = "a record"): Rec | null {
  if (v === null || v === undefined) return null;
  if (isRec(v)) return v;
  throw new FxError(`Expected ${what}, not a ${typeName(v)}`);
}

/** Field lookup on a record: exact name first, then ignoring case. */
export function field(r: Rec, name: string): Value | undefined {
  if (name in r) return r[name];
  const lower = name.toLowerCase();
  const key = Object.keys(r).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : r[key];
}

/** = in formulas. Blank equals blank and empty text; dates compare by time; records by ID. */
export function equals(a: Value, b: Value): boolean {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  if (a instanceof Date || b instanceof Date) {
    const da = toDate(a);
    const db = toDate(b);
    return !!da && !!db && da.getTime() === db.getTime();
  }
  if (typeof a === "number" || typeof b === "number") {
    if (typeof a === "boolean" || typeof b === "boolean") return toBool(a) === toBool(b);
    try {
      return toNumber(a) === toNumber(b);
    } catch {
      return false;
    }
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    try {
      return toBool(a) === toBool(b);
    } catch {
      return false;
    }
  }
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (isRec(a) && isRec(b)) {
    const ra = rowOf(a);
    const rb = rowOf(b);
    if (ra && rb) return ra.source === rb.source && ra.id === rb.id;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => equals(a[k], b[k] ?? null));
  }
  if ((isRec(a) && typeof b === "string") || (typeof a === "string" && isRec(b))) {
    try {
      return toText(a) === toText(b);
    } catch {
      return false;
    }
  }
  return a === b;
}

/** Ordering for < > and sorting: blanks first, then numbers, dates or text. */
export function compare(a: Value, b: Value): number {
  if (isBlank(a) || isBlank(b)) return isBlank(a) ? (isBlank(b) ? 0 : -1) : 1;
  if (a instanceof Date || b instanceof Date) return toDate(a)!.getTime() - toDate(b)!.getTime();
  if (typeof a === "number" || typeof b === "number" || typeof a === "boolean" || typeof b === "boolean") return toNumber(a) - toNumber(b);
  const sa = toText(a);
  const sb = toText(b);
  return sa.localeCompare(sb, undefined, { sensitivity: "base", numeric: true });
}

// ---- Text(value, format) --------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Date formats such as "yyyy-mm-dd", "dd/mm/yyyy hh:mm", "mmm d, yyyy", "dddd", "h:mm AM/PM". */
export function formatDate(d: Date, fmt: string): string {
  const named: Record<string, string> = {
    shortdate: "m/d/yyyy",
    longdate: "dddd, mmmm d, yyyy",
    shorttime: "hh:mm",
    longtime: "hh:mm:ss",
    shortdatetime: "m/d/yyyy hh:mm",
    longdatetime: "dddd, mmmm d, yyyy hh:mm:ss",
    utc: "yyyy-mm-ddThh:mm:ss.fffZ",
  };
  const f = named[fmt.toLowerCase()] ?? fmt;
  const ampm = /am\/pm/i.test(f);
  const hours = d.getHours();
  const h12 = hours % 12 || 12;
  // m means month unless it follows h or comes before s, like Excel.
  return f.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|fff|am\/pm|"[^"]*"/gi, (tok, offset: number, all: string) => {
    const lower = tok.toLowerCase();
    if (tok.startsWith('"')) return tok.slice(1, -1);
    const minute = (lower === "mm" || lower === "m") && (/h+[^a-z]*$/i.test(all.slice(0, offset)) || /^[^a-z]*s/i.test(all.slice(offset + tok.length)));
    if (minute) return lower === "mm" ? pad(d.getMinutes()) : String(d.getMinutes());
    switch (lower) {
      case "yyyy":
        return String(d.getFullYear());
      case "yy":
        return pad(d.getFullYear() % 100);
      case "mmmm":
        return MONTHS[d.getMonth()];
      case "mmm":
        return MONTHS[d.getMonth()].slice(0, 3);
      case "mm":
        return pad(d.getMonth() + 1);
      case "m":
        return String(d.getMonth() + 1);
      case "dddd":
        return DAYS[d.getDay()];
      case "ddd":
        return DAYS[d.getDay()].slice(0, 3);
      case "dd":
        return pad(d.getDate());
      case "d":
        return String(d.getDate());
      case "hh":
        return pad(ampm ? h12 : hours);
      case "h":
        return String(ampm ? h12 : hours);
      case "ss":
        return pad(d.getSeconds());
      case "s":
        return String(d.getSeconds());
      case "fff":
        return pad(d.getMilliseconds(), 3);
      case "am/pm":
        return hours < 12 ? "AM" : "PM";
    }
    return tok;
  });
}

/** Number formats such as "0", "0.00", "#,##0", "$#,##0.00", "0%". */
export function formatNumber(n: number, fmt: string): string {
  const m = /^([^#0]*)([#0,]*)(?:\.([0#]+))?(%?)(.*)$/.exec(fmt);
  if (!m || !m[2]) return numberText(n);
  const [, prefix, whole, frac = "", percent, suffix] = m;
  const value = percent ? n * 100 : n;
  const decimals = frac.length;
  const minDecimals = (frac.match(/0/g) ?? []).length;
  let s = Math.abs(value).toFixed(decimals);
  if (decimals > minDecimals) s = s.replace(new RegExp(`0{1,${decimals - minDecimals}}$`), "").replace(/\.$/, "");
  let [int, dec] = s.split(".");
  const minInt = (whole.replace(/,/g, "").match(/0/g) ?? []).length;
  int = int.padStart(minInt, "0");
  if (int === "0" && minInt === 0) int = "";
  if (whole.includes(",")) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = dec ? `${int || (minInt ? "" : "0")}.${dec}` : int || "0";
  return `${value < 0 ? "-" : ""}${prefix}${body}${percent}${suffix}`;
}
