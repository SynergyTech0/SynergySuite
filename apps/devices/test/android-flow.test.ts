import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createDb } from "@synergy/db";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_devices_android"). It plays Google: a token endpoint that checks the service account's
// signed assertion, and an Android Management API that keeps policies, phones and commands.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.DEVICES_OSV_URL = "off";
process.env.SUITE_DOMAIN = "example.com";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { client_email: "devices@acme-mdm.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), project_id: "acme-mdm" };
process.env.DEVICES_ANDROID_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(SA)).toString("base64");

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1) || "postgres"}_devices_android`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const admin = { email: "admin@example.com", name: "Admin", role: "admin" as const };
const alice = { email: "alice@example.com", name: "Alice", role: "user" as const };
const bob = { email: "bob@example.com", name: "Bob", role: "user" as const };

const ENT = "enterprises/LC0abc123";
type Call = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null };

/** A stand-in for Google: OAuth token exchange plus the parts of the Android Management API Devices uses. */
function fakeGoogle() {
  const calls: Call[] = [];
  const policies = new Map<string, Record<string, unknown>>();
  const phones = new Map<string, Record<string, unknown>>();
  const operations = new Map<string, Record<string, unknown>>();
  let tokens = 0;
  let ops = 0;
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url ?? "/", "http://x");
    const json = (status: number, v: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));
    if (url.pathname === "/token") {
      const form = new URLSearchParams(raw);
      const [h, b, s] = (form.get("assertion") ?? "").split(".");
      const claims = JSON.parse(Buffer.from(b ?? "", "base64url").toString() || "{}") as Record<string, unknown>;
      const good = form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" && !!s
        && createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s, "base64url"))
        && claims.iss === SA.client_email && claims.scope === "https://www.googleapis.com/auth/androidmanagement" && String(claims.aud).endsWith("/token");
      if (!good) return json(400, { error: "invalid_grant", error_description: "Invalid JWT" });
      tokens++;
      return json(200, { access_token: "ya29.test", expires_in: 3600 });
    }
    if (req.headers.authorization !== "Bearer ya29.test") return json(401, { error: { message: "unauthenticated" } });
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\//, ""));
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    calls.push({ method: req.method ?? "", path, query: url.searchParams, body });
    if (req.method === "POST" && path === "signupUrls") return json(200, { name: "signupUrls/C9f8e7", url: "https://play.google.com/work/adminsignup?token=abc" });
    if (req.method === "POST" && path === "enterprises") {
      if (url.searchParams.get("signupUrlName") !== "signupUrls/C9f8e7" || url.searchParams.get("projectId") !== "acme-mdm") return json(400, { error: { message: "bad signup" } });
      return json(200, { name: ENT, enterpriseDisplayName: body?.enterpriseDisplayName });
    }
    if (req.method === "PATCH" && path.startsWith(`${ENT}/policies/`)) {
      policies.set(path.split("/").pop()!, body ?? {});
      return json(200, { name: path, ...body });
    }
    if (req.method === "POST" && path === `${ENT}/enrollmentTokens`) {
      return json(200, { name: `${ENT}/enrollmentTokens/t1`, value: "ENROLLTOKEN1", qrCode: JSON.stringify({ token: "ENROLLTOKEN1" }), expirationTimestamp: "2026-10-23T00:00:00Z", ...body });
    }
    if (req.method === "GET" && path === `${ENT}/devices`) {
      // Two pages, one phone each, to exercise paging.
      const all = [...phones.values()];
      const start = url.searchParams.get("pageToken") === "p2" ? 1 : 0;
      return json(200, { devices: all.slice(start, start + 1), ...(start === 0 && all.length > 1 ? { nextPageToken: "p2" } : {}) });
    }
    if (req.method === "GET" && operations.has(path)) return json(200, operations.get(path));
    if (path.startsWith(`${ENT}/devices/`)) {
      const [name, verb] = path.split(":");
      const phone = phones.get(name);
      if (!phone) return json(404, { error: { message: "not found" } });
      if (req.method === "GET") return json(200, phone);
      if (req.method === "DELETE") { phones.delete(name); return json(200, {}); }
      if (req.method === "PATCH") { Object.assign(phone, body); return json(200, phone); }
      if (req.method === "POST" && verb === "issueCommand") {
        const op = `${name}/operations/${++ops}`;
        operations.set(op, { name: op, done: false });
        return json(200, { name: op, metadata: { type: body?.type } });
      }
    }
    return json(404, { error: { message: `no route ${req.method} ${path}` } });
  });
  return new Promise<{ server: Server; url: string; calls: Call[]; policies: typeof policies; phones: typeof phones; operations: typeof operations; tokens: () => number }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, calls, policies, phones, operations, tokens: () => tokens });
    }));
}

const phone = (id: string, over: Record<string, unknown> = {}) => ({
  name: `${ENT}/devices/${id}`,
  managementMode: "PROFILE_OWNER",
  ownership: "PERSONALLY_OWNED",
  state: "ACTIVE",
  enrollmentTime: "2026-10-16T08:00:00Z",
  lastStatusReportTime: new Date().toISOString(),
  policyCompliant: true,
  appliedPolicyName: `${ENT}/policies/default`,
  enrollmentTokenData: JSON.stringify({ owner: "alice@example.com", by: "alice@example.com" }),
  hardwareInfo: { brand: "google", manufacturer: "Google", model: "Pixel 9", serialNumber: "SER123" },
  softwareInfo: { androidVersion: "15", securityPatchLevel: "2026-09-05" },
  deviceSettings: { isDeviceSecure: true, isEncrypted: true, adbEnabled: false },
  securityPosture: { devicePosture: "SECURE" },
  applicationReports: [{ packageName: "com.slack", displayName: "Slack", versionName: "25.10", state: "INSTALLED" }],
  networkInfo: { telephonyInfos: [{ phoneNumber: "+15550100" }] },
  ...over,
});

describe.skipIf(!base)("android device management end to end", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const google = await fakeGoogle();
  process.env.DEVICES_ANDROID_API_URL = google.url;
  process.env.DEVICES_ANDROID_TOKEN_URL = `${google.url}/token`;
  const { q, db } = await import("../lib/db");
  const android = await import("../lib/mdm/android");
  const apple = await import("../lib/mdm/apple");
  const catalog = await import("../lib/mdm/catalog");
  const devices = await import("../lib/devices");

  const deviceOf = async (id: string) => (await q<{ id: string }>(`SELECT id FROM devices WHERE host_identifier = $1`, [`android:${id}`]))[0]?.id;

  beforeAll(async () => {
    await q("TRUNCATE enroll_secrets, devices, policies, audit, mdm_settings, mdm_enroll_tokens, mdm_enrollments, mdm_commands, mdm_profiles, mdm_apps CASCADE");
    const { BASELINE } = await import("../lib/rules");
    await devices.createPolicy(admin, BASELINE);
  });
  afterAll(async () => {
    google.server.close();
    await db().close();
  });

  it("connects the organization's managed Google Play through the sign-up", async () => {
    expect(await android.androidStatus()).toMatchObject({ configured: true, ready: false, enterprise: null });
    await expect(android.androidEnrollment(alice, {})).rejects.toThrow(/Connect Android management/);
    await expect(android.finishSignup(admin, "EntToken123", "Acme")).rejects.toThrow(/Start connecting/);
    const { url } = await android.startSignup(admin);
    expect(url).toMatch(/^https:\/\/play\.google\.com\/work\/adminsignup/);
    const signup = google.calls.find((c) => c.path === "signupUrls")!;
    expect(signup.query.get("projectId")).toBe("acme-mdm");
    expect(signup.query.get("callbackUrl")).toMatch(/^https:\/\/.+\/api\/mdm\/android\/callback$/);
    await expect(android.finishSignup(admin, "x", "Acme")).rejects.toThrow(/sign-up token/);
    await android.finishSignup(admin, "EntToken123", "Acme");
    expect(google.tokens()).toBe(1);
    const s = await android.androidStatus();
    expect(s).toMatchObject({ ready: true, enterprise: { enterprise: ENT, display_name: "Acme", connected_by: admin.email } });
    // Connecting pushes the shared policy straight away.
    expect(google.policies.get("default")).toMatchObject({ playStoreMode: "WHITELIST", applications: [] });
    await expect(android.finishSignup(admin, "EntToken123", "Acme")).rejects.toThrow(/already connected/);
  });

  it("makes one-time enrollment tokens: work profiles for anyone, company phones for admins", async () => {
    const t = await android.androidEnrollment(alice, { mode: "work_profile" });
    expect(t.link).toBe("https://enterprise.google.com/android/enroll?et=ENROLLTOKEN1");
    expect(t.qr).toMatch(/^data:image\/png;base64,/);
    const sent = google.calls.filter((c) => c.path === `${ENT}/enrollmentTokens`).pop()!.body!;
    expect(sent).toMatchObject({ oneTimeOnly: true, allowPersonalUsage: "PERSONAL_USAGE_ALLOWED", policyName: `${ENT}/policies/default` });
    expect(JSON.parse(String(sent.additionalData))).toEqual({ owner: alice.email, by: alice.email });
    await expect(android.androidEnrollment(alice, { mode: "fully_managed" })).rejects.toThrow(/admins/);
    await expect(android.androidEnrollment(alice, { org: true })).rejects.toThrow(/admins/);
    const company = await android.androidEnrollment(admin, { mode: "fully_managed", org: true });
    expect(company.mode).toBe("fully_managed");
    const sent2 = google.calls.filter((c) => c.path === `${ENT}/enrollmentTokens`).pop()!.body!;
    expect(sent2.allowPersonalUsage).toBe("PERSONAL_USAGE_DISALLOWED");
    expect(JSON.parse(String(sent2.additionalData)).owner).toBeNull();
  });

  it("reads phones back from Google, with their owner, facts, apps and compliance", async () => {
    google.phones.set(`${ENT}/devices/a1`, phone("a1"));
    google.phones.set(`${ENT}/devices/c1`, phone("c1", {
      managementMode: "DEVICE_OWNER", ownership: "COMPANY_OWNED", enrollmentTokenData: JSON.stringify({ owner: null, by: admin.email }),
      hardwareInfo: { brand: "samsung", manufacturer: "Samsung", model: "SM-S921B", serialNumber: "R5CX" },
      deviceSettings: { isDeviceSecure: false, isEncrypted: true }, securityPosture: { devicePosture: "POTENTIALLY_COMPROMISED" }, policyCompliant: false,
      nonComplianceDetails: [{ settingName: "passwordPolicies", nonComplianceReason: "USER_ACTION" }],
    }));
    expect(await android.syncAndroidDevices()).toBe(2);
    const a1 = await deviceOf("a1");
    const c1 = await deviceOf("c1");
    const d = await devices.getDevice(alice, a1);
    expect(d).toMatchObject({ hostname: "Google Pixel 9", platform: "android", os_name: "Android", os_version: "15", owner: alice.email, hardware_serial: "SER123", compliance: "compliant" });
    expect((d as Record<string, unknown>).facts).toMatchObject({ disk_encryption: true, screen_lock: true, system_protection: true });
    expect(d.software_count).toBe(1);
    await expect(devices.getDevice(bob, a1)).rejects.toThrow(/No such device/);
    const c = await devices.getDevice(admin, c1);
    expect(c).toMatchObject({ owner: null, compliance: "noncompliant" });
    const m = (await apple.managementOf(admin, c1))!;
    expect(m).toMatchObject({ platform: "android", enrollment_type: "fully_managed", status: "enrolled" });
    expect((m as Record<string, unknown>).info).toMatchObject({ policy_compliant: false, posture: "POTENTIALLY_COMPROMISED", phone: "+15550100" });
    expect((await android.androidStatus())).toMatchObject({ enrolled: 2, work_profile: 1, fully_managed: 1 });
    expect((await devices.overview()) as Record<string, unknown>).toMatchObject({ android: 2 });
  });

  it("pushes Android profiles and Play apps into the policy", async () => {
    await catalog.createProfile(admin, { name: "Passcode", kind: "passcode", settings: { min_length: 8, require_alphanumeric: true, max_inactivity_minutes: 2 } });
    await catalog.createProfile(admin, { name: "Office Wi-Fi", kind: "wifi", settings: { ssid: "Office", password: "secretpassword" }, platforms: ["android"] });
    const slack = await catalog.createApp(admin, { name: "Slack", source: "play", store: "https://play.google.com/store/apps/details?id=com.Slack&hl=en" });
    await expect(catalog.createApp(admin, { name: "Bad", source: "play", store: "not a package" })).rejects.toThrow(/Google Play link/);
    const p = google.policies.get("default")!;
    expect(p.passwordPolicies).toEqual([{ passwordScope: "SCOPE_DEVICE", passwordQuality: "ALPHANUMERIC", passwordMinimumLength: 8 }]);
    expect(p.maximumTimeToLock).toBe("120000");
    expect((p.openNetworkConfiguration as { NetworkConfigurations: { WiFi: Record<string, unknown> }[] }).NetworkConfigurations[0].WiFi).toMatchObject({ SSID: "Office", Security: "WPA-PSK", Passphrase: "secretpassword" });
    expect(p.applications).toEqual([{ packageName: "com.Slack", installType: "AVAILABLE" }]);
    // Install on all: new and existing phones get it forced.
    await catalog.installApp(admin, slack.id, { all: true });
    expect(google.policies.get("default")!.applications).toEqual([{ packageName: "com.Slack", installType: "FORCE_INSTALLED" }]);
    await catalog.updateApp(admin, slack.id, { auto_install: false });
    expect(google.policies.get("default")!.applications).toEqual([{ packageName: "com.Slack", installType: "AVAILABLE" }]);
  });

  it("installs an app on one phone through a policy of its own", async () => {
    const a1 = await deviceOf("a1");
    const zoom = await catalog.createApp(admin, { name: "Zoom", source: "play", store: "us.zoom.videomeetings" });
    await expect(catalog.installApp(bob, zoom.id, { devices: [a1] })).rejects.toThrow(/No enrolled/);
    expect(await catalog.installApp(alice, zoom.id, { devices: [a1] })).toEqual({ devices: 1 });
    const own = [...google.policies.entries()].find(([k]) => k.startsWith("device-"))!;
    expect(own[1].applications).toEqual([{ packageName: "com.Slack", installType: "AVAILABLE" }, { packageName: "us.zoom.videomeetings", installType: "FORCE_INSTALLED" }]);
    expect(google.phones.get(`${ENT}/devices/a1`)!.policyName).toBe(`${ENT}/policies/${own[0]}`);
    // Removing the app from the catalog takes it out of the phone's own policy too.
    await catalog.deleteApp(admin, zoom.id);
    expect(google.policies.get(own[0])!.applications).toEqual([{ packageName: "com.Slack", installType: "AVAILABLE" }]);
  });

  it("locks and restarts, and settles commands when Google reports them done", async () => {
    const a1 = await deviceOf("a1");
    const c1 = await deviceOf("c1");
    await expect(apple.lock(bob, a1, {})).rejects.toThrow(/No such device/);
    expect(await apple.lock(alice, a1, {})).toEqual({ pin: null });
    const lockCall = google.calls.filter((c) => c.path.endsWith(":issueCommand")).pop()!;
    expect(lockCall).toMatchObject({ path: `${ENT}/devices/a1:issueCommand`, body: { type: "LOCK" } });
    await expect(apple.power(admin, a1, "restart")).rejects.toThrow(/company phones/);
    await expect(apple.power(admin, c1, "shutdown")).rejects.toThrow(/only be restarted/);
    await apple.power(admin, c1, "restart");
    let m = (await apple.managementOf(alice, a1))!;
    expect(m.commands.find((c) => c.request_type === "LOCK")).toMatchObject({ status: "queued", label: "Lock", requested_by: alice.email });
    google.operations.set(`${ENT}/devices/a1/operations/1`, { done: true });
    google.operations.set(`${ENT}/devices/c1/operations/2`, { done: true, error: { message: "Device offline too long" } });
    await android.syncAndroidDevices();
    m = (await apple.managementOf(alice, a1))!;
    expect(m.commands.find((c) => c.request_type === "LOCK")!.status).toBe("acknowledged");
    const c = (await apple.managementOf(admin, c1))!;
    expect(c.commands.find((x) => x.request_type === "REBOOT")).toMatchObject({ status: "error", error: "Device offline too long" });
  });

  it("removes only the work profile when a personal phone is erased or retired", async () => {
    const a1 = await deviceOf("a1");
    await expect(apple.erase(alice, a1, { confirm: "Google Pixel 9" })).rejects.toThrow(/admins/);
    await expect(apple.erase(admin, a1, { confirm: "nope" })).rejects.toThrow(/Type the device's name/);
    await apple.erase(admin, a1, { confirm: "Google Pixel 9" });
    const del = google.calls.filter((c) => c.method === "DELETE").pop()!;
    expect(del.path).toBe(`${ENT}/devices/a1`);
    expect(del.query.get("wipeDataFlags")).toBeNull();
    expect(google.phones.has(`${ENT}/devices/a1`)).toBe(false);
    expect((await q(`SELECT 1 FROM devices WHERE id = $1 AND retired_at IS NOT NULL`, [a1])).length).toBe(1);
    await expect(apple.lock(alice, a1, {})).rejects.toThrow(/No such device/);
  });

  it("factory resets a company phone, optionally removing its eSIMs", async () => {
    const c1 = await deviceOf("c1");
    await apple.erase(admin, c1, { confirm: "Samsung SM-S921B", keep_data_plan: false });
    const del = google.calls.filter((c) => c.method === "DELETE").pop()!;
    expect(del.path).toBe(`${ENT}/devices/c1`);
    expect(del.query.get("wipeDataFlags")).toBe("WIPE_ESIMS");
    expect((await android.androidStatus()).enrolled).toBe(0);
  });

  it("retires a phone Google stops listing, and drops a work profile when retired here", async () => {
    google.phones.set(`${ENT}/devices/a2`, phone("a2"));
    google.phones.set(`${ENT}/devices/a3`, phone("a3", { hardwareInfo: { brand: "google", model: "Pixel 8", serialNumber: "S3" } }));
    await android.syncAndroidDevices();
    const a2 = await deviceOf("a2");
    const a3 = await deviceOf("a3");
    google.phones.delete(`${ENT}/devices/a2`);
    await android.syncAndroidDevices();
    expect((await q<{ status: string }>(`SELECT status FROM mdm_enrollments WHERE id = $1`, [`${ENT}/devices/a2`]))[0].status).toBe("unenrolled");
    expect((await q(`SELECT 1 FROM devices WHERE id = $1 AND retired_at IS NOT NULL`, [a2])).length).toBe(1);
    await devices.retire(admin, a3);
    expect(google.phones.has(`${ENT}/devices/a3`)).toBe(false);
    expect((await q<{ status: string }>(`SELECT status FROM mdm_enrollments WHERE id = $1`, [`${ENT}/devices/a3`]))[0].status).toBe("unenrolled");
  });
});
