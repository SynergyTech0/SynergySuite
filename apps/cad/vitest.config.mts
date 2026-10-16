import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  // Only our tests: engine/ holds upstream checkouts with suites of their own.
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
