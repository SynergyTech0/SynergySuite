/**
 * POST /api/search: suite-wide search on behalf of the signed-in person (see @synergy/search).
 *
 * Who can see what, as the rest of the app decides it: a database is visible to its members
 * (base_members), whatever their role, since owners, editors and viewers can all open it and read
 * every table. So search covers the databases the person is a member of: their names and
 * descriptions, their tables' names and descriptions, and the text in their records.
 *
 * Records are searched in their text columns only (Short and Long Text, Choice, Multiple choice,
 * Email, Hyperlink, Phone), and the work per table is capped: at most `limit` rows, a statement
 * timeout, and at most MAX_TABLES tables per request (newest databases first).
 */
import { readSearchQuery, queryToSql, snippet, clipText, matchesQuery, type SearchResult, type SearchResults } from "@synergy/search";
import { qualified } from "./catalog";
import { db, ready } from "./db";
import type { Field, FieldType } from "./fields";
import { ident } from "./names";

export const KINDS = ["database", "table", "record"] as const;
export const MAX_TABLES = 100;
/** How long one table's record search may run. */
export const TABLE_TIMEOUT_MS = 2000;

const TEXT_TYPES = new Set<FieldType>(["text", "longtext", "choice", "multichoice", "email", "hyperlink", "phone"]);

const iso = (d: unknown) => new Date(d as string).toISOString();

const column = (f: Pick<Field, "pgName" | "type">) =>
  f.type === "multichoice" ? `array_to_string(${ident(f.pgName)}, '; ')` : ident(f.pgName);

export async function searchBase(email: string, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  await ready();
  const results: SearchResult[] = [];

  const { rows: dbs } = await db().q(
    `SELECT d.id, d.name, d.description, d.schema_name, d.updated_at, d.created_by
       FROM base_databases d JOIN base_members m ON m.database_id = d.id
      WHERE m.email = $1 ORDER BY d.updated_at DESC`,
    [email],
  );
  if (!dbs.length) return { app: "base", results };
  const byId = new Map(dbs.map((d) => [d.id as string, d]));
  const ids = [...byId.keys()];

  if (want("database")) {
    for (const d of dbs) {
      const text = `${d.name}\n${d.description}`;
      if (!matchesQuery(text, s.parsed)) continue;
      results.push({
        id: `database:${d.id}`, kind: "database", title: d.name,
        snippet: snippet(d.description || d.name, s.parsed), date: iso(d.updated_at), url: `/d/${d.id}`,
        person: d.created_by, ...(s.text ? { text: clipText(text) } : {}),
      });
    }
  }

  const { rows: tables } = await db().q(
    `SELECT t.id, t.database_id, t.name, t.description, t.pg_name, t.created_at
       FROM base_tables t WHERE t.database_id = ANY($1) ORDER BY t.position, lower(t.name)`,
    [ids],
  );

  if (want("table")) {
    for (const t of tables) {
      const d = byId.get(t.database_id)!;
      const text = `${t.name}\n${t.description}`;
      if (!matchesQuery(text, s.parsed)) continue;
      results.push({
        id: `table:${t.id}`, kind: "table", title: `${t.name} · ${d.name}`,
        snippet: snippet(t.description || t.name, s.parsed), date: iso(d.updated_at),
        url: `/d/${t.database_id}?table=${t.id}`, ...(s.text ? { text: clipText(text) } : {}),
      });
    }
  }

  if (want("record") && tables.length) {
    const { rows: fieldRows } = await db().q(
      `SELECT table_id, name, pg_name, type FROM base_fields WHERE table_id = ANY($1) ORDER BY position, id`,
      [tables.map((t) => t.id)],
    );
    const fields = new Map<string, { name: string; pgName: string; type: FieldType }[]>();
    for (const f of fieldRows) {
      if (!TEXT_TYPES.has(f.type)) continue;
      if (!fields.has(f.table_id)) fields.set(f.table_id, []);
      fields.get(f.table_id)!.push({ name: f.name, pgName: f.pg_name, type: f.type });
    }
    // Newest databases first, as the start page lists them, so the cap drops the stalest tables.
    const order = new Map(ids.map((id, i) => [id, i]));
    const scan = tables
      .filter((t) => fields.has(t.id))
      .sort((a, b) => order.get(a.database_id)! - order.get(b.database_id)!)
      .slice(0, MAX_TABLES);
    for (const t of scan) {
      const d = byId.get(t.database_id)!;
      const cols = fields.get(t.id)!;
      for (const r of await recordsIn({ schema: d.schema_name, pgName: t.pg_name }, cols, s.parsed, s.limit)) {
        const values = cols.map((_, i) => r[`c${i}`]).map((v) => (v == null ? "" : String(v)));
        const text = cols.map((c, i) => (values[i] ? `${c.name}: ${values[i]}` : "")).filter(Boolean).join("\n");
        results.push({
          id: `record:${t.id}:${r.id}`, kind: "record",
          title: `${values.find(Boolean) || `Record ${r.id}`} · ${t.name}`,
          snippet: snippet(values.filter(Boolean).join(" · "), s.parsed),
          date: iso(r.updated_at), url: `/d/${t.database_id}?table=${t.id}&record=${r.id}`,
          ...(r.updated_by || r.created_by ? { person: r.updated_by || r.created_by } : {}),
          ...(s.text ? { text: clipText(text) } : {}),
        });
      }
    }
  }

  results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { app: "base", results: results.slice(0, s.limit) };
}

/** Up to `limit` matching records of one table, newest first; none if it times out or fails. */
async function recordsIn(
  t: { schema: string; pgName: string },
  cols: { pgName: string; type: FieldType }[],
  parsed: ReturnType<typeof readSearchQuery>["parsed"],
  limit: number,
): Promise<Record<string, any>[]> {
  const f = queryToSql(parsed, cols.map(column));
  const c = await db().pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query(`SET LOCAL statement_timeout = ${TABLE_TIMEOUT_MS}`);
    const { rows } = await c.query(
      `SELECT id, updated_at, updated_by, created_by, ${cols.map((col, i) => `${column(col)}::text AS c${i}`).join(", ")}
         FROM ${qualified(t)} WHERE ${f.sql} ORDER BY updated_at DESC, id DESC LIMIT ${Math.floor(limit)}`,
      f.params,
    );
    await c.query("COMMIT");
    return rows;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("[base] search skipped a table:", (e as Error).message);
    return [];
  } finally {
    c.release();
  }
}
