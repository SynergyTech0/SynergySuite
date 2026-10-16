// Needs a reachable Postgres in TEST_DATABASE_URL; skipped otherwise.
const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('..');

const url = process.env.TEST_DATABASE_URL;

test('createDb refuses to start with no database configured', () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try { assert.throws(() => createDb()); } finally { if (saved) process.env.DATABASE_URL = saved; }
});

test('migrate is idempotent and safe to run concurrently', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const db = createDb({ connectionString: url });
  try {
    const sql = 'CREATE TABLE IF NOT EXISTS synergy_db_test (id serial primary key, v text)';
    await Promise.all([db.migrate(sql), db.migrate(sql), db.migrate(sql)]);
    await db.q('INSERT INTO synergy_db_test (v) VALUES ($1)', ['x']);
    const { rows } = await db.q('SELECT count(*)::int AS n FROM synergy_db_test');
    assert.ok(rows[0].n >= 1);
    await db.q('DROP TABLE synergy_db_test');
  } finally {
    await db.close();
  }
});
