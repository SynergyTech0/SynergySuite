/**
 * Access import: tables, records and relationships from an .accdb or .mdb file, read with
 * mdb-reader (MIT, https://github.com/andipaetzold/mdb-reader). Nothing of Access's own code is
 * used; the file is only read.
 *
 * - Each Access table becomes a table. A table with an AutoNumber keeps its numbers as the ID (so
 *   relationships still line up), under the AutoNumber's own name.
 * - Data types map to the nearest Base type (see TYPE_MAP); OLE objects, attachments and other
 *   binary columns are left out and listed in the notes.
 * - A relationship from a number field to another table's AutoNumber becomes a Lookup field with
 *   the same delete rule (restrict, cascade, or set to empty). Relationships on other keys (say a
 *   text code) keep their values and are listed in the notes.
 * - Saved queries, forms, reports and macros are not read; the notes say how many there were.
 *
 * If anything fails, the tables made so far are removed again.
 */
import MDBReader from "mdb-reader";
import { createTable, deleteTable, getTable, listTables, qualified, updateField, type TableInfo } from "./catalog";
import { db } from "./db";
import { coerce, FieldValueError, type Field, type FieldType } from "./fields";
import { HttpError } from "./http";
import { bulkInsert, MAX_IMPORT_ROWS } from "./import";

export const MAX_ACCESS_BYTES = 100 * 1024 * 1024;

type AccessColumn = { name: string; type: string; autoLong?: boolean; scale?: number };

/** Access column types (as mdb-reader names them) → Base field types; null means not imported. */
const TYPE_MAP: Record<string, FieldType | null> = {
  boolean: "yesno",
  byte: "number",
  integer: "number",
  long: "number",
  bigint: "number",
  float: "number",
  double: "number",
  numeric: "number",
  currency: "currency",
  datetime: "datetime",
  datetimeextended: "datetime",
  text: "text",
  memo: "longtext",
  repid: "text",
  binary: null,
  ole: null,
  complex: null,
};

const TYPE_NAMES: Record<string, string> = { ole: "OLE object", binary: "binary data", complex: "attachments or multi-value" };

const WHOLE = new Set(["byte", "integer", "long", "bigint"]);

/** Access relationship flags (MSysRelationships.grbit). */
const DONT_ENFORCE = 0x2;
const CASCADE_DELETE = 0x1000;
const CASCADE_NULL = 0x2000;

export type AccessImport = {
  tables: TableInfo[];
  records: number;
  /** Things that weren't brought over, or were brought over differently, in plain words. */
  notes: string[];
};

function open(buffer: Buffer, password?: string): MDBReader {
  try {
    const reader = new MDBReader(buffer, { password: password || undefined });
    reader.getTableNames(); // decrypts and reads the catalog, so a bad file fails here
    return reader;
  } catch (e) {
    const msg = String((e as Error)?.message ?? "");
    if (/password/i.test(msg)) throw new HttpError(400, password ? "That password isn't right for this database" : "This database has a password; enter it to import");
    throw new HttpError(400, "That isn't an Access database Base can read (.accdb or .mdb)");
  }
}

/** A table name not already used in the database ("Customers", "Customers 2" ...). */
function freeName(name: string, used: Set<string>): string {
  let n = name.replace(/\s+/g, " ").trim().slice(0, 60) || "Table";
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${name.slice(0, 56)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}

/** A value from mdb-reader as Base stores it for `type`. */
function value(f: Field, accessType: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Access dates have no time zone; mdb-reader gives the wall time as UTC.
    return f.type === "date" ? v.toISOString().slice(0, 10) : v.toISOString();
  }
  if (typeof v === "bigint") return v.toString();
  if (accessType === "repid" && typeof v === "string") return v.toUpperCase();
  return coerce(f, typeof v === "number" ? String(v) : v);
}

/**
 * Imports every table of an Access file into the database `databaseId` (new tables, named apart
 * from those already there).
 */
export async function importAccess(databaseId: string, email: string, buffer: Buffer, password?: string): Promise<AccessImport> {
  if (buffer.length > MAX_ACCESS_BYTES) throw new HttpError(413, "Access files up to 100 MB can be imported");
  const reader = open(buffer, password);
  const names = reader.getTableNames().filter((n) => !/^(MSys|~)/i.test(n));
  if (!names.length) throw new HttpError(400, "That database has no tables to import");

  const notes: string[] = [];
  const used = new Set((await listTables(databaseId, email)).map((t) => t.name.toLowerCase()));
  const made: TableInfo[] = [];
  /** Access table name → what it became: the new table, its fields by Access column name, the AutoNumber column. */
  const map = new Map<string, { table: TableInfo; fields: Map<string, Field>; auto: string | null }>();
  let records = 0;

  try {
    for (const name of names) {
      const at = reader.getTable(name);
      const columns = at.getColumns() as AccessColumn[];
      if (at.rowCount > MAX_IMPORT_ROWS) throw new HttpError(413, `${name} has ${at.rowCount.toLocaleString("en-US")} records; at most ${MAX_IMPORT_ROWS.toLocaleString("en-US")} can be imported per table`);
      // Attachment columns carry the same flag as AutoNumbers; only a Long Integer one is an AutoNumber.
      const autos = columns.filter((c) => c.autoLong && c.type === "long");
      const auto = autos.length === 1 ? autos[0].name : null;
      const kept = columns.filter((c) => c.name !== auto && TYPE_MAP[c.type] !== null && TYPE_MAP[c.type] !== undefined);
      for (const c of columns) {
        if (c.name === auto) continue;
        if (!TYPE_MAP[c.type]) notes.push(`${name}.${c.name} (${TYPE_NAMES[c.type] ?? c.type}) wasn't imported; Base doesn't store files in tables yet`);
      }
      if (kept.length > 254) throw new HttpError(400, `${name} has more than 254 fields`);
      const rows = at.getData() as Record<string, unknown>[];
      // A Date/Time column that only ever holds midnight is a date, as most Access dates are.
      const types = kept.map((c): FieldType => {
        const t = TYPE_MAP[c.type]!;
        if (t !== "datetime") return t;
        const dates = rows.map((r) => r[c.name]).filter((v): v is Date => v instanceof Date);
        return dates.every((d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) ? "date" : "datetime";
      });
      // Base's own ID is the AutoNumber, under its Access name; an Access field called ID that isn't
      // an AutoNumber keeps its name, and the ID becomes "Record ID".
      const clash = !auto && kept.some((c) => c.name.toLowerCase() === "id");
      const table = await createTable(databaseId, email, {
        name: freeName(name, used),
        idName: auto ?? (clash ? "Record ID" : "ID"),
        fields: kept.map((c, i) => ({
          name: c.name,
          type: types[i],
          options: types[i] === "number" && (WHOLE.has(c.type) || (c.type === "numeric" && c.scale !== undefined)) ? { decimals: WHOLE.has(c.type) ? 0 : c.scale } : undefined,
        })),
      });
      made.push(table);
      const idField = table.fields.find((f) => f.type === "autonumber")!;
      const fields = new Map<string, Field>();
      kept.forEach((c, i) => fields.set(c.name, table.fields[i + 1]));
      map.set(name, { table, fields, auto });

      // Records, keeping the AutoNumber values as IDs.
      const order = [...(auto ? [idField] : []), ...kept.map((c) => fields.get(c.name)!)];
      const data = rows.map((r, n) => {
        const rec: unknown[] = auto ? [r[auto]] : [];
        for (const c of kept) {
          try {
            rec.push(value(fields.get(c.name)!, c.type, r[c.name]));
          } catch (e) {
            if (e instanceof FieldValueError) throw new HttpError(400, `${name}, record ${n + 1}: ${e.message}`);
            throw e;
          }
        }
        return rec;
      });
      if (data.length) records += await bulkInsert(table.id, email, order, data);
      if (auto && data.length) {
        const t = await getTable(table.id, email);
        await db().q(`SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT max(id) FROM ${qualified(t)}))`, [`${t.schema}.${t.pgName}`]);
      }
    }

    // Relationships to an AutoNumber become lookups.
    let rels: Record<string, unknown>[] = [];
    try {
      rels = reader.getTable("MSysRelationships").getData() as Record<string, unknown>[];
    } catch {
      rels = [];
    }
    const byName = new Map<string, Record<string, unknown>[]>();
    for (const r of rels) {
      const key = String(r.szRelationship);
      byName.set(key, [...(byName.get(key) ?? []), r]);
    }
    for (const [relName, parts] of byName) {
      const r = parts[0];
      const many = map.get(String(r.szObject));
      const one = map.get(String(r.szReferencedObject));
      if (!many || !one) continue; // system tables, or tables left out
      const label = `${r.szObject}.${r.szColumn} → ${r.szReferencedObject}.${r.szReferencedColumn}`;
      if (parts.length > 1) {
        notes.push(`The relationship ${relName} uses ${parts.length} fields; Base relationships use one, so it wasn't kept`);
        continue;
      }
      const field = many.fields.get(String(r.szColumn));
      if (!one.auto || String(r.szReferencedColumn) !== one.auto || !field || field.type !== "number") {
        notes.push(`The relationship ${label} wasn't kept: Base relationships point at a record's ID (an AutoNumber). The values are all there`);
        continue;
      }
      const grbit = Number(r.grbit) || 0;
      const onDelete = grbit & CASCADE_DELETE ? "cascade" : grbit & CASCADE_NULL ? "setnull" : "restrict";
      try {
        const updated = await updateField(many.table.id, field.id, email, { type: "lookup", options: { targetTable: one.table.id, onDelete } });
        many.fields.set(String(r.szColumn), updated);
      } catch (e) {
        const err = e as { code?: string; status?: number; message?: string };
        if (err.code === "23503") {
          notes.push(`The relationship ${label} wasn't kept: some records point at ${r.szReferencedObject} records that don't exist${grbit & DONT_ENFORCE ? " (Access wasn't enforcing it)" : ""}`);
        } else if (err.status && err.status < 500) {
          notes.push(`The relationship ${label} wasn't kept: ${err.message}`);
        } else throw e;
      }
    }
  } catch (e) {
    // Remove what was made; lookups between the new tables mean some go only after others.
    let left = [...made];
    for (let round = 0; left.length && round < left.length + 1; round++) {
      const next: TableInfo[] = [];
      for (const t of left) await deleteTable(t.id, email).catch(() => next.push(t));
      left = next;
    }
    throw e;
  }

  const queries = countObjects(reader, 5);
  if (queries) notes.push(`${queries} saved quer${queries === 1 ? "y" : "ies"} weren't imported; Base can't read Access query definitions yet. Remake them in the query designer`);
  const forms = countObjects(reader, -32768);
  const reports = countObjects(reader, -32764);
  if (forms) notes.push(`${forms === 1 ? "1 form wasn't" : `${forms} forms weren't`} imported; Base can't read Access form designs. Make them again with New form`);
  if (reports) notes.push(`${reports === 1 ? "1 report wasn't" : `${reports} reports weren't`} imported; Base can't read Access report designs. Make them again with New report`);
  const tables = await listTables(databaseId, email);
  return { tables: tables.filter((t) => made.some((m) => m.id === t.id)), records, notes };
}

/** How many user objects of an MSysObjects type the file has (5 queries, -32768 forms, -32764 reports). */
function countObjects(reader: MDBReader, type: number): number {
  try {
    const rows = reader.getTable("MSysObjects").getData({ columns: ["Name", "Type"] }) as { Name: string; Type: number }[];
    return rows.filter((o) => o.Type === type && !/^(~|MSys)/.test(o.Name)).length;
  } catch {
    return 0;
  }
}
