import { Client } from "pg";
import { type InsightsConfig, SOURCE_NAMES, readerPassword } from "./config";
import { type ExecutiveResult, provisionExecutive } from "./executive";
import type { Metabase } from "./metabase";

/**
 * The suite's own databases as read-only data sources. Insights keeps one Postgres role
 * (INSIGHTS_READER_ROLE, default insights_reader) that can log in, can only read, and can only
 * see the columns that are safe to report on: anything that looks like a password, token, key,
 * hash, PIN or encrypted value is left out. Metabase connects to each source as that role.
 *
 * Grants are worked out table by table on every sync (at start, every INSIGHTS_SYNC_MINUTES and
 * from the admin page), never by default privileges, so a table added later is invisible until
 * a sync has checked its columns.
 */

/** Column names that never reach a report. */
export const SECRET_COLUMN =
  /(pass(word|wd)?|secret|token|api_?key|private_?key|hash|salt|encrypt|_enc$|^pin$|_pin$|pin_|Pin$|(^|_)otp(_|$)|mfa|totp|credential|ssn|tax_?id|account_?number|routing_?number|iban|cvv|card_?number)/i;

export function isSecretColumn(name: string): boolean {
  return SECRET_COLUMN.test(name);
}

const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"';

export interface SourceResult {
  source: string;
  name: string;
  status: "ok" | "missing" | "error";
  tables: number;
  hiddenColumns: string[];
  metabaseId?: number;
  detail?: string;
}

export interface SyncReport {
  at: string;
  ok: boolean;
  error?: string;
  sources: SourceResult[];
  /** How setting up the Executive overview went. */
  executive?: ExecutiveResult;
}

/** Gives the reader role exactly the safe columns of one database. Returns what it can now see. */
export async function grantReader(c: InsightsConfig, db: string): Promise<{ tables: number; hiddenColumns: string[] }> {
  if (!c.pgUrl) throw new Error("INSIGHTS_PG_URL is not set");
  const client = new Client({ connectionString: `${c.pgUrl}/${db}` });
  await client.connect();
  try {
    const role = ident(c.readerRole);
    const password = readerPassword(c);
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${c.readerRole.replace(/'/g, "''")}') THEN
           CREATE ROLE ${role} LOGIN;
         END IF;
       END $$`,
    );
    await client.query(`ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await client.query(`ALTER ROLE ${role} SET default_transaction_read_only = on`);
    await client.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO ${role}`);

    const { rows } = await client.query<{ schema: string; table: string; columns: string[] }>(
      `SELECT c.table_schema AS schema, c.table_name AS table, array_agg(c.column_name::text ORDER BY c.ordinal_position) AS columns
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg_%'
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        GROUP BY c.table_schema, c.table_name
        ORDER BY 1, 2`,
    );
    const hidden: string[] = [];
    const schemas = new Set(rows.map((r) => r.schema));
    for (const s of schemas) await client.query(`GRANT USAGE ON SCHEMA ${ident(s)} TO ${role}`);
    for (const r of rows) {
      const t = `${ident(r.schema)}.${ident(r.table)}`;
      const secret = r.columns.filter(isSecretColumn);
      // Table-wide SELECT covers every column, so it is taken away before column grants count.
      await client.query(`REVOKE ALL ON ${t} FROM ${role}`);
      if (secret.length === 0) {
        await client.query(`GRANT SELECT ON ${t} TO ${role}`);
        continue;
      }
      hidden.push(...secret.map((col) => `${r.schema === "public" ? "" : r.schema + "."}${r.table}.${col}`));
      const safe = r.columns.filter((col) => !isSecretColumn(col));
      if (safe.length) await client.query(`GRANT SELECT (${safe.map(ident).join(", ")}) ON ${t} TO ${role}`);
    }
    return { tables: rows.length, hiddenColumns: hidden };
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface MbDatabase {
  id: number;
  name: string;
  engine: string;
  details?: { host?: string; port?: number; dbname?: string; db?: string; user?: string };
}

type Graph = { revision: number; groups: Record<string, Record<string, Record<string, unknown>>> };

/**
 * Who may do what with a newly connected source: everyone can see results in dashboards and
 * saved questions they can open, only analysts (and admins) can write new queries. Set once,
 * when the source is first connected; changes made later in Metabase's admin settings stay.
 */
async function setDefaultPermissions(mb: Metabase, dbId: number): Promise<void> {
  const groupsList = await mb.asService<{ id: number; magic_group_type?: string | null }[]>("/api/permissions/group");
  const allUsers = groupsList.find((g) => g.magic_group_type === "all-internal-users")?.id ?? 1;
  const analysts = await mb.analystsGroupId();
  const graph = await mb.asService<Graph>("/api/permissions/graph");
  const everyone = mb.c.analysts === "*";
  await mb.asService("/api/permissions/graph", {
    method: "PUT",
    body: {
      revision: graph.revision,
      groups: {
        [allUsers]: { [dbId]: { "view-data": "unrestricted", "create-queries": everyone ? "query-builder-and-native" : "no", download: { schemas: "full" } } },
        [analysts]: { [dbId]: { "view-data": "unrestricted", "create-queries": "query-builder-and-native", download: { schemas: "full" } } },
      },
    },
  });
}

/** Connects (or updates) one suite database in Metabase as the reader role. */
export async function registerSource(mb: Metabase, source: string): Promise<number> {
  const c = mb.c;
  const name = SOURCE_NAMES[source] ?? source[0].toUpperCase() + source.slice(1);
  const details = { host: c.pgHost, port: c.pgPort, dbname: source, user: c.readerRole, password: readerPassword(c), ssl: false };
  const r = await mb.asService<{ data: MbDatabase[] } | MbDatabase[]>("/api/database");
  const list = Array.isArray(r) ? r : r.data;
  const existing = list.find(
    (d) => d.engine === "postgres" && (d.details?.dbname ?? d.details?.db) === source && d.details?.host === c.pgHost,
  );
  if (existing) {
    if (existing.details?.user !== c.readerRole) {
      await mb.asService(`/api/database/${existing.id}`, { method: "PUT", body: { details: { ...existing.details, ...details } } });
    }
    await mb.asService(`/api/database/${existing.id}/sync_schema`, { body: {} }).catch(() => undefined);
    return existing.id;
  }
  const made = await mb.asService<MbDatabase>("/api/database", {
    body: { engine: "postgres", name, details, is_full_sync: true, is_on_demand: false },
  });
  await setDefaultPermissions(mb, made.id);
  return made.id;
}

async function databaseExists(c: InsightsConfig, db: string): Promise<boolean> {
  const client = new Client({ connectionString: `${c.pgUrl}/postgres` });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
    return (rowCount ?? 0) > 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Next.js loads instrumentation.ts and the routes as separate module copies, so the state
// they share lives on globalThis.
const state = ((globalThis as { __insightsSync?: { last: SyncReport | null; running: Promise<SyncReport> | null } }).__insightsSync ??= {
  last: null,
  running: null,
});

export function lastSync(): SyncReport | null {
  return state.last;
}

/**
 * Sets Metabase up if needed, brings every source's grants and connection up to date, then
 * makes sure the Executive overview exists over the sources that are connected.
 */
export function syncAll(mb: Metabase): Promise<SyncReport> {
  if (state.running) return state.running;
  state.running = (async (): Promise<SyncReport> => {
    const c = mb.c;
    const sources: SourceResult[] = [];
    try {
      await mb.ensureSetup();
      await mb.configure();
      await mb.analystsGroupId();
      for (const source of c.sources) {
        const name = SOURCE_NAMES[source] ?? source;
        try {
          if (!(await databaseExists(c, source))) {
            sources.push({ source, name, status: "missing", tables: 0, hiddenColumns: [], detail: "No database by this name (is the app installed?)" });
            continue;
          }
          const g = await grantReader(c, source);
          const metabaseId = await registerSource(mb, source);
          sources.push({ source, name, status: "ok", ...g, metabaseId });
        } catch (err) {
          sources.push({ source, name, status: "error", tables: 0, hiddenColumns: [], detail: (err as Error).message });
        }
      }
      const databases = Object.fromEntries(sources.filter((s) => s.metabaseId).map((s) => [s.source, s.metabaseId!]));
      const executive = await provisionExecutive(mb, databases).catch(
        (err): ExecutiveResult => ({ status: "error", cards: 0, detail: (err as Error).message }),
      );
      state.last = {
        at: new Date().toISOString(),
        ok: sources.every((s) => s.status !== "error") && executive.status !== "error",
        sources,
        executive,
      };
    } catch (err) {
      state.last = { at: new Date().toISOString(), ok: false, error: (err as Error).message, sources };
    }
    return state.last;
  })().finally(() => {
    state.running = null;
  });
  return state.running;
}
