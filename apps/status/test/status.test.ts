import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("status", async () => {
  const m = await import("../lib/monitors");
  const inc = await import("../lib/incidents");
  const { publicPage } = await import("../lib/public");
  const { saveSettings } = await import("../lib/settings");
  const { q, db } = await import("../lib/db");
  const svc = await import("../app/api/svc/monitors/route");

  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    await q("TRUNCATE monitors, checks, incidents, incident_updates, settings RESTART IDENTITY CASCADE");
    server = http.createServer((req, res) => {
      if (req.url === "/down") return void (res.writeHead(500), res.end());
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.STATUS_ALLOW_HOSTS = "127.0.0.1";
  });
  afterAll(async () => {
    server.close();
    delete process.env.STATUS_ALLOW_HOSTS;
    await db().close();
  });

  it("creates, edits and validates monitors", async () => {
    const a = await m.createMonitor({ name: "Site", url: `${base}/`, intervalSec: 10 });
    expect(a.interval_sec).toBe(60); // never more often than once a minute
    expect(a.public).toBe(true);
    await expect(m.createMonitor({ name: "Bad", url: "http://10.0.0.5/" })).rejects.toThrow(/private/);
    await expect(m.createMonitor({ name: "", url: "https://example.com" })).rejects.toThrow(/name/);
    const b = await m.updateMonitor(a.id, { name: "Website", isPublic: false });
    expect(b.name).toBe("Website");
    expect(b.public).toBe(false);
    expect(b.url).toBe(`${base}/`);
    await m.updateMonitor(a.id, { isPublic: true });
  });

  it("records checks and polls only what is due", async () => {
    const down = await m.createMonitor({ name: "API", url: `${base}/down`, sort: 2 });
    expect(await m.pollDue()).toBe(2);
    expect(await m.pollDue()).toBe(0); // both just checked
    const rows = await m.listMonitors();
    expect(rows.map((r) => [r.name, r.up])).toEqual([
      ["Website", true],
      ["API", false],
    ]);
    expect(rows[1].last_status).toBe(500);
    const checks = await m.recentChecks(down.id);
    expect(checks).toHaveLength(1);
    await q("UPDATE monitors SET last_checked_at = now() - interval '2 hours'");
    expect(await m.pollDue()).toBe(2);
  });

  it("prunes old checks", async () => {
    const [{ id }] = await q<{ id: string }>("SELECT id::text FROM monitors ORDER BY id LIMIT 1");
    await q("INSERT INTO checks (monitor_id, ok, checked_at) VALUES ($1, true, now() - interval '200 days')", [id]);
    await m.prune(90);
    const [{ n }] = await q<{ n: number }>("SELECT count(*)::int AS n FROM checks WHERE checked_at < now() - interval '90 days'");
    expect(n).toBe(0);
  });

  it("posts incidents with updates and shows them on the public page", async () => {
    await saveSettings({ title: "Acme status" });
    const i = await inc.createIncident({ title: "API errors", body: "Looking into it" }, "admin@example.com");
    expect(i.status).toBe("investigating");
    await expect(inc.addUpdate(i.id, { status: "nope" }, "admin@example.com")).rejects.toThrow(/status/);
    await inc.addUpdate(i.id, { status: "identified", body: "Found it" }, "admin@example.com");

    let p = await publicPage();
    expect(p.settings.title).toBe("Acme status");
    expect(p.overall).toBe("incident");
    expect(p.monitors.map((x) => x.name)).toEqual(["Website", "API"]);
    expect(p.monitors[0].days.length).toBeGreaterThan(0);
    expect(p.incidents[0].updates.map((u) => u.status)).toEqual(["identified", "investigating"]);
    // Nothing that names a person or an address leaves on the public page.
    const json = JSON.stringify(p);
    expect(json).not.toContain("admin@example.com");
    expect(json).not.toContain(base);

    const resolved = await inc.addUpdate(i.id, { status: "resolved", body: "Fixed" }, "admin@example.com");
    expect(resolved.resolved_at).not.toBeNull();
    p = await publicPage();
    expect(p.overall).toBe("degraded"); // the API monitor is still down
  });

  it("keeps the old tool's data shape", async () => {
    // A row as the earlier Status tool wrote it (no error, no last_checked_at) still reads back.
    const [{ id }] = await q<{ id: string }>("INSERT INTO monitors (name, url, sort) VALUES ('Legacy', 'https://example.com', 9) RETURNING id::text");
    await q("INSERT INTO checks (monitor_id, ok, status_code, latency_ms) VALUES ($1, true, 200, 42)", [id]);
    await q("INSERT INTO incidents (title, body, status) VALUES ('Old outage', 'It was down', 'resolved')");
    const legacy = (await m.listMonitors()).find((r) => r.id === id)!;
    expect(legacy.up).toBe(true);
    expect(legacy.latency_24h).toBe(42);
    const old = (await inc.listIncidents()).find((x) => x.title === "Old outage")!;
    expect(old.updates).toEqual([]);
  });

  it("lets a provisioning service read and add monitors with the token only", async () => {
    process.env.STATUS_API_TOKEN = "svc-token";
    const call = (method: "GET" | "POST", token: string | null, body?: unknown) =>
      (svc as Record<string, (req: Request) => Promise<Response>>)[method](
        new Request("http://status/api/svc/monitors", {
          method,
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    expect((await call("GET", null)).status).toBe(401);
    expect((await call("GET", "wrong")).status).toBe(401);
    const list = await (await call("GET", "svc-token")).json();
    expect(list.monitors.length).toBeGreaterThan(0);
    const added = await call("POST", "svc-token", { name: "Portal", url: "https://portal.example.com" });
    expect(added.status).toBe(200);
    expect((await call("POST", "svc-token", { name: "Sneaky", url: "http://169.254.169.254/" })).status).toBe(400);
    delete process.env.STATUS_API_TOKEN;
    expect((await call("GET", "svc-token")).status).toBe(401); // no token configured: nobody gets in
  });

  it("adds the suite's apps once", async () => {
    process.env.SUITE_DOMAIN = "suite.test";
    const first = await m.addSuiteApps();
    expect(first).toBeGreaterThan(10);
    expect(await m.addSuiteApps()).toBe(0);
    delete process.env.SUITE_DOMAIN;
    await expect(m.addSuiteApps()).rejects.toThrow(/SUITE_DOMAIN/);
  });
});
