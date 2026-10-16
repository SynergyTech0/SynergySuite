/**
 * Base records <-> formula records. Base speaks field ids and its own value shapes (numbers as
 * text so currency keeps its cents, dates as "2026-10-16"); formulas speak field names and
 * numbers, Dates, booleans and tables. Every record keeps its Base ID (ROW) so Patch and Remove
 * know which record to change.
 */
import { FxError, isBlank, isRec, rowOf, toBool, toDate, toNumber, toText, withRow, type Rec, type Value } from "./fx";
import type { DataSource, SourceField } from "./model";

/** A record as Base's API returns it. */
export type BaseRow = {
  id: string;
  values: Record<string, unknown>;
  labels?: Record<string, string | null>;
  items?: Record<string, { id: string; label: string }[]>;
};

function fromBase(f: SourceField, row: BaseRow): Value {
  const v = row.values[f.id];
  if (v === null || v === undefined) return f.type === "multichoice" || f.type === "multilookup" ? [] : null;
  switch (f.type) {
    case "autonumber":
    case "number":
    case "currency":
      return Number(v);
    case "yesno":
      return !!v;
    case "date":
    case "datetime":
      return toDate(String(v));
    case "multichoice":
      return (v as unknown[]).map((x) => ({ Value: String(x) }));
    case "lookup":
      // The related record's shown text. Patch takes the related record (or its ID) to change it.
      return row.labels?.[f.id] ?? String(v);
    case "multilookup":
      return (row.items?.[f.id] ?? []).map((x) => ({ Value: x.label, Id: Number(x.id) }));
    default:
      return String(v);
  }
}

/** A Base row as a formula record, fields by name. */
export function toRecord(source: DataSource, row: BaseRow): Rec {
  const r: Rec = {};
  for (const f of source.fields) r[f.name] = fromBase(f, row);
  // Every Base table has its ID, whether or not the app lists it as a field.
  if (!("ID" in r)) r.ID = Number(row.id);
  return withRow(r, { source: source.name, id: String(row.id) });
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function toBase(f: SourceField, v: Value): unknown {
  if (isBlank(v) || (Array.isArray(v) && !v.length && f.type !== "multichoice" && f.type !== "multilookup")) return null;
  switch (f.type) {
    case "number":
    case "currency":
      return toNumber(v);
    case "yesno":
      return toBool(v);
    case "date": {
      const d = toDate(v);
      return d ? ymd(d) : null;
    }
    case "datetime": {
      const d = toDate(v);
      return d ? d.toISOString() : null;
    }
    case "multichoice":
      return (Array.isArray(v) ? v : [v]).map((x) => (isRec(x) ? toText(x) : toText(x as Value)));
    case "lookup": {
      // A related record's ID: a number, or a record carrying ID (LookUp(...), a dropdown's Selected).
      if (typeof v === "number") return v;
      if (isRec(v)) {
        const ref = rowOf(v);
        if (ref) return Number(ref.id);
        if ("ID" in v || "Id" in v) return toNumber((v.ID ?? v.Id) as Value);
      }
      if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
      throw new FxError(`${f.name} is a lookup: give it a record from the related table, or its ID`);
    }
    case "multilookup":
      return (Array.isArray(v) ? v : [v]).map((x) => {
        if (typeof x === "number") return x;
        if (isRec(x)) {
          const ref = rowOf(x);
          if (ref) return Number(ref.id);
          return toNumber((x.ID ?? x.Id ?? x.Value) as Value);
        }
        return toNumber(x as Value);
      });
    default:
      return toText(v);
  }
}

/**
 * Changes by field name -> Base values by field id. Fields the table doesn't have are an error
 * (a typo would otherwise be silently lost); the ID can't be set.
 */
export function toBaseValues(source: DataSource, changes: Rec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(changes)) {
    const f = source.fields.find((x) => x.name === name) ?? source.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) {
      if (name === "ID") continue;
      throw new FxError(`${source.name} has no field called ${name}`);
    }
    if (f.type === "autonumber") continue;
    out[f.id] = toBase(f, v);
  }
  return out;
}

/** A blank record with every field, as Defaults(Source) returns. */
export function defaultsFor(source: DataSource): Rec {
  const r: Rec = {};
  for (const f of source.fields) if (f.type !== "autonumber") r[f.name] = f.type === "multichoice" || f.type === "multilookup" ? [] : null;
  return r;
}
