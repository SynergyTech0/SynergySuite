import { describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";

// An install from before Whiteboard has no database for it yet: the app makes one on first start.
const base = process.env.TEST_DATABASE_URL;

describe.skipIf(!base)("first start on an older install", () => {
  it("makes its own database", async () => {
    const u = new URL(base!);
    const name = `${u.pathname.slice(1)}_fresh`;
    const admin = createDb({ connectionString: base!, max: 1 });
    await admin.q(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    u.pathname = `/${name}`;
    process.env.DATABASE_URL = u.toString();
    const { q, db } = await import("../lib/db");
    expect(await q("SELECT COUNT(*)::int AS n FROM boards")).toEqual([{ n: 0 }]);
    await db().close();
    await admin.q(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.close();
  });
});
