// Applies db/migrations/*.sql in filename order, once each.
//
// Each file carries its own BEGIN/COMMIT, so it is sent through the simple query protocol
// as one unit: a file either applies entirely or not at all. The ledger row is written only
// after the file's own COMMIT succeeds, so a crash mid-run leaves the migration unrecorded
// and re-runnable rather than recorded and half-applied.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminSql } from '../src/lib/db.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'db', 'migrations');
const sql = adminSql({ max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`;

  const applied = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename),
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip   ${file}`);
      continue;
    }
    const body = await readFile(join(dir, file), 'utf8');
    process.stdout.write(`  apply  ${file} ... `);
    await sql.unsafe(body).simple();
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    console.log('ok');
    count++;
  }

  console.log(count ? `\nApplied ${count} migration(s).` : '\nAlready up to date.');
} catch (err) {
  console.error('\nMigration failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
