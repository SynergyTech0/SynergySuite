import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests run against a THROWAWAY Postgres (docker: sboards-test-db on :55432), never the live
 * sboards-db. tests/setup.ts refuses to run if DATABASE_URL does not name the test database.
 *
 * `fileParallelism: false` + a single fork is load-bearing, not tidiness: every test file shares
 * one database and resetDb() truncates it, so two files running at once would wipe each other's
 * rows mid-assertion. (Vitest 5 removed `poolOptions`; these are the top-level replacements.)
 * The .mts extension keeps Vite's native config loader happy with ESM syntax.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL || "postgresql://postgres:testpw@127.0.0.1:55432/sboards_test",
      MIND_TOKEN: "test-mind-token",
    },
    pool: "forks",
    maxForks: 1,
    minForks: 1,
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
