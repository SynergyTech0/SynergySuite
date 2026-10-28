import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  // The database tests share one database (and its audit log), so files run one at a time.
  // bcrypt(12) on every sign-in makes the database tests slower than vitest's 5 s default.
  test: { environment: 'node', include: ['test/**/*.test.ts'], fileParallelism: false, testTimeout: 60_000 },
});
