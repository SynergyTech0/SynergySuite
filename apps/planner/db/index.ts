import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/synergyboards";

// Single pool across HMR reloads in dev.
const g = globalThis as unknown as { __sbPool?: Pool };
export const pool = g.__sbPool ?? new Pool({ connectionString: url });
if (process.env.NODE_ENV !== "production") g.__sbPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
