import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { embedUrl } from "@/lib/bridge";
import { ensureEmbeddable, getDashboard, listDashboards } from "@/lib/dashboards";
import { Metabase } from "@/lib/metabase";
import { searchFor } from "@/lib/search";
import { syncAll } from "@/lib/sources";

/**
 * Against a real Metabase (open source edition) and Postgres, with the books and crm databases
 * present. Not run in CI: set METABASE_TEST_URL (e.g. http://localhost:3000, a Metabase that
 * hasn't been set up yet or was set up by Insights with the same secret) and TEST_DATABASE_URL.
 */
const mbUrl = process.env.METABASE_TEST_URL;
const pg = process.env.TEST_DATABASE_URL;

describe.skipIf(!mbUrl || !pg)("Insights with a live Metabase", () => {
  const c = config({
    METABASE_INTERNAL_URL: mbUrl,
    INSIGHTS_SECRET: "live-test-secret",
    INSIGHTS_PG_URL: pg,
    INSIGHTS_PG_HOST: "127.0.0.1",
    INSIGHTS_SOURCES: "books,crm,nothere",
    ADMIN_EMAILS: "boss@example.com",
    INSIGHTS_ANALYST_EMAILS: "ana@example.com",
    SUITE_DOMAIN: "example.com",
  });
  const mb = new Metabase(c);
  let books = 0;

  it("sets Metabase up and connects the sources, twice over", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await syncAll(mb);
      expect(r.error).toBeUndefined();
      const by = Object.fromEntries(r.sources.map((s) => [s.source, s]));
      expect(by.books.status, by.books.detail).toBe("ok");
      expect(by.books.hiddenColumns).toEqual(expect.arrayContaining(["User.password", "User.resetToken"]));
      expect(by.crm.status).toBe("ok");
      expect(by.nothere.status).toBe("missing");
      books = by.books.metabaseId!;
    }
    const dbs = await mb.asService<{ data: { name: string }[] }>("/api/database");
    expect(dbs.data.filter((d) => d.name === "Books")).toHaveLength(1);
    expect(await mb.asService("/api/setting/enable-embedding-static")).toBe(true);
  }, 120_000);

  const native = (email: string, sql: string) =>
    mb.asPerson(email, email, "/api/dataset", { body: { database: books, type: "native", native: { query: sql } } }) as Promise<{
      status?: string;
      error?: string;
      data?: { rows: unknown[][] };
    }>;

  it("lets admins and analysts query, never the secret columns, and nobody else", async () => {
    const boss = await native("boss@example.com", 'SELECT total FROM "Invoice" ORDER BY id');
    expect(boss.data?.rows).toEqual([[1200], [800]]);
    const ana = await native("ana@example.com", 'SELECT email FROM "User"');
    expect(ana.data?.rows).toEqual([["a@x.com"]]);
    // Metabase answers a failed query with 400 and the database's error.
    await expect(native("ana@example.com", 'SELECT password FROM "User"')).rejects.toThrow(/permission denied/);
    await expect(native("boss@example.com", 'DELETE FROM "Invoice"')).rejects.toThrow(/read-only|permission denied/);
    await expect(native("joe@example.com", "SELECT 1")).rejects.toMatchObject({ status: 403 });
    const me = await mb.asPerson<{ is_superuser: boolean }>("boss@example.com", "Boss", "/api/user/current");
    expect(me.is_superuser).toBe(true);
  }, 60_000);

  it("shows a dashboard to people who can open it, through a signed embed", async () => {
    const d = await mb.asPerson<{ id: number }>("boss@example.com", "Boss", "/api/dashboard", {
      body: { name: `Sales overview ${Date.now()}`, description: "Revenue by month" },
    });
    const list = await listDashboards(mb, "joe@example.com", "Joe");
    expect(list.map((x) => x.id)).toContain(d.id);
    expect(await getDashboard(mb, "joe@example.com", "Joe", d.id)).toMatchObject({ id: d.id });
    expect(await getDashboard(mb, "joe@example.com", "Joe", 999999)).toBeNull();
    await ensureEmbeddable(mb, d.id);
    const { url } = embedUrl(c, d.id);
    const token = url.split("/")[4].split("#")[0];
    const res = await fetch(`${mbUrl}/api/embed/dashboard/${token}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toMatch(/^Sales overview/);
    const forged = await fetch(`${mbUrl}/api/embed/dashboard/${token.slice(0, -2)}xx`);
    expect(forged.status).toBeGreaterThanOrEqual(400);

    // Metabase indexes new dashboards for search shortly after they are made.
    let found = await searchFor(mb, { email: "joe@example.com", name: "Joe" }, { query: "sales overview" });
    for (let i = 0; i < 20 && !found.results.some((r) => r.id === `dashboard-${d.id}`); i++) {
      await new Promise((r) => setTimeout(r, 500));
      found = await searchFor(mb, { email: "joe@example.com", name: "Joe" }, { query: "sales overview" });
    }
    expect(found.results.find((r) => r.id === `dashboard-${d.id}`)).toMatchObject({ kind: "dashboard", url: `/d/${d.id}` });
    const none = await searchFor(mb, { email: "joe@example.com", name: "Joe" }, { query: "sales -overview" });
    expect(none.results.find((r) => r.id === `dashboard-${d.id}`)).toBeUndefined();
  }, 60_000);

  it("signs someone in again after their Metabase password was changed", async () => {
    const u = await mb.findUser("joe@example.com");
    await mb.asService(`/api/user/${u!.id}/password`, { method: "PUT", body: { password: "Changed-in-metabase-1" } });
    const s = await mb.sessionFor("joe@example.com", "Joe", { fresh: true });
    expect(s).toMatch(/[0-9a-f-]{36}/);
    const me = await mb.call<{ email: string }>("/api/user/current", { session: s });
    expect(me.email).toBe("joe@example.com");
  }, 60_000);
});
