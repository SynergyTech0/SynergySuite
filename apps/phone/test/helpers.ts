import { createDb } from "@synergy/db";

/** A database of its own next to TEST_DATABASE_URL ("<name>_<suffix>"), so test files can run side by side. */
export async function ownDatabase(url: string, suffix: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_${suffix}`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

export const noPolicy = { onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} };
