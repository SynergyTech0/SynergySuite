import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const alice = { email: "alice@example.com", name: "Alice", subject: "a" };
const bob = { email: "bob@example.com", name: "Bob", subject: "b" };
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36";

describe.skipIf(!url)("analytics", async () => {
  const sites = await import("../lib/sites");
  const { record } = await import("../lib/collect");
  const { q, db } = await import("../lib/db");
  const collect = await import("../app/api/collect/route");

  beforeAll(async () => {
    await q("TRUNCATE sites, events, salts RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  it("adds sites with a fresh key; only the owner or an admin manages them", async () => {
    const s = await sites.createSite(alice, { name: "Shop", domain: "https://www.shop.example/" });
    expect(s.site_key).toMatch(/^sy_[A-Za-z0-9_-]{12}$/);
    expect(s.domain).toBe("www.shop.example");
    await expect(sites.createSite(alice, { name: "" })).rejects.toThrow(/name/);
    await expect(sites.updateSite(bob, s.id, { name: "Mine" })).rejects.toThrow(/owner/);
    process.env.ANALYTICS_ADMIN_EMAILS = "bob@example.com";
    expect((await sites.updateSite(bob, s.id, { name: "Shop site" })).name).toBe("Shop site");
    delete process.env.ANALYTICS_ADMIN_EMAILS;
    const list = await sites.listSites(bob);
    expect(list.map((x) => [x.name, x.can_manage])).toEqual([["Shop site", false]]);
  });

  it("counts page views and events, and drops bots, unknown keys and other sites' pages", async () => {
    const [s] = await sites.listSites(alice);
    const ctx = { ip: "203.0.113.5", ua: BROWSER, origin: "https://www.shop.example" };
    const k = s.site_key;
    expect(await record({ k, u: "https://www.shop.example/?utm=x", r: "https://news.example/a", w: 400 }, ctx)).toBe("ok");
    expect(await record({ k, u: "https://www.shop.example/cart", w: 400 }, ctx)).toBe("ok");
    expect(await record({ k, kind: "event", name: "checkout", u: "https://www.shop.example/cart" }, ctx)).toBe("ok");
    expect(await record({ k, u: "https://www.shop.example/" }, { ...ctx, ip: "198.51.100.7" })).toBe("ok");
    expect(await record({ k, u: "/" }, { ...ctx, ua: "Googlebot/2.1" })).toBe("bot");
    expect(await record({ k: "sy_nope", u: "/" }, ctx)).toBe("unknown-site");
    expect(await record({ k, u: "/" }, { ...ctx, origin: "https://elsewhere.example" })).toBe("wrong-origin");

    const st = await sites.stats(s.id, 7);
    expect(st.totals).toEqual({ pageviews: 3, visitors: 2, events: 1 });
    expect(st.topPages).toEqual([
      { path: "/", views: 2, visitors: 2 },
      { path: "/cart", views: 1, visitors: 1 },
    ]);
    expect(st.topRefs.map((r) => r.source).sort()).toEqual(["(direct)", "news.example"]);
    expect(st.topEvents).toEqual([{ name: "checkout", count: 1 }]);
    expect(st.live).toBe(2);
    expect(st.bucket).toBe("day");
    expect((await sites.stats(s.id, 1)).bucket).toBe("hour");
    expect((await sites.stats(s.id, 999)).days).toBe(90);

    // Nothing that identifies a visitor is stored.
    const raw = JSON.stringify(await q("SELECT * FROM events"));
    expect(raw).not.toContain("203.0.113.5");
    expect(raw).not.toContain("utm");
  });

  it("counts the same visitor once a day, with one salt shared by every replica", async () => {
    const [s] = await sites.listSites(alice);
    const ctx = { ip: "192.0.2.9", ua: BROWSER, origin: "https://shop.example" };
    const day1 = new Date(Date.now() - 2 * 86_400_000);
    await record({ k: s.site_key, u: "/a" }, { ...ctx, now: day1 });
    await record({ k: s.site_key, u: "/b" }, { ...ctx, now: day1 });
    await record({ k: s.site_key, u: "/c" }, { ...ctx, now: new Date() });
    const rows = await q<{ path: string; visitor: string }>("SELECT path, visitor FROM events WHERE path IN ('/a', '/b', '/c') ORDER BY path");
    expect(rows[0].visitor).toBe(rows[1].visitor);
    expect(rows[2].visitor).not.toBe(rows[0].visitor);
    // Only today's salt is kept.
    const salts = await q<{ day: string }>("SELECT day::text FROM salts");
    expect(salts).toEqual([{ day: new Date().toISOString().slice(0, 10) }]);
  });

  it("answers the collector with 204 whatever it is sent", async () => {
    const [s] = await sites.listSites(alice);
    const post = (body: string, headers: Record<string, string> = {}) =>
      collect.POST(new Request("http://analytics/api/collect", { method: "POST", body, headers: { "content-type": "text/plain", "user-agent": BROWSER, ...headers } }));
    const before = (await q<{ n: number }>("SELECT count(*)::int AS n FROM events"))[0].n;
    expect((await post(JSON.stringify({ k: s.site_key, u: "https://shop.example/x" }), { origin: "https://shop.example", "x-forwarded-for": "203.0.113.50" })).status).toBe(204);
    expect((await post("{not json")).status).toBe(204);
    expect((await post(JSON.stringify({ k: "nope" }))).status).toBe(204);
    expect((await post("x".repeat(10_000))).status).toBe(204);
    const after = (await q<{ n: number }>("SELECT count(*)::int AS n FROM events"))[0].n;
    expect(after).toBe(before + 1);
    expect((await post("{}")).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("deletes a site and its events", async () => {
    const [s] = await sites.listSites(alice);
    await expect(sites.deleteSite(bob, s.id)).rejects.toThrow(/owner/);
    await sites.deleteSite(alice, s.id);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM events"))[0].n).toBe(0);
  });
});
