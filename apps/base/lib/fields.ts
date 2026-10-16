/**
 * Field types: what each Access data type (and SharePoint Lists column type) becomes in
 * Postgres, and how values sent by the browser are checked and converted before they reach SQL.
 * Everything here is pure, so the same rules run in the API and in tests.
 */

export const FIELD_TYPES = [
  "autonumber",
  "text",
  "longtext",
  "number",
  "currency",
  "date",
  "datetime",
  "yesno",
  "choice",
  "multichoice",
  "email",
  "hyperlink",
  "phone",
  "lookup",
  "multilookup",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldOptions = {
  /** text: the most characters a value may have (Access "Field Size", default 255). */
  maxLength?: number;
  /** number and currency: decimal places shown. */
  decimals?: number;
  /** currency: ISO code shown with values (default USD). */
  currencyCode?: string;
  /** choice and multichoice: the allowed values, in order. */
  choices?: string[];
  /** Access "Indexed: Yes (No Duplicates)": a unique index on the column. */
  unique?: boolean;
  /** lookup and multilookup: the table whose records this field points at (same database). */
  targetTable?: string;
  /** lookup and multilookup: the field of the target table shown in place of its ID. */
  displayField?: string;
  /**
   * lookup: what deleting a related record does to the records pointing at it. "restrict"
   * (refuse, Access's "Enforce Referential Integrity"), "cascade" (delete them too) or
   * "setnull" (clear the lookup).
   */
  onDelete?: OnDelete;
  /** Value given to new records when none is sent (Access "Default Value"). */
  defaultValue?: unknown;
};

export const ON_DELETE = ["restrict", "cascade", "setnull"] as const;
export type OnDelete = (typeof ON_DELETE)[number];

export type Field = {
  id: string;
  name: string;
  /** The column's generated name in Postgres; never anything a person typed. */
  pgName: string;
  type: FieldType;
  options: FieldOptions;
  required: boolean;
  description: string;
  position: number;
};

/** The labels people see, in Access's words with the Lists name where it differs. */
export const TYPE_LABELS: Record<FieldType, string> = {
  autonumber: "AutoNumber",
  text: "Short Text",
  longtext: "Long Text",
  number: "Number",
  currency: "Currency",
  date: "Date",
  datetime: "Date/Time",
  yesno: "Yes/No",
  choice: "Choice",
  multichoice: "Multiple choice",
  email: "Email",
  hyperlink: "Hyperlink",
  phone: "Phone",
  lookup: "Lookup",
  multilookup: "Lookup (multiple values)",
};

/** Fields that point at records of another table: one (lookup) or several (multilookup). */
export const isLookup = (f: Pick<Field, "type">) => f.type === "lookup" || f.type === "multilookup";

/** Most related records one multi-value lookup can hold. */
export const MAX_LOOKUP_VALUES = 100;

export function isFieldType(t: unknown): t is FieldType {
  return typeof t === "string" && (FIELD_TYPES as readonly string[]).includes(t);
}

/** Postgres column type for each field type. */
export function pgType(type: FieldType): string {
  switch (type) {
    case "autonumber":
    case "lookup":
      return "bigint";
    case "multilookup":
      return "bigint[]";
    case "number":
      return "numeric";
    case "currency":
      return "numeric(19,4)";
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "yesno":
      return "boolean";
    case "multichoice":
      return "text[]";
    default:
      return "text";
  }
}

export const MAX_TEXT = 255;
export const MAX_LONG_TEXT = 1_000_000;
export const MAX_CHOICES = 500;
export const MAX_NAME = 64;

export class FieldValueError extends Error {
  status = 400;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-10-16", or a date-time from which the calendar date is taken as written. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  const iso = DATE_RE.exec(s.slice(0, 10));
  if (iso && (s.length === 10 || /^[T ]/.test(s.slice(10)))) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return validDate(y, m, d) ? s.slice(0, 10) : null;
  }
  // US-style 10/16/2026, as Access shows dates by default.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    return validDate(y, m, d) ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  }
  return null;
}

/** An ISO date-time with a zone, or a date (taken as midnight UTC). */
export function parseDateTime(raw: string): string | null {
  const s = raw.trim();
  const d = parseDate(s);
  if (d && s.length === 10) return `${d}T00:00:00.000Z`;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Plain decimal text Postgres numeric accepts: "-12.5", "1e3" is refused. Thousands separators are dropped. */
export function parseNumber(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^([-+]?)\$/, "$1").replace(/,(?=\d{3}(\D|$))/g, "");
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? s.replace(/^\+/, "") : null;
}

const YES = new Set(["true", "yes", "y", "1", "on", "-1"]);
const NO = new Set(["false", "no", "n", "0", "off"]);

export function parseYesNo(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return YES.has(s) ? true : NO.has(s) ? false : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
}

/**
 * The value to store for `raw` in a field, or null for an empty value. Throws FieldValueError
 * with a message meant for people when the value doesn't fit the field.
 */
export function coerce(field: Pick<Field, "name" | "type" | "options">, raw: unknown): unknown {
  if (isEmpty(raw)) return null;
  const bad = (why: string): never => {
    throw new FieldValueError(`${field.name}: ${why}`);
  };
  switch (field.type) {
    case "autonumber":
      return bad("AutoNumber values are set by the database");
    case "text":
    case "longtext":
    case "email":
    case "hyperlink":
    case "phone": {
      if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") return bad("expected text");
      const s = String(raw);
      const max = field.type === "longtext" ? MAX_LONG_TEXT : field.type === "text" ? field.options.maxLength ?? MAX_TEXT : 2048;
      if (s.length > max) return bad(`at most ${max} characters`);
      if (field.type === "email" && !EMAIL_RE.test(s.trim())) return bad("not an email address");
      if (field.type === "hyperlink" && !/^(https?:\/\/|mailto:)/i.test(s.trim())) return bad("links start with http://, https:// or mailto:");
      return field.type === "longtext" ? s : s.trim();
    }
    case "number":
    case "currency": {
      const n = parseNumber(raw);
      if (n === null) return bad("expected a number");
      if (field.type === "currency" && Math.abs(Number(n)) >= 1e15) return bad("too large for a currency value");
      return n;
    }
    case "date": {
      const d = typeof raw === "string" ? parseDate(raw) : null;
      return d ?? bad("expected a date like 2026-10-16");
    }
    case "datetime": {
      const d = typeof raw === "string" ? parseDateTime(raw) : null;
      return d ?? bad("expected a date and time");
    }
    case "yesno": {
      const b = parseYesNo(raw);
      return b ?? bad("expected yes or no");
    }
    case "choice": {
      const s = String(raw).trim();
      const choices = field.options.choices ?? [];
      return choices.includes(s) ? s : bad(`"${s}" isn't one of the choices`);
    }
    case "lookup": {
      const id = typeof raw === "object" && raw !== null && "id" in raw ? (raw as { id: unknown }).id : raw;
      const s = String(id).trim();
      return /^\d{1,18}$/.test(s) && s !== "0" ? s : bad("pick a related record");
    }
    case "multilookup": {
      // A list of record IDs (or { id } objects), or text like "3; 7".
      const list = Array.isArray(raw) ? raw : String(raw).split(/[;,\n]/);
      const ids = list.map((v) => String(typeof v === "object" && v !== null && "id" in v ? (v as { id: unknown }).id : v).trim()).filter(Boolean);
      if (ids.some((x) => !/^\d{1,18}$/.test(x) || x === "0")) return bad("pick related records");
      const picked = [...new Set(ids)];
      if (picked.length > MAX_LOOKUP_VALUES) return bad(`at most ${MAX_LOOKUP_VALUES} related records`);
      return picked.length ? picked : null;
    }
    case "multichoice": {
      const list = Array.isArray(raw) ? raw.map((v) => String(v).trim()) : String(raw).split(/[;\n]/).map((v) => v.trim());
      const choices = field.options.choices ?? [];
      const picked = [...new Set(list.filter(Boolean))];
      const unknown = picked.find((v) => !choices.includes(v));
      if (unknown !== undefined) return bad(`"${unknown}" isn't one of the choices`);
      return picked.length ? picked : null;
    }
  }
}

/** Checks and tidies the options sent for a field of `type`. */
export function cleanOptions(type: FieldType, raw: unknown): FieldOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: FieldOptions = {};
  if (o.unique === true && type !== "longtext" && type !== "multichoice" && type !== "multilookup" && type !== "autonumber") out.unique = true;
  if (type === "lookup" || type === "multilookup") {
    if (typeof o.targetTable !== "string" || !o.targetTable) throw new FieldValueError("Pick the table to look up");
    out.targetTable = o.targetTable;
    if (typeof o.displayField === "string" && o.displayField) out.displayField = o.displayField;
    // Deleting a related record takes it out of a multi-value lookup's list; there's no rule to pick.
    if (type === "lookup") out.onDelete = (ON_DELETE as readonly string[]).includes(o.onDelete as string) ? (o.onDelete as OnDelete) : "restrict";
  }
  if (type === "text" && o.maxLength !== undefined) {
    const n = Number(o.maxLength);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TEXT) throw new FieldValueError(`Field size is 1 to ${MAX_TEXT} characters`);
    out.maxLength = n;
  }
  if ((type === "number" || type === "currency") && o.decimals !== undefined) {
    const n = Number(o.decimals);
    if (!Number.isInteger(n) || n < 0 || n > 10) throw new FieldValueError("Decimal places are 0 to 10");
    out.decimals = n;
  }
  if (type === "currency" && typeof o.currencyCode === "string" && /^[A-Z]{3}$/.test(o.currencyCode)) out.currencyCode = o.currencyCode;
  if (type === "choice" || type === "multichoice") {
    const list = Array.isArray(o.choices) ? o.choices.map((c) => String(c).trim()).filter(Boolean) : [];
    const unique = [...new Set(list)];
    if (unique.length > MAX_CHOICES) throw new FieldValueError(`At most ${MAX_CHOICES} choices`);
    if (unique.some((c) => c.length > MAX_TEXT)) throw new FieldValueError(`Choices are at most ${MAX_TEXT} characters`);
    out.choices = unique;
  }
  if (o.defaultValue !== undefined && o.defaultValue !== null && o.defaultValue !== "" && type !== "autonumber" && type !== "lookup" && type !== "multilookup") {
    out.defaultValue = coerce({ name: "Default value", type, options: out }, o.defaultValue);
  }
  return out;
}

/** A name for a table or field: trimmed, 1 to 64 characters, no control characters. */
export function cleanName(raw: unknown, what = "Name"): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!s) throw new FieldValueError(`${what} can't be empty`);
  if (s.length > MAX_NAME) throw new FieldValueError(`${what} is at most ${MAX_NAME} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new FieldValueError(`${what} can't contain control characters`);
  return s;
}

/**
 * The expression that converts a column to a new field type in ALTER COLUMN ... USING.
 * `col` is an already-quoted identifier. Values that can't convert make the ALTER fail,
 * which the caller reports instead of losing data.
 */
export function conversionSql(col: string, from: FieldType, to: FieldType): string {
  const target = pgType(to);
  if (pgType(from) === target) return col;
  // Only a lookup becomes a multi-value one (the caller refuses other changes either way).
  if (to === "multilookup") return `CASE WHEN ${col} IS NULL THEN NULL ELSE ARRAY[${col}::bigint] END`;
  if (from === "multichoice") {
    const asText = `array_to_string(${col}, '; ')`;
    return target === "text" ? asText : `NULLIF(${asText}, '')::${target}`;
  }
  if (to === "multichoice") {
    return `CASE WHEN ${col} IS NULL THEN NULL ELSE regexp_split_to_array(${col}::text, '\\s*;\\s*') END`;
  }
  if (to === "yesno" && (from === "number" || from === "currency")) return `(${col} <> 0)`;
  if ((to === "number" || to === "currency") && from === "yesno") return `CASE WHEN ${col} THEN -1 WHEN NOT ${col} THEN 0 END::${target}`;
  if (target === "text") return `${col}::text`;
  return `NULLIF(btrim(${col}::text), '')::${target}`;
}
