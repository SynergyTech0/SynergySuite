/**
 * SQL people write (or the query designer and the AI write for them), checked and run safely.
 *
 * A query is one SELECT (WITH, UNION and VALUES included) over the database's readable views:
 * "Customers", "Order Date" and so on, as the tables and fields are named. It is parsed, and only
 * goes ahead if every table it reads is one of those views, a CTE or another saved query, and
 * every function it calls is on a list of ordinary ones (aggregates, text, maths, dates, window
 * functions). What runs is SQL regenerated from the checked parse, inside a READ ONLY
 * transaction with a time limit and the database's schema as the only search path, so nothing a
 * query says can change data or look outside its database.
 *
 * Names are matched without regard to case, as Access does: `select name from customers` reads
 * "Customers"."Name". Access-style [Bracketed Names] are accepted too.
 */
import { parse, toSql, type Statement } from "pgsql-ast-parser";
import type { PoolClient } from "pg";
import { HttpError } from "./http";
import { quoteName } from "./names";

export class QueryError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

/** What a query may read: the database's views (name → field names) and its saved queries (name → SQL). */
export type SqlScope = {
  views: Map<string, string[]>;
  queries?: Map<string, string>;
};

const FUNCTIONS = new Set(
  `count sum avg min max string_agg array_agg bool_and bool_or every stddev stddev_pop stddev_samp variance var_pop var_samp
   percentile_cont percentile_disc mode corr covar_pop covar_samp regr_slope regr_intercept
   row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value
   abs ceil ceiling floor round trunc mod power sqrt cbrt exp ln log log10 sign pi greatest least div random width_bucket
   lower upper initcap length char_length character_length octet_length trim ltrim rtrim btrim substr left right replace
   concat concat_ws strpos position lpad rpad split_part reverse starts_with translate ascii chr md5
   regexp_replace regexp_match regexp_matches regexp_split_to_array to_char to_number to_date to_timestamp format
   now date_trunc date_part age make_date make_time make_timestamp make_interval justify_days justify_hours isfinite
   coalesce nullif exists any all some array_length cardinality array_to_string array_position unnest array_remove array_append
   generate_series`.split(/\s+/),
);

/** Table functions allowed in FROM. */
const FROM_FUNCTIONS = new Set(["generate_series", "unnest"]);

const KEYWORDS = new Set(["current_date", "current_time", "current_timestamp", "localtime", "localtimestamp"]);

const TYPES = new Set(
  `text varchar char character int int2 int4 int8 integer smallint bigint numeric decimal real float float4 float8
   double precision boolean bool date time timestamp timestamptz interval
   character varying timestamp with time zone timestamp without time zone time without time zone`.split(/\s+/),
);

const TYPE_NAMES = new Set([...TYPES, "double precision", "character varying", "timestamp with time zone", "timestamp without time zone", "time without time zone"]);

const STATEMENTS = new Set(["select", "union", "union all", "with", "with recursive", "values"]);

/** The parser keeps "a""b" as a""b; this is the name it stands for. */
const unescape = (n: string) => n.replace(/""/g, '"');
const escape = (n: string) => n.replace(/"/g, '""');

/** Access-style [Field Name] → "Field Name", leaving strings, quoted names and array subscripts alone. */
export function convertBrackets(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = closing(sql, i, ch);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "[") {
      const end = sql.indexOf("]", i);
      const inner = end < 0 ? "" : sql.slice(i + 1, end);
      // Array subscripts and ARRAY[...] stay as they are: x[1], "Tags"[n + 1], ARRAY[a, b].
      const afterValue = /[\w")\]]\s*$/.test(out);
      const subscript = afterValue && (/^\s*\w+\s*$/.test(inner) ? /^\s*\d+\s*$/.test(inner) : /[-+*/:]/.test(inner));
      const array = /\barray\s*$/i.test(out) || /,/.test(inner);
      if (end > i && !array && !subscript && /[A-Za-z_]/.test(inner) && !/['"[]/.test(inner)) {
        out += quoteName(inner.trim());
        i = end + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function closing(sql: string, start: number, q: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === q) {
      if (sql[i + 1] === q) i += 2;
      else return i + 1;
    } else i++;
  }
  return sql.length;
}

function parseOne(sql: string): Statement {
  let stmts: Statement[];
  try {
    stmts = parse(convertBrackets(sql));
  } catch (e) {
    const msg = String((e as Error).message ?? "").split("\n")[0];
    const where = msg.match(/line (\d+) col (\d+)/);
    throw new QueryError(where ? `The SQL has a mistake near line ${where[1]}, column ${where[2]}` : "The SQL couldn't be read");
  }
  if (stmts.length === 0) throw new QueryError("Write a SELECT query");
  if (stmts.length > 1) throw new QueryError("Write one query at a time");
  if (!STATEMENTS.has(stmts[0].type)) throw new QueryError("Queries only read data: write a SELECT");
  return stmts[0];
}

type Node = Record<string, any>;

function walk(node: unknown, fn: (n: Node, parentKey: string) => void, key = ""): void {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, fn, key);
    return;
  }
  if (!node || typeof node !== "object") return;
  fn(node as Node, key);
  for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, fn, k);
}

function checkType(to: Node | undefined): void {
  if (!to) return;
  if (to.kind === "array") return checkType(to.arrayOf);
  const name = String(to.name ?? "").toLowerCase();
  if (to.schema || !TYPE_NAMES.has(name)) throw new QueryError(`Converting to ${to.name} isn't allowed in a query`);
}

/** Finds `name` in `names` exactly, else ignoring case when that picks out one. */
function match(names: Iterable<string>, name: string): string | null {
  const want = unescape(name);
  const all = [...names];
  if (all.includes(want)) return want;
  const hits = all.filter((n) => n.toLowerCase() === want.toLowerCase());
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Checks `sql` against `scope` and returns the SQL to run: regenerated from the parse, with
 * names in their proper case and any saved queries it reads included as CTEs.
 */
export function prepareSql(sql: string, scope: SqlScope, self?: string): string {
  return toSql.statement(check(parseOne(sql), scope, self ? [self] : []));
}

/** `reads` collects the views the query reads, through saved queries too (for matching field names). */
function check(stmt: Statement, scope: SqlScope, stack: string[], reads = new Set<string>()): Statement {
  // Names a query may read besides the views: its own CTEs.
  const ctes = new Set<string>();
  walk(stmt, (n) => {
    if (n.type === "with") for (const b of n.bind ?? []) ctes.add(unescape(b.alias.name));
    if (n.type === "with recursive" && n.alias) ctes.add(unescape(n.alias.name));
  });
  const used = reads;
  const saved = new Map<string, Statement>();
  walk(stmt, (n, key) => {
    if (typeof n.type === "string" && n.type !== "select" && (key === "statement" || key === "bind" || key === "in") && !STATEMENTS.has(n.type)) {
      throw new QueryError("Queries only read data: write a SELECT");
    }
    if (n.statement && typeof n.statement === "object" && typeof n.statement.type === "string" && !STATEMENTS.has(n.statement.type)) {
      throw new QueryError("Queries only read data: write a SELECT");
    }
    switch (n.type) {
      case "table": {
        const ref = n.name;
        if (!ref || typeof ref.name !== "string") break;
        if (ref.schema) throw new QueryError(`Read the database's own tables, not ${ref.schema}.${ref.name}`);
        if (ctes.has(unescape(ref.name))) break;
        const view = match(scope.views.keys(), ref.name);
        if (view) {
          ref.name = escape(view);
          used.add(view);
          break;
        }
        const q = scope.queries && match(scope.queries.keys(), ref.name);
        if (q) {
          ref.name = escape(q);
          if (!saved.has(q)) {
            if (stack.includes(q)) throw new QueryError(`The query ${q} reads itself`);
            if (stack.length > 8) throw new QueryError("Queries read each other too deeply");
            saved.set(q, check(parseOne(scope.queries!.get(q)!), scope, [...stack, q], used));
          }
          break;
        }
        throw new QueryError(`There's no table or query called ${unescape(ref.name)}`);
      }
      case "call": {
        const f = n.function ?? {};
        const name = String(f.name ?? "").toLowerCase();
        if (f.schema || !FUNCTIONS.has(name)) throw new QueryError(`The function ${f.name} isn't available in queries`);
        if (key === "from" && !FROM_FUNCTIONS.has(name)) throw new QueryError(`${f.name} can't be used as a table`);
        break;
      }
      case "cast":
        checkType(n.to);
        break;
      case "keyword":
        if (!KEYWORDS.has(String(n.keyword).toLowerCase())) throw new QueryError(`${n.keyword} isn't available in queries`);
        break;
      case "parameter":
        throw new QueryError("Queries can't take $ parameters; put the value in the SQL");
      case "ref":
        if (n.table?.schema) throw new QueryError(`Read the database's own tables, not ${n.table.schema}.${n.table.name}`);
        break;
    }
    if (n.type && /^(insert|update|delete|create|drop|alter|truncate|set|show|begin|commit|rollback|start|do|tablespace|prepare|deallocate|comment|raise)/.test(n.type)) {
      throw new QueryError("Queries only read data: write a SELECT");
    }
  });
  // Field and table names in the case they are stored in, where the query wrote them otherwise.
  const fields = [...used].flatMap((v) => scope.views.get(v)!);
  const aliases = new Set<string>();
  walk(stmt, (n) => {
    if (n.alias && typeof n.alias.name === "string") aliases.add(unescape(n.alias.name));
    if (typeof n.alias === "string") aliases.add(unescape(n.alias));
    if (n.name && typeof n.name.alias === "string") aliases.add(unescape(n.name.alias));
  });
  walk(stmt, (n) => {
    if (n.type !== "ref") return;
    if (n.name !== "*" && !fields.includes(unescape(n.name)) && !aliases.has(unescape(n.name))) {
      const f = match(new Set(fields), n.name);
      if (f) n.name = escape(f);
    }
    if (n.table && !aliases.has(unescape(n.table.name)) && !ctes.has(unescape(n.table.name))) {
      const v = match(used, n.table.name) ?? (scope.queries && saved.size ? match(saved.keys(), n.table.name) : null);
      if (v) n.table.name = escape(v);
    }
  });
  if (!saved.size) return stmt;
  const binds = [...saved].map(([name, s]) => ({ alias: { name: escape(name) }, statement: s }));
  if (stmt.type === "with") return { ...stmt, bind: [...binds, ...stmt.bind] } as Statement;
  return { type: "with", bind: binds, in: stmt } as unknown as Statement;
}

/**
 * toSql prints ANY(...) and ALL(...) as calls to quoted functions ("any" (x)), which Postgres
 * reads as a function name, and wraps them in parentheses when they're the right side of a
 * comparison (x = ("any" (y))), which Postgres refuses; put the keywords back and drop those
 * parentheses, leaving string literals alone.
 */
export function fixKeywordCalls(sql: string): string {
  let out = "";
  let i = 0;
  const drop = new Set<number>();
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = closing(sql, i, "'");
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (drop.has(i)) {
      i++;
      continue;
    }
    if (sql[i] === "(" && /^\(\s*"(any|all|some)"\s*\(/.test(sql.slice(i))) {
      drop.add(matchingParen(sql, i));
      i++;
      continue;
    }
    const m = sql.slice(i).match(/^"(any|all|some)"(\s*)\(/);
    if (m) {
      out += `${m[1].toUpperCase()}${m[2]}(`;
      i += m[0].length;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/** The index of the parenthesis closing the one at `start`, skipping quoted text. */
function matchingParen(sql: string, start: number): number {
  let depth = 0;
  for (let i = start; i < sql.length; ) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      i = closing(sql, i, ch);
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
    i++;
  }
  return -1;
}

export type ColumnKind = "number" | "text" | "date" | "datetime" | "yesno" | "list" | "other";

export type QueryResult = {
  columns: { name: string; kind: ColumnKind }[];
  rows: unknown[][];
  /** More rows matched than were returned. */
  truncated: boolean;
  ms: number;
};

const KINDS: Record<number, ColumnKind> = {
  20: "number", 21: "number", 23: "number", 700: "number", 701: "number", 1700: "number", 790: "number",
  25: "text", 1043: "text", 1042: "text", 19: "text",
  1082: "date", 1114: "datetime", 1184: "datetime",
  16: "yesno",
  1009: "list", 1015: "list", 1007: "list", 1016: "list", 1231: "list",
};

/** Postgres's own words for mistakes in a query (unknown column, type mismatch ...) are passed on. */
function queryFailure(e: unknown): never {
  const err = e as { code?: string; message?: string };
  if (err.code === "57014") throw new HttpError(408, "The query took too long and was stopped");
  if (err.code && /^(42|22|2201|0A|21|25|54)/.test(err.code)) throw new QueryError(err.message ?? "The query failed");
  throw e;
}

/**
 * Runs prepared SQL read only in `schema`, returning at most `maxRows` rows (and whether there
 * were more). `c` is a connection of its own; the transaction is opened and closed here.
 */
export async function runPrepared(
  c: PoolClient,
  schema: string,
  sql: string,
  opts: { maxRows?: number; timeoutMs?: number; onBatch?: (rows: unknown[][], columns: QueryResult["columns"]) => Promise<void> } = {},
): Promise<QueryResult> {
  const maxRows = opts.maxRows ?? 1000;
  const started = Date.now();
  await c.query("BEGIN READ ONLY");
  try {
    await c.query(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(opts.timeoutMs ?? 15000))}`);
    // pg_catalog (and pg_temp) are listed after the schema, or Postgres would search them first and
    // a table called pg_user would read the system's instead of the database's own.
    await c.query(`SET LOCAL search_path = ${quoteName(schema)}, pg_catalog, pg_temp`);
    await c.query(`DECLARE base_query NO SCROLL CURSOR FOR ${fixKeywordCalls(sql)}`).catch(queryFailure);
    let columns: QueryResult["columns"] = [];
    const rows: unknown[][] = [];
    let truncated = false;
    if (opts.onBatch) {
      // Streaming (CSV): batches until maxRows.
      let total = 0;
      for (;;) {
        const r = await c.query({ text: "FETCH 2000 FROM base_query", rowMode: "array" }).catch(queryFailure);
        columns = r.fields.map((f) => ({ name: f.name, kind: KINDS[f.dataTypeID] ?? "other" }));
        const batch = r.rows.slice(0, Math.max(0, maxRows - total));
        if (batch.length || total === 0) await opts.onBatch(batch, columns);
        total += batch.length;
        if (r.rows.length < 2000 || total >= maxRows) {
          truncated = r.rows.length > batch.length;
          break;
        }
      }
    } else {
      const r = await c.query({ text: `FETCH ${maxRows + 1} FROM base_query`, rowMode: "array" }).catch(queryFailure);
      columns = r.fields.map((f) => ({ name: f.name, kind: KINDS[f.dataTypeID] ?? "other" }));
      truncated = r.rows.length > maxRows;
      rows.push(...r.rows.slice(0, maxRows));
    }
    await c.query("COMMIT");
    return { columns, rows, truncated, ms: Date.now() - started };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}
