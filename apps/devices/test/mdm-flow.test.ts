import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@synergy/db";
import { buildPlist, dict, parsePlist, type PlistValue } from "../lib/mdm/plist";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_devices_mdm"). It plays NanoMDM: a fake API records queued commands, and the test sends
// the webhook events NanoMDM would (the format of its service/webhook/testdata) as an iPhone and a Mac.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.DEVICES_OSV_URL = "off";
process.env.SUITE_DOMAIN = "example.com";
process.env.DEVICES_MDM_API_KEY = "api-key";
process.env.DEVICES_MDM_WEBHOOK_KEY = "hook-key";
process.env.DEVICES_SCEP_CHALLENGE = "scep-challenge";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1) || "postgres"}_devices_mdm`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const admin = { email: "admin@example.com", name: "Admin", role: "admin" as const };
const alice = { email: "alice@example.com", name: "Alice", role: "user" as const };
const bob = { email: "bob@example.com", name: "Bob", role: "user" as const };

type Queued = { ids: string[]; uuid: string; command: Record<string, PlistValue> };

/** A stand-in for NanoMDM's API: records what Devices queues. */
function fakeNanoMdm(): Promise<{ server: Server; url: string; queued: Queued[]; pushcerts: string[]; failIds: Set<string> }> {
  const queued: Queued[] = [];
  const pushcerts: string[] = [];
  const failIds = new Set<string>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    if (req.headers.authorization !== `Basic ${Buffer.from("nanomdm:api-key").toString("base64")}`) {
      res.writeHead(401).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "PUT" && url.pathname === "/v1/pushcert") {
      pushcerts.push(raw.toString());
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ topic: "com.apple.mgmt.External.test" }));
      return;
    }
    if (req.method === "PUT" && url.pathname.startsWith("/v1/enqueue/")) {
      const ids = decodeURIComponent(url.pathname.slice("/v1/enqueue/".length)).split(",");
      const p = dict(parsePlist(raw));
      queued.push({ ids, uuid: String(p.CommandUUID), command: dict(p.Command) });
      const status = Object.fromEntries(ids.map((id) => [id, failIds.has(id) ? { push_error: "no push token" } : { push_result: "ok" }]));
      // Like NanoMDM: 500 when any push failed, though the command is queued.
      res.writeHead(ids.some((id) => failIds.has(id)) ? 500 : 200, { "content-type": "application/json" }).end(JSON.stringify({ status, command_uuid: p.CommandUUID, request_type: dict(p.Command).RequestType }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    resolve({ server, url: `http://127.0.0.1:${addr.port}`, queued, pushcerts, failIds });
  }));
}

describe.skipIf(!base)("apple device management end to end", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const nano = await fakeNanoMdm();
  process.env.DEVICES_MDM_URL = nano.url;
  const { q, db } = await import("../lib/db");
  const apple = await import("../lib/mdm/apple");
  const catalog = await import("../lib/mdm/catalog");
  const devices = await import("../lib/devices");
  const enrollLib = await import("../lib/enroll");
  const webhookRoute = await import("../app/api/svc/apple/webhook/route");
  const osqueryEnroll = await import("../app/api/osquery/enroll/route");

  const hook = async (ev: unknown, key = "hook-key") => {
    const raw = JSON.stringify(ev);
    const res = await webhookRoute.POST(new Request("http://devices/api/svc/apple/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hmac-signature": createHmac("sha256", key).update(raw).digest("base64") },
      body: raw,
    }));
    return res.status;
  };
  const b64 = (v: Record<string, unknown>) => Buffer.from(buildPlist(v as never)).toString("base64");
  const checkin = (topic: string, id: string, payload: Record<string, unknown>, params: Record<string, string> = {}) =>
    hook({ topic, event_id: randomUUID(), created_at: new Date().toISOString(), checkin_event: { udid: id, ids: { id, type: "Device" }, url_params: params, raw_payload: b64(payload) } });
  const report = (id: string, uuid: string, status: string, payload: Record<string, unknown> = {}) =>
    hook({ topic: "mdm.Connect", event_id: randomUUID(), created_at: new Date().toISOString(), acknowledge_event: { udid: id, ids: { id, type: "Device" }, status, command_uuid: uuid, raw_payload: b64({ UDID: id, Status: status, CommandUUID: uuid, ...payload }) } });
  const last = (type: string, id?: string) => [...nano.queued].reverse().find((c) => c.command.RequestType === type && (!id || c.ids.includes(id)));
  const tokenOf = (xml: string) => {
    const mdm = (dict(parsePlist(xml)).PayloadContent as PlistValue[]).map(dict).find((p) => p.PayloadType === "com.apple.mdm")!;
    return new URL(String(mdm.ServerURL)).searchParams.get("enroll")!;
  };

  const PHONE = "00008110-000A1B2C3D4E5F60";
  const MAC = "564D7A2B-1111-2222-3333-444455556666";
  let phoneDevice = "";
  let macDevice = "";

  beforeAll(async () => {
    await q("TRUNCATE enroll_secrets, devices, policies, audit, mdm_settings, mdm_enroll_tokens, mdm_enrollments, mdm_commands, mdm_profiles, mdm_apps CASCADE");
    const { BASELINE } = await import("../lib/rules");
    await devices.createPolicy(admin, BASELINE);
  });
  afterAll(async () => {
    nano.server.close();
    await db().close();
  });

  it("needs a push certificate, checked before NanoMDM gets it", async () => {
    await expect(apple.enrollmentFor(alice, false)).rejects.toThrow(/push certificate/);
    await expect(apple.setPushCert(admin, "nothing")).rejects.toThrow(/certificate/);
    const dir = mkdtempSync(join(tmpdir(), "mdm-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "30",
      "-subj", "/UID=com.apple.mgmt.External.test/CN=APSP:test"], { stdio: "ignore" });
    const pem = readFileSync(join(dir, "c.pem"), "utf8") + readFileSync(join(dir, "k.pem"), "utf8");
    await expect(apple.setPushCert(admin, readFileSync(join(dir, "c.pem"), "utf8"))).rejects.toThrow(/private key is missing/);
    const cert = await apple.setPushCert(admin, pem);
    expect(cert.topic).toBe("com.apple.mgmt.External.test");
    expect(nano.pushcerts).toHaveLength(1);
    const s = await apple.appleStatus();
    expect(s.ready).toBe(true);
    expect(s.push_expires_in_days).toBeGreaterThanOrEqual(29);
  });

  it("refuses unsigned webhooks", async () => {
    expect(await hook({ topic: "mdm.CheckOut" }, "wrong")).toBe(401);
  });

  it("enrolls Alice's iPhone and reads its details and security", async () => {
    await expect(apple.enrollmentFor(alice, true)).rejects.toThrow(/admins/);
    const { xml } = await apple.enrollmentFor(alice, false);
    const token = tokenOf(xml);
    expect(await checkin("mdm.Authenticate", PHONE, { MessageType: "Authenticate", UDID: PHONE, SerialNumber: "F2LXK0ABCDEF", ProductName: "iPhone15,2", Model: "iPhone", DeviceName: "Alice's iPhone", OSVersion: "18.1", Topic: "com.apple.mgmt.External.test" }, { enroll: token })).toBe(204);
    const [e] = await q<{ device_id: string; status: string; platform: string }>(`SELECT device_id, status, platform FROM mdm_enrollments WHERE id = $1`, [PHONE]);
    expect(e).toMatchObject({ status: "authenticated", platform: "ios" });
    phoneDevice = e.device_id;
    const d = (await devices.getDevice(alice, phoneDevice)) as Record<string, any>;
    expect(d).toMatchObject({ owner: alice.email, platform: "ios", os_name: "iOS", hostname: "Alice's iPhone", host_identifier: `mdm:${PHONE}` });

    nano.queued.length = 0;
    expect(await checkin("mdm.TokenUpdate", PHONE, { MessageType: "TokenUpdate", UDID: PHONE, Topic: "com.apple.mgmt.External.test", PushMagic: "m", Token: Buffer.from("t") }, { enroll: token })).toBe(204);
    expect(nano.queued.map((c) => c.command.RequestType)).toEqual(["DeviceInformation", "SecurityInfo", "InstalledApplicationList"]);
    // A second TokenUpdate (the token rotating) asks for nothing again.
    await checkin("mdm.TokenUpdate", PHONE, { MessageType: "TokenUpdate", UDID: PHONE });
    expect(nano.queued).toHaveLength(3);

    const [info, sec, apps] = nano.queued;
    await report(PHONE, info.uuid, "Acknowledged", { QueryResponses: { DeviceName: "Alice's iPhone 15", OSVersion: "18.2", ModelName: "iPhone 15 Pro", SerialNumber: "F2LXK0ABCDEF", IsSupervised: false } });
    await report(PHONE, sec.uuid, "Acknowledged", { SecurityInfo: { PasscodePresent: true, PasscodeCompliant: true, HardwareEncryptionCaps: 3 } });
    await report(PHONE, apps.uuid, "Acknowledged", { InstalledApplicationList: [{ Name: "Slack", ShortVersion: "24.10", Identifier: "com.tinyspeck.chatlyio" }, { Name: "Mail", Identifier: "com.apple.mobilemail" }] });

    const after = (await devices.getDevice(admin, phoneDevice)) as Record<string, any>;
    expect(after).toMatchObject({ hostname: "Alice's iPhone 15", os_version: "18.2", hardware_model: "iPhone 15 Pro" });
    expect(after.facts).toMatchObject({ screen_lock: true, disk_encryption: true });
    expect(after.compliance).toBe("compliant");
    expect((await devices.software(alice, phoneDevice)).map((s) => s.name)).toEqual(["Mail", "Slack"]);
    const m = await apple.managementOf(alice, phoneDevice);
    expect((m as Record<string, unknown> | null)?.status).toBe("enrolled");
    expect((m?.commands as { status: string }[]).every((c) => c.status === "acknowledged")).toBe(true);
    expect((await devices.overview() as Record<string, unknown>).ios).toBe(1);
  });

  it("locks and erases with the right people only", async () => {
    await expect(apple.lock(bob, phoneDevice, {})).rejects.toThrow(/No such device/);
    const { pin } = await apple.lock(alice, phoneDevice, { message: "Lost, call me", phone: "+1 555 0100" });
    expect(pin).toBeNull();
    expect(last("DeviceLock", PHONE)?.command).toMatchObject({ Message: "Lost, call me", PhoneNumber: "+1 555 0100" });
    expect(last("DeviceLock", PHONE)?.command.PIN).toBeUndefined();

    await expect(apple.erase(alice, phoneDevice, { confirm: "Alice's iPhone 15" })).rejects.toThrow(/admins/);
    await expect(apple.erase(admin, phoneDevice, { confirm: "wrong" })).rejects.toThrow(/Type the device's name/);
    await apple.erase(admin, phoneDevice, { confirm: "Alice's iPhone 15" });
    expect(last("EraseDevice", PHONE)?.command).toMatchObject({ PreserveDataPlan: true });

    await expect(apple.power(admin, phoneDevice, "restart")).rejects.toThrow(/supervised/);
    const [audit] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM audit WHERE action IN ('mdm.lock', 'mdm.erase')`);
    expect(audit.n).toBe(2);
  });

  it("records commands a device refuses or can't be woken for", async () => {
    nano.failIds.add(PHONE);
    await apple.lock(admin, phoneDevice, {});
    nano.failIds.delete(PHONE);
    const cmd = last("DeviceLock", PHONE)!;
    const [row] = await q<{ error: string }>(`SELECT error FROM mdm_commands WHERE uuid = $1`, [cmd.uuid]);
    expect(row.error).toMatch(/Couldn't wake/);
    await report(PHONE, cmd.uuid, "Error", { ErrorChain: [{ ErrorCode: 12021, ErrorDomain: "MCMDMErrorDomain", LocalizedDescription: "The device is already locked." }] });
    const [after] = await q<{ status: string; error: string }>(`SELECT status, error FROM mdm_commands WHERE uuid = $1`, [cmd.uuid]);
    expect(after).toEqual({ status: "error", error: "The device is already locked." });
  });

  it("pushes settings profiles and keeps them current", async () => {
    nano.queued.length = 0;
    const { id } = await catalog.createProfile(admin, { name: "Passcode", kind: "passcode", settings: { min_length: 6 } });
    const install = last("InstallProfile", PHONE)!;
    const doc = dict(parsePlist(install.command.Payload as Buffer));
    expect(doc.PayloadIdentifier).toBe(`cloud.synergy.devices.profile.${id}`);
    await report(PHONE, install.uuid, "Acknowledged");
    let [p] = (await catalog.listProfiles()).profiles as unknown as { installed: number; pending: number }[];
    expect(p).toMatchObject({ installed: 1, pending: 0 });

    await catalog.updateProfile(admin, id, { settings: { min_length: 8 } });
    const again = last("InstallProfile", PHONE)!;
    expect(again.uuid).not.toBe(install.uuid);
    [p] = (await catalog.listProfiles()).profiles as unknown as { installed: number; pending: number }[];
    expect(p.pending).toBe(1);

    const wifi = await catalog.createProfile(admin, { name: "Office Wi-Fi", kind: "wifi", settings: { ssid: "Office", password: "secretpassword" } });
    const listed = (await catalog.listProfiles()).profiles.find((x) => x.id === wifi.id)!;
    expect(listed.settings.password).toBe("********");
    await catalog.updateProfile(admin, wifi.id, { name: "Office", settings: { ssid: "Office", password: "********" } });
    const [stored] = await q<{ settings: { password: string } }>(`SELECT settings FROM mdm_profiles WHERE id = $1`, [wifi.id]);
    expect(stored.settings.password).toBe("secretpassword");

    await catalog.deleteProfile(admin, id);
    expect(last("RemoveProfile", PHONE)?.command.Identifier).toBe(`cloud.synergy.devices.profile.${id}`);
  });

  it("installs catalog apps, by owners on their own devices", async () => {
    const { id } = await catalog.createApp(admin, { name: "Slack", platform: "ios", store: "https://apps.apple.com/us/app/slack/id618783545" });
    await expect(catalog.installApp(bob, id, { devices: [phoneDevice] })).rejects.toThrow(/No enrolled/);
    await expect(catalog.installApp(alice, id, { all: true })).rejects.toThrow(/admins/);
    expect(await catalog.installApp(alice, id, { devices: [phoneDevice] })).toEqual({ devices: 1 });
    expect(last("InstallApplication", PHONE)?.command).toMatchObject({ iTunesStoreID: 618783545, ManagementFlags: 1 });
  });

  it("links a Mac's management to the row osquery reports on", async () => {
    const secret = (await enrollLib.createSecret(alice.email, { personal: true })).secret;
    const res = await osqueryEnroll.POST(new Request("http://devices/api/osquery/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enroll_secret: secret,
        host_identifier: "mac-host-uuid",
        host_details: {
          os_version: { name: "macOS", version: "15.1", platform: "darwin" },
          system_info: { computer_name: "Alices-MacBook", hardware_vendor: "Apple Inc.", hardware_model: "MacBookPro18,3", hardware_serial: "C02MAC123" },
        },
      }),
    }));
    expect(res.status).toBe(200);
    const [d] = await q<{ id: string }>(`SELECT id FROM devices WHERE host_identifier = 'mac-host-uuid'`);
    macDevice = d.id;
    await q(`UPDATE devices SET facts = '{"disk_encryption": true}' WHERE id = $1`, [macDevice]);

    const token = tokenOf((await apple.enrollmentFor(admin, true)).xml);
    await checkin("mdm.Authenticate", MAC, { MessageType: "Authenticate", UDID: MAC, SerialNumber: "C02MAC123", ProductName: "MacBookPro18,3", Model: "MacBookPro18,3", DeviceName: "Alices-MacBook" }, { enroll: token });
    await checkin("mdm.TokenUpdate", MAC, { MessageType: "TokenUpdate", UDID: MAC });
    const [e] = await q<{ device_id: string; platform: string }>(`SELECT device_id, platform FROM mdm_enrollments WHERE id = $1`, [MAC]);
    expect(e).toEqual({ device_id: macDevice, platform: "darwin" });
    // The organization profile doesn't take the Mac from Alice.
    expect(((await devices.getDevice(admin, macDevice)) as Record<string, any>).owner).toBe(alice.email);

    const sec = last("SecurityInfo", MAC)!;
    await report(MAC, sec.uuid, "Acknowledged", { SecurityInfo: { FDE_Enabled: false, FirewallSettings: { FirewallEnabled: true }, SystemIntegrityProtectionEnabled: true } });
    const facts = ((await devices.getDevice(admin, macDevice)) as Record<string, any>).facts;
    // osquery's own answer stands; MDM fills in what osquery hasn't reported.
    expect(facts).toMatchObject({ disk_encryption: true, firewall: true, system_protection: true });

    const { pin } = await apple.lock(alice, macDevice, {});
    expect(pin).toMatch(/^\d{6}$/);
    expect(last("DeviceLock", MAC)?.command.PIN).toBe(pin);
    const bobView = await apple.managementOf(bob, macDevice);
    expect((bobView?.commands as { pin: string | null }[]).find((c) => c.pin)).toBeUndefined();
    expect((await apple.managementOf(admin, macDevice))?.commands).toEqual(expect.arrayContaining([expect.objectContaining({ pin })]));
  });

  it("lets osquery take over a Mac enrolled through MDM first", async () => {
    const ID = "AAAA-BBBB";
    const token = tokenOf((await apple.enrollmentFor(bob, false)).xml);
    await checkin("mdm.Authenticate", ID, { MessageType: "Authenticate", UDID: ID, SerialNumber: "C02BOB999", ProductName: "Mac14,2", Model: "Mac14,2", DeviceName: "Bobs-Air" }, { enroll: token });
    const [before] = await q<{ device_id: string }>(`SELECT device_id FROM mdm_enrollments WHERE id = $1`, [ID]);
    const secret = (await enrollLib.createSecret(bob.email, { personal: true })).secret;
    await osqueryEnroll.POST(new Request("http://devices/api/osquery/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enroll_secret: secret, host_identifier: "bob-mac", host_details: { os_version: { name: "macOS", version: "15.0", platform: "darwin" }, system_info: { hardware_serial: "C02BOB999" } } }),
    }));
    const [after] = await q<{ id: string }>(`SELECT id FROM devices WHERE host_identifier = 'bob-mac'`);
    expect(after.id).toBe(before.device_id);
  });

  it("removes management when a device is retired, and retires a phone that leaves", async () => {
    await devices.retire(admin, macDevice);
    expect(last("RemoveProfile", MAC)?.command.Identifier).toBe("cloud.synergy.devices.mdm");

    await checkin("mdm.CheckOut", PHONE, { MessageType: "CheckOut", UDID: PHONE });
    const [e] = await q<{ status: string }>(`SELECT status FROM mdm_enrollments WHERE id = $1`, [PHONE]);
    expect(e.status).toBe("unenrolled");
    expect((await devices.listDevices(alice)).find((d) => d.id === phoneDevice)).toBeUndefined();
    await expect(apple.lock(admin, phoneDevice, {})).rejects.toThrow(/No such device/);
  });
});
