/**
 * The one rail that matters: a test run must never reach the live database. sboards-db holds real
 * boards and 783 real cards, and resetDb() truncates every table — so this refuses to start unless
 * DATABASE_URL names the throwaway test database.
 */
const url = process.env.DATABASE_URL || "";

if (!/\/sboards_test(\?|$)/.test(url)) {
  throw new Error(
    `refusing to run tests against ${url || "(DATABASE_URL unset)"} — it must point at the ` +
      `throwaway sboards_test database (docker container sboards-test-db on :55432)`,
  );
}
