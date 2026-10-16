import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The guard in tests/setup.ts is the only thing standing between `npm test` and the LIVE database
 * (sboards-db holds real boards and 783 real cards, and resetDb() truncates every table). A guard
 * nobody tests is a guard nobody can trust, so this runs the real setup file in a child process
 * with hostile DATABASE_URL values and asserts it refuses.
 */
const setupFile = path.resolve(import.meta.dirname, "setup.ts");

function runSetupWith(databaseUrl: string | undefined) {
  const env = { ...process.env };
  if (databaseUrl === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = databaseUrl;

  try {
    // Node 22 can run TypeScript directly; the setup file is plain type-free JS at runtime.
    execFileSync(process.execPath, ["--experimental-strip-types", setupFile], {
      env,
      stdio: "pipe",
      encoding: "utf8",
    });
    return { refused: false, message: "" };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return { refused: true, message: `${e.stderr ?? ""}${e.message ?? ""}` };
  }
}

describe("test database guard", () => {
  it("refuses the live production database url", () => {
    const result = runSetupWith("postgresql://postgres:secret@127.0.0.1:5432/synergyboards");
    expect(result.refused).toBe(true);
    expect(result.message).toMatch(/must point at the throwaway sboards_test database/);
  });

  it("refuses when DATABASE_URL is unset", () => {
    const result = runSetupWith(undefined);
    expect(result.refused).toBe(true);
  });

  it("refuses a database whose name merely starts with the test name", () => {
    // "sboards_test_live" must not pass as "sboards_test"
    const result = runSetupWith("postgresql://postgres:pw@127.0.0.1:5432/sboards_test_live");
    expect(result.refused).toBe(true);
  });

  it("allows the throwaway test database", () => {
    const result = runSetupWith("postgresql://postgres:testpw@127.0.0.1:55432/sboards_test");
    expect(result.refused).toBe(false);
  });
});
