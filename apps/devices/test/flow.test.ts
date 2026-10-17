import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createDb } from "@synergy/db";
import type { SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own next to it
// ("<name>_devices"). It plays osqueryd: enrolls, fetches config, sends logs and answers live queries.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.DEVICES_SVC_TOKEN = "svc-token";
process.env.DEVICES_OSV_URL = "off";
process.env.SUITE_DOMAIN = "example.com";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1) || "postgres"}_devices`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const admin = { email: "admin@example.com", name: "Admin", role: "admin" as const };
const alice = { email: "alice@example.com", name: "Alice", role: "user" as const };
const bob = { email: "bob@example.com", name: "Bob", role: "user" as const };

describe.skipIf(!base)("devices end to end", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const { q, db } = await import("../lib/db");
  const enrollLib = await import("../lib/enroll");
  const devices = await import("../lib/devices");
  const alerts = await import("../lib/alerts");
  const { searchFor } = await import("../lib/search");
  const { scanDevice } = await import("../lib/vulns");
  const { recompute } = await import("../lib/state");
  const routes = {
    enroll: await import("../app/api/osquery/enroll/route"),
    config: await import("../app/api/osquery/config/route"),
    log: await import("../app/api/osquery/log/route"),
    read: await import("../app/api/osquery/distributed/read/route"),
    write: await import("../app/api/osquery/distributed/write/route"),
    csearch: await import("../app/api/compliance/search/route"),
    cexport: await import("../app/api/compliance/export/route"),
    posture: await import("../app/api/svc/posture/route"),
    access: await import("../app/api/svc/access/route"),
  };

  const post = async (r: { POST: (req: Request) => Promise<Response> }, body: unknown, opts: { gzip?: boolean; token?: string } = {}) => {
    const raw = JSON.stringify(body);
    const res = await r.POST(new Request("http://devices/api", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.gzip ? { "content-encoding": "gzip" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.gzip ? gzipSync(raw) : raw,
    }));
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };

  const mac = {
    host_identifier: "MAC-UUID-1",
    host_details: {
      os_version: { name: "macOS", version: "14.5", platform: "darwin" },
      system_info: { computer_name: "Alices-MacBook", hardware_vendor: "Apple Inc.", hardware_model: "MacBookPro18,3", hardware_serial: "C02XYZ", physical_memory: "17179869184" },
      osquery_info: { version: "5.17.0" },
    },
  };

  let aliceSecret = "";
  let bobSecret = "";
  let orgSecret = "";
  let nodeKey = "";
  let deviceId = "";

  beforeAll(async () => {
    await q("TRUNCATE enroll_secrets, devices, policies, indicators, live_queries, audit, advisories CASCADE");
    aliceSecret = (await enrollLib.createSecret(alice.email, { personal: true })).secret;
    bobSecret = (await enrollLib.createSecret(bob.email, { personal: true })).secret;
    orgSecret = (await enrollLib.createSecret(admin.email, { personal: false, name: "Servers" })).secret;
  });
  afterAll(async () => {
    await db().close();
  });

  const log = (data: unknown[], gzip = false) => post(routes.log, { node_key: nodeKey, log_type: "result", data }, { gzip });
  const device = async () => (await devices.getDevice(admin, deviceId)) as Record<string, any>;

  it("refuses enrollment without a valid secret", async () => {
    expect((await post(routes.enroll, { ...mac, enroll_secret: "wrong" })).json).toEqual({ node_invalid: true });
    expect((await post(routes.enroll, { enroll_secret: aliceSecret })).json).toEqual({ node_invalid: true });
  });

  it("enrolls with a personal secret, making the device the person's", async () => {
    const r = await post(routes.enroll, { ...mac, enroll_secret: aliceSecret });
    expect(typeof r.json.node_key).toBe("string");
    nodeKey = r.json.node_key;
    const [d] = await q<{ id: string; owner: string; platform: string; hostname: string; node_key_hash: string }>(`SELECT * FROM devices`);
    deviceId = d.id;
    expect(d).toMatchObject({ owner: alice.email, platform: "darwin", hostname: "Alices-MacBook" });
    expect(d.node_key_hash).not.toBe(nodeKey);
  });

  it("won't let someone else's personal secret take the device over", async () => {
    expect((await post(routes.enroll, { ...mac, enroll_secret: bobSecret })).json).toEqual({ node_invalid: true });
    const [d] = await q<{ owner: string }>(`SELECT owner FROM devices WHERE id = $1`, [deviceId]);
    expect(d.owner).toBe(alice.email);
  });

  it("serves the device its platform's schedule, and node_invalid to strangers", async () => {
    const r = await post(routes.config, { node_key: nodeKey });
    expect(Object.keys(r.json.schedule)).toContain("synergy_encryption_darwin");
    expect((await post(routes.config, { node_key: "nope" })).json).toEqual({ node_invalid: true });
  });

  it("asks a new device for its inventory right away", async () => {
    const r = await post(routes.read, { node_key: nodeKey });
    const keys = Object.keys(r.json.queries);
    expect(keys.some((k) => k.endsWith(":encryption_darwin"))).toBe(true);
    expect(keys.some((k) => k.endsWith(":listening"))).toBe(false);
    const qid = keys[0].split(":")[1];
    const answers: Record<string, unknown[]> = {
      [`refresh:${qid}:os`]: [{ name: "macOS", version: "14.5", major: "14", minor: "5", patch: "0", platform: "darwin" }],
      [`refresh:${qid}:encryption_darwin`]: [{ encrypted: "1" }],
      [`refresh:${qid}:firewall_darwin`]: [{ enabled: "1" }],
      [`refresh:${qid}:screenlock_darwin`]: [{ enabled: "1", grace_period: "0" }],
      [`refresh:${qid}:protection_darwin`]: [{ sip: "1", gatekeeper: "1" }],
      [`refresh:${qid}:admins_darwin`]: [{ username: "alice" }],
      [`refresh:${qid}:software_apps`]: [{ name: "Safari", version: "17.5" }, { name: "Slack", version: "4.38" }],
    };
    await post(routes.write, { node_key: nodeKey, queries: answers, statuses: Object.fromEntries(Object.keys(answers).map((k) => [k, 0])) });
    const d = await device();
    expect(d.facts).toMatchObject({ disk_encryption: true, firewall: true, screen_lock: true, system_protection: true, admins: ["alice"] });
    expect(d.os_version).toBe("14.5");
    expect(d.software_count).toBe(2);
    expect((await post(routes.read, { node_key: nodeKey })).json.queries).toEqual({});
  });

  it("is compliant with the baseline policy", async () => {
    await devices.createPolicy(admin, { template: "baseline" });
    expect((await device()).compliance).toBe("compliant");
  });

  it("raises an alert for a new listener, not for the baseline, and counts repeats", async () => {
    await log([{ name: "synergy_listening", action: "added", counter: 0, columns: { name: "sshd", path: "/usr/sbin/sshd", port: "22", protocol: "6" } }]);
    expect(await alerts.listAlerts({})).toHaveLength(0);
    const nc = { name: "synergy_listening", action: "added", counter: 5, columns: { name: "nc", path: "/tmp/nc", port: "4444", protocol: "6" } };
    await log([nc], true);
    await log([nc]);
    const list = await alerts.listAlerts({});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ severity: "medium", occurrences: 2, hostname: "Alices-MacBook" });
  });

  it("raises a high alert and goes non-compliant when encryption is turned off", async () => {
    await log([{ name: "synergy_encryption_darwin", action: "snapshot", snapshot: [{ encrypted: "0" }] }]);
    const d = await device();
    expect(d.compliance).toBe("noncompliant");
    const fails = (d.compliance_detail as { check: string; outcome: string }[]).filter((r) => r.outcome === "fail").map((r) => r.check).sort();
    expect(fails).toEqual(["disk_encryption", "no_open_alerts"]);
    expect((await alerts.listAlerts({ severity: "high" }))[0].title).toBe("Disk encryption was turned off");
  });

  it("finds a known-bad program from an indicator", async () => {
    const bad = "e".repeat(64);
    await devices.addIndicators(admin, { hashes: bad, title: "Test dropper" });
    await log([{ name: "synergy_process_hashes", action: "snapshot", snapshot: [{ name: "dropper", path: "/private/tmp/dropper", sha256: bad }] }]);
    expect((await alerts.listAlerts({ severity: "critical" }))[0].title).toBe("Known malicious program running: Test dropper");
  });

  it("triages: resolving closes, the same thing seen again opens a new alert", async () => {
    const [a] = await alerts.listAlerts({ severity: "medium" });
    await alerts.updateAlert(admin.email, a.id, { status: "investigating", assignedTo: admin.email, note: "Looking" });
    await alerts.updateAlert(admin.email, a.id, { status: "resolved", note: "Removed nc" });
    const full = await alerts.getAlert(a.id);
    expect(full.status).toBe("resolved");
    expect(full.events.map((e) => e.action)).toEqual(["raised", "status:investigating", "assigned:admin@example.com", "status:resolved"]);
    await log([{ name: "synergy_listening", action: "added", counter: 9, columns: { name: "nc", path: "/tmp/nc", port: "4444", protocol: "6" } }]);
    expect((await alerts.listAlerts({ status: "all", severity: "medium" })).map((x) => x.status).sort()).toEqual(["new", "resolved"]);
  });

  it("runs a live query and keeps the answer", async () => {
    const { id } = await devices.createLive(admin, { sql: "SELECT name FROM processes LIMIT 2;", devices: [deviceId] });
    const r = await post(routes.read, { node_key: nodeKey });
    expect(r.json.queries).toEqual({ [`live:${id}`]: "SELECT name FROM processes LIMIT 2" });
    await post(routes.write, { node_key: nodeKey, queries: { [`live:${id}`]: [{ name: "launchd" }, { name: "osqueryd" }] }, statuses: { [`live:${id}`]: 0 } });
    const live = (await devices.getLive(id)) as { targets: { status: string; rows: unknown[] }[] };
    expect(live.targets[0]).toMatchObject({ status: "done", rows: [{ name: "launchd" }, { name: "osqueryd" }] });
  });

  it("shows people only their own devices in search", async () => {
    expect((await searchFor(alice, { query: "C02XYZ" })).results.map((r) => r.kind)).toEqual(["device"]);
    expect((await searchFor(alice, { query: "macbook" })).results.length).toBeGreaterThan(1);
    expect((await searchFor(bob, { query: "macbook" })).results).toEqual([]);
    expect((await searchFor(admin, { query: "dropper" })).results[0]).toMatchObject({ kind: "alert" });
    expect(await devices.listDevices(bob)).toEqual([]);
    await expect(devices.getDevice(bob, deviceId)).rejects.toThrow(/No such device/);
  });

  it("answers the Admin center's eDiscovery search and export", async () => {
    expect((await post(routes.csearch, {})).status).toBe(401);
    const r = (await post(routes.csearch, { custodians: [alice.email] }, { token: "test-token" })).json as SearchResponse;
    expect(r.hits.map((h) => h.kind).sort()).toContain("device");
    expect(r.hits.every((h) => h.owner === alice.email)).toBe(true);
    expect(((await post(routes.csearch, { custodians: [bob.email] }, { token: "test-token" })).json as SearchResponse).hits).toEqual([]);
    const ex = (await post(routes.cexport, { ids: [`device:${deviceId}`] }, { token: "test-token" })).json as { items: { metadata: { software: unknown[] } }[] };
    expect(ex.items[0].metadata.software).toHaveLength(2);
  });

  it("gives Trust a posture summary behind its own token", async () => {
    const get = (token?: string) => routes.posture.GET(new Request("http://devices/api/svc/posture", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
    expect((await get()).status).toBe(401);
    expect((await get("wrong")).status).toBe(401);
    const p = await (await get("svc-token")).json();
    expect(p).toMatchObject({ devices: 1, noncompliant: 1, policies: 1, encryption: { not_encrypted: 1 } });
    expect(p.alerts_open.critical).toBe(1);
    expect(p.noncompliant_sample[0]).toMatchObject({ hostname: "Alices-MacBook" });
  });

  it("tells Auth whose devices fail the policies, for blocking sign-in", async () => {
    const get = (email: string, token = "svc-token") =>
      routes.access.GET(new Request(`http://devices/api/svc/access?email=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${token}` } }));
    expect((await get(alice.email, "wrong")).status).toBe(401);
    expect((await get("nobody")).status).toBe(400);
    const a = await (await get(" Alice@Example.com ")).json();
    expect(a.email).toBe(alice.email);
    expect(a.devices).toHaveLength(1);
    expect(a.devices[0]).toMatchObject({ id: deviceId, name: "Alices-MacBook", platform: "darwin", compliance: "noncompliant" });
    expect(a.devices[0].failing).toContainEqual({ label: "Disk encryption", detail: "The system disk is not encrypted" });
    expect((await (await get(bob.email)).json()).devices).toEqual([]);
  });

  it("checks Linux packages against OSV advisories", async () => {
    const r = await post(routes.enroll, {
      enroll_secret: orgSecret,
      host_identifier: "LINUX-1",
      host_details: { os_version: { name: "Ubuntu", version: "22.04.4 LTS (Jammy Jellyfish)", platform: "ubuntu", platform_like: "debian" }, system_info: { hostname: "web-1" } },
    });
    const key = r.json.node_key as string;
    const [l] = await q<{ id: string; owner: string | null }>(`SELECT id, owner FROM devices WHERE host_identifier = 'LINUX-1'`);
    expect(l.owner).toBeNull();
    await post(routes.log, {
      node_key: key, log_type: "result", data: [
        { name: "synergy_os", action: "snapshot", snapshot: [{ name: "Ubuntu", version: "22.04.4 LTS (Jammy Jellyfish)", major: "22", minor: "4", patch: "0", platform: "ubuntu" }] },
        { name: "synergy_software_deb", action: "snapshot", snapshot: [{ name: "libssl3", version: "3.0.2-0ubuntu1.15", package: "openssl" }, { name: "bash", version: "5.1-6ubuntu1" }] },
      ],
    });
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/querybatch")) {
        const body = JSON.parse(String(init?.body));
        expect(body.queries.map((x: { package: { name: string; ecosystem: string } }) => `${x.package.ecosystem}/${x.package.name}`).sort()).toEqual(["Ubuntu:22.04:LTS/bash", "Ubuntu:22.04:LTS/openssl"]);
        return Response.json({ results: body.queries.map((x: { package: { name: string } }) => (x.package.name === "openssl" ? { vulns: [{ id: "UBUNTU-CVE-2024-0001" }] } : {})) });
      }
      return Response.json({
        id: "UBUNTU-CVE-2024-0001", summary: "openssl flaw",
        severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
        affected: [{ package: { name: "openssl", ecosystem: "Ubuntu:22.04:LTS" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "3.0.2-0ubuntu1.16" }] }] }],
      });
    }) as typeof fetch;
    expect(await scanDevice(l.id, { fetch: fake, env: { DEVICES_OSV_URL: "http://osv" } as unknown as NodeJS.ProcessEnv })).toBe(1);
    const v = await devices.fleetVulns({});
    expect(v[0]).toMatchObject({ vuln_id: "UBUNTU-CVE-2024-0001", severity: "critical", devices: 1, fixed_version: "3.0.2-0ubuntu1.16" });
    await devices.createPolicy(admin, { name: "Servers", platforms: ["linux"], rules: [{ check: "max_vulnerabilities", severity: "critical", count: 0 }] });
    await recompute([l.id]);
    const [c] = await q<{ compliance: string }>(`SELECT compliance FROM devices WHERE id = $1`, [l.id]);
    expect(c.compliance).toBe("noncompliant");
  });

  it("retires a device: its key stops working and it leaves the lists", async () => {
    await devices.retire(alice, deviceId);
    expect((await post(routes.config, { node_key: nodeKey })).json).toEqual({ node_invalid: true });
    expect(await devices.listDevices(alice)).toEqual([]);
    // Its history is kept.
    expect((await alerts.listAlerts({ device: deviceId, status: "all" })).length).toBeGreaterThan(0);
  });
});
