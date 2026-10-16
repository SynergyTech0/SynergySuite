/**
 * Saved queries: made in the designer or written as SQL, run read only over the database's views
 * (see lib/sql.ts). Queries can read other saved queries by name, as in Access.
 */
import { canEdit, getDatabase, listTables, newId, tx, type DatabaseInfo, type TableInfo } from "./catalog";
import { db, ready } from "./db";
import { cleanDef, designSql, DesignError, type QueryDef } from "./designer";
import { cleanName, FieldValueError } from "./fields";
import { forbidden, notFound } from "./http";
import { prepareSql, QueryError, runPrepared, type QueryResult, type SqlScope } from "./sql";
import { ensureViews } from "./views";

export type QueryKind = "design" | "sql";

export type QueryInfo = {
  id: string;
  databaseId: string;
  name: string;
  kind: QueryKind;
  definition: QueryDef | null;
  sql: string;
  description: string;
  position: number;
  updatedAt: string;
};

function queryRow(r: any): QueryInfo {
  return {
    id: r.id,
    databaseId: r.database_id,
    name: r.name,
    kind: r.kind,
    definition: r.definition ?? null,
    sql: r.sql,
    description: r.description,
    position: r.position,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

async function member(databaseId: string, email: string): Promise<DatabaseInfo> {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  return info;
}

export async function listQueries(databaseId: string, email: string): Promise<QueryInfo[]> {
  await member(databaseId, email);
  const { rows } = await db().q(`SELECT * FROM base_queries WHERE database_id = $1 ORDER BY position, lower(name)`, [databaseId]);
  return rows.map(queryRow);
}

export async function getQuery(id: string, email: string): Promise<QueryInfo & { role: DatabaseInfo["role"] }> {
  await ready();
  const { rows } = await db().q(
    `SELECT q.*, m.role FROM base_queries q JOIN base_members m ON m.database_id = q.database_id AND m.email = $2 WHERE q.id = $1`,
    [id, email],
  );
  if (!rows[0]) throw notFound();
  return { ...queryRow(rows[0]), role: rows[0].role };
}

/**
 * The views (table name → field names) and saved queries (name → SQL) a query may read. A design
 * query's SQL is made again from its grid, so it follows tables and fields renamed since it was saved.
 */
export async function sqlScope(databaseId: string, tables: TableInfo[], exceptQuery?: string): Promise<SqlScope> {
  const { rows: qs } = await db().q(`SELECT id, name, kind, definition, sql FROM base_queries WHERE database_id = $1`, [databaseId]);
  return {
    views: new Map(tables.map((t) => [t.name, t.fields.map((f) => f.name)])),
    queries: new Map(qs.filter((q) => q.id !== exceptQuery).map((q) => [q.name as string, currentSql(q, tables)])),
  };
}

function currentSql(q: { kind: QueryKind; definition: QueryDef | null; sql: string }, tables: TableInfo[]): string {
  if (q.kind !== "design" || !q.definition?.tables?.length) return q.sql;
  try {
    return designSql(cleanDef(q.definition), tables);
  } catch {
    return q.sql;
  }
}

type QueryInput = { name?: unknown; kind?: unknown; definition?: unknown; sql?: unknown; description?: unknown; position?: unknown };

/** The SQL a query input stands for, checked against the database (throws a 400 if it won't run). */
async function compile(databaseId: string, email: string, input: { kind: QueryKind; definition?: unknown; sql?: unknown }, self?: { id: string; name: string }) {
  const tables = await listTables(databaseId, email);
  const scope = await sqlScope(databaseId, tables, self?.id);
  let definition: QueryDef | null = null;
  let sql: string;
  try {
    if (input.kind === "design") {
      definition = cleanDef(input.definition);
      sql = designSql(definition, tables);
    } else {
      if (typeof input.sql !== "string" || !input.sql.trim()) throw new QueryError("Write the query's SQL");
      if (input.sql.length > 100_000) throw new QueryError("That query is too long");
      sql = input.sql.trim().replace(/;\s*$/, "");
    }
  } catch (e) {
    if (e instanceof DesignError) throw new QueryError(e.message);
    throw e;
  }
  // The query being saved or run reads its new SQL under its own name, so a cycle back to it is caught.
  if (self) scope.queries!.set(self.name, sql);
  return { definition, sql, prepared: prepareSql(sql, scope, self?.name) };
}

async function checkName(databaseId: string, name: string) {
  const { rows } = await db().q(`SELECT 1 FROM base_tables WHERE database_id = $1 AND lower(name) = lower($2)`, [databaseId, name]);
  if (rows[0]) throw new FieldValueError(`There's a table called ${name}; give the query another name`);
}

export async function createQuery(databaseId: string, email: string, input: QueryInput): Promise<QueryInfo> {
  const info = await member(databaseId, email);
  if (!canEdit(info.role)) throw forbidden();
  const name = cleanName(input.name, "Query name");
  const kind: QueryKind = input.kind === "sql" ? "sql" : "design";
  await checkName(databaseId, name);
  const { definition, sql } = await compile(databaseId, email, { kind, definition: input.definition ?? { tables: [], columns: [] }, sql: input.sql }).catch((e) => {
    // A new design query may start empty; it is saved and filled in afterwards.
    if (kind === "design" && !(input.definition as QueryDef | undefined)?.tables?.length) return { definition: { tables: [], columns: [] } as QueryDef, sql: "" };
    throw e;
  });
  const description = typeof input.description === "string" ? input.description.slice(0, 2000) : "";
  return tx(async (c) => {
    const { rows: pos } = await c.query(`SELECT coalesce(max(position) + 1, 0) AS p FROM base_queries WHERE database_id = $1`, [databaseId]);
    const { rows } = await c.query(
      `INSERT INTO base_queries (id, database_id, name, kind, definition, sql, description, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [newId(), databaseId, name, kind, definition, sql, description, pos[0].p],
    );
    return queryRow(rows[0]);
  });
}

export async function updateQuery(id: string, email: string, input: QueryInput): Promise<QueryInfo> {
  const q = await getQuery(id, email);
  if (!canEdit(q.role)) throw forbidden();
  const name = input.name === undefined ? q.name : cleanName(input.name, "Query name");
  if (name.toLowerCase() !== q.name.toLowerCase()) await checkName(q.databaseId, name);
  const kind: QueryKind = input.kind === "sql" || input.kind === "design" ? input.kind : q.kind;
  let { definition, sql } = q;
  if (input.kind !== undefined || input.definition !== undefined || input.sql !== undefined) {
    ({ definition, sql } = await compile(q.databaseId, email, { kind, definition: input.definition ?? q.definition, sql: input.sql ?? q.sql }, { id, name }));
    if (kind === "sql") definition = null;
  }
  const description = typeof input.description === "string" ? input.description.slice(0, 2000) : q.description;
  const position = Number.isInteger(input.position) ? (input.position as number) : q.position;
  const { rows } = await db().q(
    `UPDATE base_queries SET name = $2, kind = $3, definition = $4, sql = $5, description = $6, position = $7, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, name, kind, definition, sql, description, position],
  );
  return queryRow(rows[0]);
}

export async function deleteQuery(id: string, email: string): Promise<void> {
  const q = await getQuery(id, email);
  if (!canEdit(q.role)) throw forbidden();
  await db().q(`DELETE FROM base_queries WHERE id = $1`, [id]);
}

export const MAX_RESULT_ROWS = 1000;
export const MAX_EXPORT_ROWS = 200_000;

/**
 * Runs a query: a saved one (`queryId`), or unsaved SQL or a designer definition (Datasheet view
 * of a query being designed). Anyone who can open the database can run its queries.
 */
export async function runQuery(
  databaseId: string,
  email: string,
  input: { queryId?: string; kind?: QueryKind; definition?: unknown; sql?: unknown },
  opts: Parameters<typeof runPrepared>[3] = {},
): Promise<QueryResult & { sql: string }> {
  await member(databaseId, email);
  let source: { kind: QueryKind; definition?: unknown; sql?: unknown } = { kind: input.kind === "sql" ? "sql" : "design", definition: input.definition, sql: input.sql };
  let self: { id: string; name: string } | undefined;
  if (input.queryId) {
    const q = await getQuery(input.queryId, email);
    if (q.databaseId !== databaseId) throw notFound();
    if (!q.sql) throw new QueryError("Add fields to the query first");
    source = q.kind === "design" ? { kind: "design", definition: q.definition } : { kind: "sql", sql: q.sql };
    self = { id: q.id, name: q.name };
  }
  const { prepared } = await compile(databaseId, email, source, self);
  const { rows: d } = await db().q(`SELECT schema_name FROM base_databases WHERE id = $1`, [databaseId]);
  const c = await db().pool.connect();
  try {
    await ensureViews(c, databaseId);
    const result = await runPrepared(c, d[0].schema_name, prepared, { maxRows: MAX_RESULT_ROWS, ...opts });
    return { ...result, sql: prepared };
  } finally {
    c.release();
  }
}
