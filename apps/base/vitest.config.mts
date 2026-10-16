import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests that touch Postgres use TEST_DATABASE_URL and skip without it. Each test file makes its
 * own databases (schemas) through the app's code and drops them afterwards, so files may share
 * one Postgres; they still run one at a time to keep the catalog migration simple.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], fileParallelism: false, testTimeout: 20000 },
});
