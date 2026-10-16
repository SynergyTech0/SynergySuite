import { defineConfig } from "vitest/config";
import path from "node:path";

/** Tests that touch Postgres use TEST_DATABASE_URL and skip without it. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], fileParallelism: false, testTimeout: 20000 },
});
