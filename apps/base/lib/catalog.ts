/**
 * Databases, tables and fields: the catalog rows and the Postgres objects behind them, changed
 * together in one transaction so they never disagree. SQL identifiers are always generated
 * here (db_<id>, t_<id>, f_<id>); names people type only ever go in as query parameters.
 */
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { db, ready } from "./db";
import { cleanName, cleanOptions, conversionSql, FieldValueError, isFieldType, isLookup, pgType, type Field, type FieldOptions, type FieldType } from "./fields";
import { forbidden, HttpError, notFound } from "./http";
import { ident } from "./names";
import { dropView, syncView } from "./views";

export type Role = "owner" | "editor" | "viewer";

export type DatabaseInfo = {
  id: string;
  name: string;
  description: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type TableInfo = {
  id: string;
  databaseId: string;
  name: string;
  description: string;
  position: number;
  fields: Field[];
};

/** A table with what the row code needs to address it in SQL. */
/** Where a lookup field's related records live, and which of their columns is shown. */
export type LookupTarget = { tableId: string; schema: string; pgName: string; display: Field | null };

export type TableRef = TableInfo & {
  schema: string;
  pgName: string;
  role: Role;
  /** For each lookup field (by field id): its target table. */
  lookups: Record<string, LookupTarget>;
};

/** A lookup field elsewhere in the database that points at a table. */
export type Relation = { tableId: string; tableName: string; fieldId: string; fieldName: string; onDelete: string };

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 12 random lowercase letters and digits, starting with a letter. */
export function newId(): string {
  const bytes = randomBytes(12);
  let s = ALPHABET[bytes[0] % 26];
  for (let i = 1; i < 12; i++) s += ALPHABET[bytes[i] % 36];
  return s;
}

export { ident };

export const canEdit = (role: Role) => role === "owner" || role === "editor";

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await db().pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const touch = (c: PoolClient, databaseId: string) => c.query("UPDATE base_databases SET updated_at = now() WHERE id = $1", [databaseId]);

// ---- Databases ------------------------------------------------------------------

function dbRow(r: any): DatabaseInfo {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    role: r.role,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listDatabases(email: string): Promise<DatabaseInfo[]> {
  await ready();
  const { rows } = await db().q(
    `SELECT d.*, m.role FROM base_databases d JOIN base_members m ON m.database_id = d.id
      WHERE m.email = $1 ORDER BY d.updated_at DESC`,
    [email],
  );
  return rows.map(dbRow);
}

export async function getDatabase(id: string, email: string): Promise<DatabaseInfo | null> {
  await ready();
  const { rows } = await db().q(
    `SELECT d.*, m.role FROM base_databases d JOIN base_members m ON m.database_id = d.id
      WHERE d.id = $1 AND m.email = $2`,
    [id, email],
  );
  return rows[0] ? dbRow(rows[0]) : null;
}

/** A new, empty database owned by `email`. */
export async function createDatabase(email: string, input: { name?: unknown; description?: unknown }): Promise<DatabaseInfo> {
  const name = cleanName(input.name ?? "Database1", "Database name");
  const description = typeof input.description === "string" ? input.description.slice(0, 2000) : "";
  const id = newId();
  const schema = `db_${id}`;
  return tx(async (c) => {
    await c.query(`CREATE SCHEMA ${ident(schema)}`);
    await c.query(`INSERT INTO base_databases (id, name, description, schema_name, created_by) VALUES ($1, $2, $3, $4, $5)`, [id, name, description, schema, email]);
    await c.query(`INSERT INTO base_members (database_id, email, role) VALUES ($1, $2, 'owner')`, [id, email]);
    const { rows } = await c.query(`SELECT d.*, 'owner' AS role FROM base_databases d WHERE id = $1`, [id]);
    return dbRow(rows[0]);
  });
}

export async function updateDatabase(id: string, email: string, input: { name?: unknown; description?: unknown }): Promise<DatabaseInfo> {
  const info = await getDatabase(id, email);
  if (!info) throw notFound();
  if (!canEdit(info.role)) throw forbidden();
  const name = input.name === undefined ? info.name : cleanName(input.name, "Database name");
  const description = typeof input.description === "string" ? input.description.slice(0, 2000) : info.description;
  await db().q(`UPDATE base_databases SET name = $2, description = $3, updated_at = now() WHERE id = $1`, [id, name, description]);
  return (await getDatabase(id, email))!;
}

/** Deletes the database and every table in it. Owners only. */
export async function deleteDatabase(id: string, email: string): Promise<void> {
  const info = await getDatabase(id, email);
  if (!info) throw notFound();
  if (info.role !== "owner") throw forbidden("Only the owner can delete a database");
  await tx(async (c) => {
    const { rows } = await c.query(`DELETE FROM base_databases WHERE id = $1 RETURNING schema_name`, [id]);
    if (rows[0]) await c.query(`DROP SCHEMA IF EXISTS ${ident(rows[0].schema_name)} CASCADE`);
  });
}

// ---- Tables and fields ------------------------------------------------------------

function fieldRow(r: any): Field {
  return {
    id: r.id,
    name: r.name,
    pgName: r.pg_name,
    type: r.type,
    options: r.options ?? {},
    required: r.required,
    description: r.description,
    position: r.position,
  };
}

async function fieldsOf(c: { query: PoolClient["query"] } | null, tableIds: string[]): Promise<Map<string, Field[]>> {
  const q = c ? c.query.bind(c) : db().q;
  const { rows } = await q(`SELECT * FROM base_fields WHERE table_id = ANY($1) ORDER BY position, id`, [tableIds]);
  const out = new Map<string, Field[]>(tableIds.map((id) => [id, []]));
  for (const r of rows) out.get(r.table_id)!.push(fieldRow(r));
  return out;
}

export async function listTables(databaseId: string, email: string): Promise<TableInfo[]> {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  const { rows } = await db().q(`SELECT * FROM base_tables WHERE database_id = $1 ORDER BY position, lower(name)`, [databaseId]);
  const fields = await fieldsOf(null, rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, databaseId, name: r.name, description: r.description, position: r.position, fields: fields.get(r.id)! }));
}

/** The table and the caller's role on its database, or a 404 when they can't see it. */
export async function getTable(tableId: string, email: string, c?: PoolClient): Promise<TableRef> {
  await ready();
  const q = c ? c.query.bind(c) : db().q;
  const { rows } = await q(
    `SELECT t.*, d.schema_name, m.role FROM base_tables t
       JOIN base_databases d ON d.id = t.database_id
       JOIN base_members m ON m.database_id = d.id AND m.email = $2
      WHERE t.id = $1`,
    [tableId, email],
  );
  const r = rows[0];
  if (!r) throw notFound();
  const fields = (await fieldsOf(c ?? null, [r.id])).get(r.id)!;
  const lookups: Record<string, LookupTarget> = {};
  const targets = [...new Set(fields.filter(isLookup).map((f) => f.options.targetTable!))];
  if (targets.length) {
    const { rows: tt } = await q(`SELECT id, pg_name FROM base_tables WHERE id = ANY($1) AND database_id = $2`, [targets, r.database_id]);
    const tf = await fieldsOf(c ?? null, tt.map((x) => x.id));
    for (const f of fields) {
      const target = tt.find((x) => x.id === f.options.targetTable);
      if (!isLookup(f) || !target) continue;
      const display = tf.get(target.id)!.find((x) => x.id === f.options.displayField) ?? null;
      lookups[f.id] = { tableId: target.id, schema: r.schema_name, pgName: target.pg_name, display };
    }
  }
  return {
    lookups,
    id: r.id,
    databaseId: r.database_id,
    name: r.name,
    description: r.description,
    position: r.position,
    fields,
    schema: r.schema_name,
    pgName: r.pg_name,
    role: r.role,
  };
}

export const qualified = (t: { schema: string; pgName: string }) => `${ident(t.schema)}.${ident(t.pgName)}`;

export type FieldInput = { name?: unknown; type?: unknown; options?: unknown; required?: unknown; description?: unknown };

/** Adds a column and its catalog row inside `c`. */
type TableLoc = { id: string; databaseId: string; schema: string; pgName: string };

const FK_ACTION = { restrict: "RESTRICT", cascade: "CASCADE", setnull: "SET NULL" } as const;

/** Checks a lookup's target (same database) and display field, filling in a default display. */
async function checkLookup(c: PoolClient, t: TableLoc, options: FieldOptions): Promise<{ schema: string; pgName: string }> {
  const { rows } = await c.query(`SELECT id, pg_name FROM base_tables WHERE id = $1 AND database_id = $2`, [options.targetTable, t.databaseId]);
  if (!rows[0]) throw new FieldValueError("The table to look up isn't in this database");
  const { rows: tf } = await c.query(`SELECT id, type FROM base_fields WHERE table_id = $1 ORDER BY position, id`, [rows[0].id]);
  if (!options.displayField || !tf.some((f) => f.id === options.displayField)) {
    // Like Access's Lookup Wizard: show the first field after the ID unless told otherwise.
    options.displayField = (tf.find((f) => f.type !== "autonumber") ?? tf[0]).id;
  }
  return { schema: t.schema, pgName: rows[0].pg_name };
}

async function addForeignKey(c: PoolClient, t: TableLoc, fieldId: string, column: string, target: { schema: string; pgName: string }, onDelete: keyof typeof FK_ACTION) {
  await c.query(
    `ALTER TABLE ${qualified(t)} ADD CONSTRAINT ${ident(`fk_${fieldId}`)} FOREIGN KEY (${ident(column)}) REFERENCES ${qualified(target)} (id) ON DELETE ${FK_ACTION[onDelete]}`,
  );
}

/**
 * A multi-value lookup is a bigint[] column, which Postgres can't give a foreign key. Two
 * triggers stand in for one: on writes, every ID must name a record of the target table
 * (23503 otherwise, as a foreign key would); and deleting target records takes them out of
 * every list that holds them.
 */
async function addMultiLookup(c: PoolClient, t: TableLoc, fieldId: string, column: string, target: { schema: string; pgName: string }) {
  const col = ident(column);
  const tgt = qualified(target);
  const chk = `${ident(t.schema)}.${ident(`mlk_chk_${fieldId}`)}`;
  const del = `${ident(t.schema)}.${ident(`mlk_del_${fieldId}`)}`;
  await c.query(`CREATE FUNCTION ${chk}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.${col} IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(NEW.${col}) x WHERE NOT EXISTS (SELECT 1 FROM ${tgt} r WHERE r.id = x)) THEN
        RAISE foreign_key_violation USING MESSAGE = 'related record missing';
      END IF;
      RETURN NEW;
    END $f$`);
  await c.query(`CREATE TRIGGER ${ident(`mlk_chk_${fieldId}`)} BEFORE INSERT OR UPDATE OF ${col} ON ${qualified(t)} FOR EACH ROW EXECUTE FUNCTION ${chk}()`);
  await c.query(`CREATE FUNCTION ${del}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      UPDATE ${qualified(t)} SET ${col} = NULLIF(ARRAY(SELECT u.x FROM unnest(${col}) WITH ORDINALITY u(x, n) WHERE u.x NOT IN (SELECT id FROM gone) ORDER BY u.n), '{}')
       WHERE ${col} && ARRAY(SELECT id FROM gone);
      RETURN NULL;
    END $f$`);
  await c.query(`CREATE TRIGGER ${ident(`mlk_del_${fieldId}`)} AFTER DELETE ON ${tgt} REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION ${del}()`);
  await c.query(`CREATE INDEX ${ident(`ix_${fieldId}`)} ON ${qualified(t)} USING gin (${col})`);
}

/** Undoes addMultiLookup; the target table may already be gone. */
async function dropMultiLookup(c: PoolClient, schema: string, fieldId: string) {
  await c.query(`DROP FUNCTION IF EXISTS ${ident(schema)}.${ident(`mlk_del_${fieldId}`)}() CASCADE`);
  await c.query(`DROP FUNCTION IF EXISTS ${ident(schema)}.${ident(`mlk_chk_${fieldId}`)}() CASCADE`);
  await c.query(`DROP INDEX IF EXISTS ${ident(schema)}.${ident(`ix_${fieldId}`)}`);
}

async function addFieldIn(c: PoolClient, t: TableLoc, input: FieldInput, position: number): Promise<Field> {
  const name = cleanName(input.name, "Field name");
  if (!isFieldType(input.type) || input.type === "autonumber") throw new FieldValueError("Pick a data type for the field");
  const type: FieldType = input.type;
  const options = cleanOptions(type, input.options);
  const id = newId();
  const pgName = `f_${id}`;
  const required = input.required === true;
  const description = typeof input.description === "string" ? input.description.slice(0, 500) : "";
  const target = isLookup({ type }) ? await checkLookup(c, t, options) : null;
  await c.query(`ALTER TABLE ${qualified(t)} ADD COLUMN ${ident(pgName)} ${pgType(type)}`);
  if (target && type === "multilookup") await addMultiLookup(c, t, id, pgName, target);
  else if (target) {
    await addForeignKey(c, t, id, pgName, target, options.onDelete ?? "restrict");
    if (!options.unique) await c.query(`CREATE INDEX ${ident(`ix_${id}`)} ON ${qualified(t)} (${ident(pgName)})`);
  }
  if (options.unique) await c.query(`CREATE UNIQUE INDEX ${ident(`u_${id}`)} ON ${qualified(t)} (${ident(pgName)})`);
  await c.query(
    `INSERT INTO base_fields (id, table_id, name, pg_name, type, options, required, description, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, t.id, name, pgName, type, options, required, description, position],
  );
  return { id, name, pgName, type, options, required, description, position };
}

/**
 * A new table with an AutoNumber "ID" primary key (as Access makes) and, unless `fields` says
 * otherwise, a "Title" text field (as Lists makes).
 */
export async function createTable(databaseId: string, email: string, input: { name?: unknown; fields?: FieldInput[]; idName?: string }): Promise<TableInfo> {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  if (!canEdit(info.role)) throw forbidden();
  const name = cleanName(input.name, "Table name");
  const fieldInputs = input.fields ?? [{ name: "Title", type: "text" }];
  const idName = input.idName === undefined ? "ID" : cleanName(input.idName, "Field name");
  if (fieldInputs.length > 255) throw new HttpError(400, "A table has at most 255 fields");
  return tx(async (c) => {
    const { rows: d } = await c.query(`SELECT schema_name FROM base_databases WHERE id = $1`, [databaseId]);
    const id = newId();
    const t = { id, databaseId, schema: d[0].schema_name as string, pgName: `t_${id}` };
    await c.query(
      `CREATE TABLE ${qualified(t)} (
         id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
         created_at timestamptz NOT NULL DEFAULT now(),
         created_by text,
         updated_at timestamptz NOT NULL DEFAULT now(),
         updated_by text
       )`,
    );
    const { rows: pos } = await c.query(`SELECT coalesce(max(position) + 1, 0) AS p FROM base_tables WHERE database_id = $1`, [databaseId]);
    await c.query(`INSERT INTO base_tables (id, database_id, name, pg_name, position) VALUES ($1, $2, $3, $4, $5)`, [id, databaseId, name, t.pgName, pos[0].p]);
    const idField = newId();
    await c.query(
      `INSERT INTO base_fields (id, table_id, name, pg_name, type, position) VALUES ($1, $2, $3, 'id', 'autonumber', 0)`,
      [idField, id, idName],
    );
    const fields: Field[] = [{ id: idField, name: idName, pgName: "id", type: "autonumber", options: {}, required: false, description: "", position: 0 }];
    const seen = new Set([idName.toLowerCase()]);
    for (const [i, f] of fieldInputs.entries()) {
      const n = cleanName(f.name, "Field name").toLowerCase();
      if (seen.has(n)) throw new FieldValueError(`There are two fields named ${cleanName(f.name)}`);
      seen.add(n);
      fields.push(await addFieldIn(c, t, f, i + 1));
    }
    await syncView(c, id);
    await touch(c, databaseId);
    return { id, databaseId, name, description: "", position: pos[0].p, fields };
  });
}

function designable(t: TableRef) {
  if (!canEdit(t.role)) throw forbidden();
}

export async function updateTable(tableId: string, email: string, input: { name?: unknown; description?: unknown; position?: unknown }): Promise<TableInfo> {
  const t = await getTable(tableId, email);
  designable(t);
  const name = input.name === undefined ? t.name : cleanName(input.name, "Table name");
  const description = typeof input.description === "string" ? input.description.slice(0, 2000) : t.description;
  const position = Number.isInteger(input.position) ? (input.position as number) : t.position;
  await tx(async (c) => {
    await dropView(c, tableId);
    await c.query(`UPDATE base_tables SET name = $2, description = $3, position = $4 WHERE id = $1`, [tableId, name, description, position]);
    await syncView(c, tableId);
    await touch(c, t.databaseId);
  });
  return { ...t, name, description, position };
}

/** Lookup fields (single or multi-value) in other tables (or this one) that point at `tableId`. */
export async function relationsTo(tableId: string, c?: PoolClient): Promise<Relation[]> {
  const q = c ? c.query.bind(c) : db().q;
  const { rows } = await q(
    `SELECT f.id AS field_id, f.name AS field_name, CASE WHEN f.type = 'multilookup' THEN 'remove' ELSE f.options->>'onDelete' END AS on_delete, t.id AS table_id, t.name AS table_name
       FROM base_fields f JOIN base_tables t ON t.id = f.table_id
      WHERE f.type IN ('lookup', 'multilookup') AND f.options->>'targetTable' = $1
      ORDER BY lower(t.name), f.position`,
    [tableId],
  );
  return rows.map((r) => ({ tableId: r.table_id, tableName: r.table_name, fieldId: r.field_id, fieldName: r.field_name, onDelete: r.on_delete ?? "restrict" }));
}

export async function deleteTable(tableId: string, email: string): Promise<void> {
  const t = await getTable(tableId, email);
  designable(t);
  await tx(async (c) => {
    // As Access does, a table that others look up can't go until those relationships do.
    const others = (await relationsTo(tableId, c)).filter((r) => r.tableId !== tableId);
    const names = others.map((r) => `${r.tableName}.${r.fieldName}`);
    if (names.length) throw new HttpError(409, `Other tables look up ${t.name} (${names.join(", ")}); delete or change those fields first`);
    for (const f of t.fields.filter((x) => x.type === "multilookup")) await dropMultiLookup(c, t.schema, f.id);
    await dropView(c, tableId);
    await c.query(`DROP TABLE IF EXISTS ${qualified(t)}`);
    await c.query(`DELETE FROM base_tables WHERE id = $1`, [tableId]);
    await touch(c, t.databaseId);
  });
}

export async function addField(tableId: string, email: string, input: FieldInput): Promise<Field> {
  return tx(async (c) => {
    const t = await getTable(tableId, email, c);
    designable(t);
    if (t.fields.length >= 255) throw new HttpError(400, "A table has at most 255 fields");
    const position = Math.max(...t.fields.map((f) => f.position)) + 1;
    const f = await addFieldIn(c, t, input, position);
    await syncView(c, tableId);
    await touch(c, t.databaseId);
    return f;
  });
}

/**
 * Renames a field, changes its properties, or changes its data type. A type change converts the
 * values in place (ALTER COLUMN ... USING); if any value can't be converted nothing changes.
 */
export async function updateField(tableId: string, fieldId: string, email: string, input: FieldInput & { position?: unknown }): Promise<Field> {
  return tx(async (c) => {
    const t = await getTable(tableId, email, c);
    designable(t);
    const f = t.fields.find((x) => x.id === fieldId);
    if (!f) throw notFound();
    const name = input.name === undefined ? f.name : cleanName(input.name, "Field name");
    if (f.type === "autonumber") {
      if (input.type !== undefined && input.type !== "autonumber") throw new FieldValueError("The ID field stays an AutoNumber");
      await dropView(c, tableId);
      await c.query(`UPDATE base_fields SET name = $2 WHERE id = $1`, [fieldId, name]);
      await syncView(c, tableId);
      return { ...f, name };
    }
    let type = f.type;
    if (input.type !== undefined) {
      if (!isFieldType(input.type) || input.type === "autonumber") throw new FieldValueError("Pick a data type for the field");
      type = input.type;
    }
    const options: FieldOptions = input.options === undefined ? cleanOptions(type, f.options) : cleanOptions(type, input.options);
    if (type === "lookup" && f.type !== "lookup" && f.type !== "number") {
      throw new FieldValueError("Only a Number field holding record IDs can become a lookup; add a new Lookup field instead");
    }
    if (type === "lookup" && f.type === "lookup" && options.targetTable !== f.options.targetTable) {
      throw new FieldValueError("A lookup keeps the table it looks up; add a new Lookup field for another table");
    }
    if (f.type === "multilookup" && type !== "multilookup") throw new FieldValueError("A multi-value lookup stays one; add a new field of the other type instead");
    if (type === "multilookup" && f.type !== "multilookup" && f.type !== "lookup") throw new FieldValueError("Only a Lookup field can allow multiple values; add a new field instead");
    if (type === "multilookup" && isLookup(f) && options.targetTable !== f.options.targetTable) {
      throw new FieldValueError("A lookup keeps the table it looks up; add a new Lookup field for another table");
    }
    const required = input.required === undefined ? f.required : input.required === true;
    const description = typeof input.description === "string" ? input.description.slice(0, 500) : f.description;
    const position = Number.isInteger(input.position) ? (input.position as number) : f.position;
    const col = ident(f.pgName);
    await dropView(c, tableId);
    const dropFk = async () => {
      await c.query(`ALTER TABLE ${qualified(t)} DROP CONSTRAINT IF EXISTS ${ident(`fk_${f.id}`)}`);
      await c.query(`DROP INDEX IF EXISTS ${ident(t.schema)}.${ident(`ix_${f.id}`)}`);
    };
    if (f.type === "lookup" && (type !== "lookup" || options.onDelete !== f.options.onDelete)) await dropFk();
    if (type !== f.type) {
      await c.query(`DROP INDEX IF EXISTS ${ident(t.schema)}.${ident(`u_${f.id}`)}`);
      await c.query(`ALTER TABLE ${qualified(t)} ALTER COLUMN ${col} TYPE ${pgType(type)} USING ${conversionSql(col, f.type, type)}`);
      if (type === "choice" || type === "multichoice") {
        // Keep the values already there as choices, so converting a text field loses nothing.
        const { rows } = await c.query(
          type === "choice"
            ? `SELECT DISTINCT ${col} AS v FROM ${qualified(t)} WHERE ${col} IS NOT NULL LIMIT 500`
            : `SELECT DISTINCT unnest(${col}) AS v FROM ${qualified(t)} LIMIT 500`,
        );
        const have = new Set(options.choices ?? []);
        options.choices = [...(options.choices ?? []), ...rows.map((r) => String(r.v)).filter((v) => v && !have.has(v))];
      }
    }
    if (type === "multilookup") {
      const target = await checkLookup(c, t, options);
      if (f.type !== "multilookup") await addMultiLookup(c, t, f.id, f.pgName, target);
    }
    if (type === "lookup") {
      const target = await checkLookup(c, t, options);
      if (f.type !== "lookup" || options.onDelete !== f.options.onDelete) {
        // Fails (23503) when a value names a record that doesn't exist, and nothing changes.
        await addForeignKey(c, t, f.id, f.pgName, target, options.onDelete ?? "restrict");
        await c.query(`CREATE INDEX IF NOT EXISTS ${ident(`ix_${f.id}`)} ON ${qualified(t)} (${col})`);
      }
    }
    const hadUnique = !!f.options.unique && f.type === type;
    if (options.unique && !hadUnique) await c.query(`CREATE UNIQUE INDEX ${ident(`u_${f.id}`)} ON ${qualified(t)} (${col})`);
    if (!options.unique && hadUnique) await c.query(`DROP INDEX IF EXISTS ${ident(t.schema)}.${ident(`u_${f.id}`)}`);
    if (required && !f.required) {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${qualified(t)} WHERE ${col} IS NULL`);
      if (rows[0].n > 0) throw new FieldValueError(`${rows[0].n} record${rows[0].n === 1 ? " has" : "s have"} no ${name} yet; fill ${rows[0].n === 1 ? "it" : "them"} in before making the field required`);
    }
    await c.query(
      `UPDATE base_fields SET name = $2, type = $3, options = $4, required = $5, description = $6, position = $7 WHERE id = $1`,
      [fieldId, name, type, options, required, description, position],
    );
    await syncView(c, tableId);
    await touch(c, t.databaseId);
    return { ...f, name, type, options, required, description, position };
  });
}

export async function deleteField(tableId: string, fieldId: string, email: string): Promise<void> {
  await tx(async (c) => {
    const t = await getTable(tableId, email, c);
    designable(t);
    const f = t.fields.find((x) => x.id === fieldId);
    if (!f) throw notFound();
    if (f.type === "autonumber") throw new FieldValueError("The ID field can't be deleted");
    await dropView(c, tableId);
    if (f.type === "multilookup") await dropMultiLookup(c, t.schema, f.id);
    await c.query(`ALTER TABLE ${qualified(t)} DROP COLUMN ${ident(f.pgName)}`);
    await c.query(`DELETE FROM base_fields WHERE id = $1`, [fieldId]);
    await syncView(c, tableId);
    await touch(c, t.databaseId);
  });
}
