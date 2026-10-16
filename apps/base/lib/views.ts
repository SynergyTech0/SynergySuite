/**
 * A readable view for every table: `db_<id>."Customers"` with columns named as the fields are
 * ("ID", "Title", "Order Date" ...). Queries are written against these views, so SQL reads the
 * way the database looks to people, and SQL clients pointed at the schema see the same names.
 *
 * Postgres won't change or drop a column a view uses, so design changes drop the table's view
 * first and make it again afterwards, inside the same transaction.
 */
import type { PoolClient } from "pg";
import { ident, quoteName } from "./names";

type Q = Pick<PoolClient, "query">;

/** Drops the view for table `tableId` under whatever name it has now. */
export async function dropView(c: Q, tableId: string): Promise<void> {
  const { rows } = await c.query(
    `SELECT t.name, d.schema_name FROM base_tables t JOIN base_databases d ON d.id = t.database_id WHERE t.id = $1`,
    [tableId],
  );
  if (rows[0]) await c.query(`DROP VIEW IF EXISTS ${ident(rows[0].schema_name)}.${quoteName(rows[0].name)}`);
}

/** (Re)makes the view for table `tableId` from the catalog as it is now. */
export async function syncView(c: Q, tableId: string): Promise<void> {
  const { rows } = await c.query(
    `SELECT t.name, t.pg_name, d.schema_name FROM base_tables t JOIN base_databases d ON d.id = t.database_id WHERE t.id = $1`,
    [tableId],
  );
  const t = rows[0];
  if (!t) return;
  const { rows: fields } = await c.query(`SELECT name, pg_name FROM base_fields WHERE table_id = $1 ORDER BY position, id`, [tableId]);
  const view = `${ident(t.schema_name)}.${quoteName(t.name)}`;
  const cols = fields.map((f) => `${ident(f.pg_name)} AS ${quoteName(f.name)}`).join(", ");
  await c.query(`DROP VIEW IF EXISTS ${view}`);
  await c.query(`CREATE VIEW ${view} AS SELECT ${cols} FROM ${ident(t.schema_name)}.${ident(t.pg_name)}`);
}

/** Makes any view a database is missing (databases made before views existed). */
export async function ensureViews(c: Q, databaseId: string): Promise<void> {
  const { rows } = await c.query(
    `SELECT t.id FROM base_tables t JOIN base_databases d ON d.id = t.database_id
      WHERE t.database_id = $1
        AND NOT EXISTS (SELECT 1 FROM information_schema.views v WHERE v.table_schema = d.schema_name AND v.table_name = t.name)`,
    [databaseId],
  );
  for (const r of rows) {
    // Two requests may make the same view at once; the second one finds it there.
    await syncView(c, r.id).catch((e) => {
      if (e?.code !== "42P07" && e?.code !== "23505") throw e;
    });
  }
}
