import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";

export type Db = {
  pool: Pool;
  /** Run one parameterized query. */
  q<R extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  /**
   * Apply an idempotent schema script (CREATE ... IF NOT EXISTS, ALTER ... IF NOT EXISTS).
   * Runs under a Postgres advisory lock so several replicas booting at once don't race.
   */
  migrate(sql: string, lockKey?: string): Promise<void>;
  close(): Promise<void>;
};

export type DbOptions = PoolConfig & {
  /** Used when DATABASE_URL is not set; meant for local development only. */
  devUrl?: string;
};

export function createDb(opts: DbOptions = {}): Db {
  const { devUrl, ...poolConfig } = opts;
  const connectionString = poolConfig.connectionString || process.env.DATABASE_URL || devUrl;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production" && !poolConfig.connectionString) {
    throw new Error("DATABASE_URL must be set in production");
  }
  const pool = new Pool({ ...poolConfig, connectionString });

  return {
    pool,
    q: (text, params) => pool.query(text, params as any[]),
    async migrate(sql, lockKey = "synergy-migrate") {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
        try {
          await client.query(sql);
        } finally {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
        }
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
