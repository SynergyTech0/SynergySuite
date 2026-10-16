import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  // The database tests share one database (and its audit log), so files run one at a time.
  test: { environment: "node", include: ["test/**/*.test.ts"], fileParallelism: false },
});
