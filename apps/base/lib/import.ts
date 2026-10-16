/**
 * Bringing data in: a CSV file becomes a new table. (Access .accdb/.mdb import joins this file
 * in a later milestone.) Records go in with multi-row INSERTs in one transaction; if any fail,
 * the new table is removed again so a half-imported table is never left behind.
 */
import { createTable, deleteTable, getTable, ident, qualified, type TableInfo } from "./catalog";
import { db } from "./db";
import { coerce, type Field } from "./fields";
import { headerNames, inferType, parseCsv } from "./csv";
import { HttpError } from "./http";

export const MAX_IMPORT_ROWS = 200_000;
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** Writes `records` (values in `fields` order) into the table, in chunks under Postgres' parameter limit. */
export async function bulkInsert(tableId: string, email: string, fields: Field[], records: unknown[][]): Promise<number> {
  const t = await getTable(tableId, email);
  const cols = [...fields.map((f) => ident(f.pgName)), `"created_by"`, `"updated_by"`];
  const per = Math.max(1, Math.floor(60_000 / cols.length));
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < records.length; i += per) {
      const chunk = records.slice(i, i + per);
      const params: unknown[] = [];
      const tuples = chunk.map((rec) => {
        const ph = [...rec, email, email].map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `(${ph.join(", ")})`;
      });
      await client.query(`INSERT INTO ${qualified(t)} (${cols.join(", ")}) VALUES ${tuples.join(", ")}`, params);
    }
    await client.query("COMMIT");
    return records.length;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function importCsv(databaseId: string, email: string, input: { name?: unknown; csv?: unknown }): Promise<{ table: TableInfo; imported: number }> {
  if (typeof input.csv !== "string" || !input.csv.trim()) throw new HttpError(400, "The file is empty");
  if (input.csv.length > MAX_IMPORT_BYTES) throw new HttpError(413, "CSV files up to 50 MB can be imported");
  const rows = parseCsv(input.csv);
  if (rows.length < 1) throw new HttpError(400, "The file has no rows");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new HttpError(413, `At most ${MAX_IMPORT_ROWS.toLocaleString("en-US")} records can be imported at once`);
  const width = Math.max(...rows.map((r) => r.length));
  if (width > 254) throw new HttpError(400, "A table has at most 255 fields");
  const header = [...rows[0], ...Array(width - rows[0].length).fill("")];
  const data = rows.slice(1).map((r) => [...r, ...Array(width - r.length).fill("")]);
  const names = headerNames(header);
  const types = names.map((_, i) => inferType(data.map((r) => r[i])));

  const table = await createTable(databaseId, email, {
    name: input.name,
    fields: names.map((name, i) => ({ name, type: types[i] })),
  });
  const fields = table.fields.filter((f) => f.type !== "autonumber");
  try {
    const records = data.map((r) => fields.map((f, i) => coerce(f, r[i])));
    const imported = await bulkInsert(table.id, email, fields, records);
    return { table, imported };
  } catch (e) {
    await deleteTable(table.id, email).catch(() => {});
    throw e;
  }
}
