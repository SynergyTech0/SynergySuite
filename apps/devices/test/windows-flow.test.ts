import { afterAll, beforeAll, describe, expect, it } from "vitest";
import forge from "node-forge";
import { createDb } from "@synergy/db";
import { child, children, parseXml, textAt, type XmlNode } from "../lib/mdm/xml";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_devices_windows"). It plays a Windows PC: discovery, the federated sign-in, the policy
// and certificate request of MS-MDE2, then OMA-DM check-ins with the certificate Devices issued.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.DEVICES_OSV_URL = "off";
process.env.SUITE_DOMAIN = "example.com";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1) || "postgres"}_devices_windows`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const admin = { email: "admin@example.com", name: "Admin", role: "admin" as const };
const alice = { email: "alice@example.com", name: "Alice", role: "user" as const };
const bob = { email: "bob@example.com", name: "Bob", role: "user" as const };

const DEVICE = "6F2A9C41B7D84E0F9A3B5C7D1E2F3A4B";
const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

function csrFor(cn: string): string {
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([{ name: "commonName", value: cn }]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return forge.util.encode64(forge.asn1.toDer(forge.pki.certificationRequestToAsn1(csr)).getBytes());
}

const soap = (action: string, header: string, body: string) =>
  `<s:Envelope xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>` +
  `<a:Action s:mustUnderstand="1">${action}</a:Action><a:MessageID>urn:uuid:0d5a1441-5891-453b-becf-a2e5f6ea3749</a:MessageID>${header}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;

const security = (token: string) =>
  `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">` +
  `<wsse:BinarySecurityToken ValueType="http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentUserToken" ` +
  `EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">${Buffer.from(token).toString("base64")}</wsse:BinarySecurityToken></wsse:Security>`;

const discoverXml = soap("http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover", "",
  `<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment"><request xmlns:i="http://www.w3.org/2001/XMLSchema-instance">` +
  `<EmailAddress>alice@example.com</EmailAddress><RequestVersion>4.0</RequestVersion><DeviceType>CIMClient_Windows</DeviceType>` +
  `<ApplicationVersion>10.0.22631.2861</ApplicationVersion><OSEdition>48</OSEdition><AuthPolicies><AuthPolicy>OnPremise</AuthPolicy><AuthPolicy>Federated</AuthPolicy></AuthPolicies></request></Discover>`);

const policyXml = (token: string) => soap("http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPolicies", security(token),
  `<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy"><client><lastUpdate xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/><preferredLanguage xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></client><requestFilter xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></GetPolicies>`);

const enrollXml = (token: string, deviceId = DEVICE) => soap("http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep", security(token),
  `<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:ac="http://schemas.xmlsoap.org/ws/2006/12/authorization">` +
  `<wst:TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</wst:TokenType>` +
  `<wst:RequestType>http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue</wst:RequestType>` +
  `<wsse:BinarySecurityToken ValueType="http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">${csrFor("ignored")}</wsse:BinarySecurityToken>` +
  `<ac:AdditionalContext xmlns="http://schemas.xmlsoap.org/ws/2006/12/authorization">` +
  [["UXInitiated", "true"], ["HWDevID", "A1B2C3"], ["Locale", "en-US"], ["OSEdition", "48"], ["DeviceName", "ALICE-LAPTOP"], ["MAC", "00-11-22-33-44-55"],
    ["DeviceID", deviceId], ["EnrollmentType", "Full"], ["DeviceType", "CIMClient_Windows"], ["OSVersion", "10.0.22631.2861"], ["ApplicationVersion", "10.0.22631.2861"]]
    .map(([k, v]) => `<ac:ContextItem Name="${k}"><ac:Value>${v}</ac:Value></ac:ContextItem>`).join("") +
  `</ac:AdditionalContext></wst:RequestSecurityToken>`);

type Cmd = { name: string; id: string; uri: string; data: string; format: string };

/** A SyncML message from the PC. */
function syncml(session: string, msg: number, body: string, deviceId = DEVICE): string {
  return `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>${session}</SessionID><MsgID>${msg}</MsgID>` +
    `<Target><LocURI>https://devices-windows.example.com/ManagementServer/MDM.svc</LocURI></Target><Source><LocURI>${deviceId}</LocURI></Source></SyncHdr>` +
    `<SyncBody>${body}<Final/></SyncBody></SyncML>`;
}
const start = `<Alert><CmdID>2</CmdID><Data>1201</Data></Alert>` +
  `<Replace><CmdID>3</CmdID><Item><Source><LocURI>./DevInfo/DevId</LocURI></Source><Data>${DEVICE}</Data></Item>` +
  `<Item><Source><LocURI>./DevInfo/Man</LocURI></Source><Data>LENOVO</Data></Item><Item><Source><LocURI>./DevInfo/Mod</LocURI></Source><Data>ThinkPad X1</Data></Item></Replace>`;
const status = (ref: string, code: number, cmd = "Exec", n = 9) => `<Status><CmdID>${n}</CmdID><MsgRef>1</MsgRef><CmdRef>${ref}</CmdRef><Cmd>${cmd}</Cmd><Data>${code}</Data></Status>`;

function commandsOf(xml: string): { hdr: XmlNode; statuses: XmlNode[]; cmds: Cmd[] } {
  const doc = parseXml(xml);
  const body = child(doc, "SyncBody")!;
  return {
    hdr: child(doc, "SyncHdr")!,
    statuses: children(body, "Status"),
    cmds: body.children.filter((c) => !["Status", "Final"].includes(c.name)).map((c) => ({
      name: c.name, id: textAt(c, "CmdID"), uri: textAt(c, "Item", "Target", "LocURI"), data: textAt(c, "Item", "Data"), format: textAt(c, "Item", "Meta", "Format"),
    })),
  };
}

describe.skipIf(!base)("windows device management end to end", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const { q, db } = await import("../lib/db");
  const win = await import("../lib/mdm/windows");
  const apple = await import("../lib/mdm/apple");
  const catalog = await import("../lib/mdm/catalog");
  const devices = await import("../lib/devices");
  const discoveryRoute = await import("../app/api/windows/discovery/route");
  const enrollRoute = await import("../app/api/windows/enroll/route");
  const manageRoute = await import("../app/api/windows/manage/route");

  let cert = "";
  let deviceRow = "";
  const tokenFor = async (me: typeof alice) => {
    const html = await win.authPage(me, "ms-app://windows.immersivecontrolpanel");
    return /name="wresult" value="([^"]+)"/.exec(html)![1];
  };
  const checkIn = async (body: string, session = "1", msg = 1, c = cert) => {
    const res = await manageRoute.POST(new Request("http://devices/api/windows/manage", { method: "POST", body: syncml(session, msg, body), headers: { "x-client-cert": c } }));
    return { status: res.status, ...(res.status === 200 ? commandsOf(await res.text()) : { hdr: null, statuses: [], cmds: [] as Cmd[] }) };
  };

  beforeAll(async () => {
    await q("TRUNCATE enroll_secrets, devices, policies, audit, mdm_settings, mdm_enroll_tokens, mdm_enrollments, mdm_commands, mdm_profiles, mdm_apps CASCADE");
    const { BASELINE } = await import("../lib/rules");
    await devices.createPolicy(admin, BASELINE);
  });
  afterAll(async () => {
    await db().close();
  });

  it("answers discovery with the federated sign-in and its services", async () => {
    expect((await discoveryRoute.GET()).status).toBe(200);
    const res = await discoveryRoute.POST(new Request("http://devices/api/windows/discovery", { method: "POST", body: discoverXml }));
    expect(res.headers.get("content-type")).toMatch(/application\/soap\+xml/);
    const r = child(parseXml(await res.text()), "Body", "DiscoverResponse", "DiscoverResult");
    expect(textAt(r, "AuthPolicy")).toBe("Federated");
    expect(textAt(r, "EnrollmentServiceUrl")).toBe("https://devices.example.com/api/windows/enroll");
    expect(textAt(r, "EnrollmentPolicyServiceUrl")).toBe("https://devices.example.com/api/windows/policy");
    expect(textAt(r, "AuthenticationServiceUrl")).toBe("https://devices.example.com/api/enroll/windows/auth");
    expect(win.enrollmentLink("alice@example.com")).toBe("ms-device-enrollment:?mode=mdm&username=alice%40example.com&servername=https%3A%2F%2Fdevices.example.com%2Fapi%2Fwindows%2Fdiscovery");
    const bad = await discoveryRoute.POST(new Request("http://devices/api/windows/discovery", { method: "POST", body: "<nope" }));
    expect(bad.status).toBe(500);
    expect(await bad.text()).toMatch(/MessageFormat/);
  });

  it("hands Windows a one-time token from the signed-in page", async () => {
    await expect(win.authPage(alice, "https://evil.example.com")).rejects.toThrow(/Windows enrollment/);
    const html = await win.authPage(alice, "ms-app://windows.immersivecontrolpanel");
    expect(html).toContain('action="ms-app://windows.immersivecontrolpanel"');
    expect(html).toContain("alice@example.com");
  });

  it("gives the certificate policy only with a valid token", async () => {
    const token = await tokenFor(alice);
    const ok = await win.policies(policyXml(token));
    expect(textAt(child(parseXml(ok), "Body", "GetPoliciesResponse", "response", "policies", "policy", "attributes", "privateKeyAttributes"), "minimalKeyLength")).toBe("2048");
    await expect(win.policies(policyXml("not-a-token-at-all-really"))).rejects.toThrow(/Sign in again/);
  });

  it("enrolls: signs the PC's certificate and returns the provisioning document", async () => {
    const token = await tokenFor(alice);
    const res = await enrollRoute.POST(new Request("http://devices/api/windows/enroll", { method: "POST", body: enrollXml(token) }));
    expect(res.status).toBe(200);
    const bst = child(parseXml(await res.text()), "Body", "RequestSecurityTokenResponseCollection", "RequestSecurityTokenResponse", "RequestedSecurityToken", "BinarySecurityToken")!;
    const prov = parseXml(Buffer.from(bst.text, "base64").toString("utf8"));
    const stores = children(prov, "characteristic").filter((c) => c.attrs.type === "CertificateStore");
    const rootCert = stores[0].children[0].children[0].children[0];
    const myCert = stores[1].children[0].children[0].children[0];
    const app = children(prov, "characteristic").find((c) => c.attrs.type === "APPLICATION")!;
    const parm = (n: string) => children(app, "parm").find((p) => p.attrs.name === n)?.attrs.value;
    expect(parm("ADDR")).toBe("https://devices-windows.example.com/ManagementServer/MDM.svc");
    expect(parm("APPID")).toBe("w7");
    expect(parm("SSLCLIENTCERTSEARCHCRITERIA")).toBe(`Subject=CN%3D${DEVICE}&Stores=MY%5CSystem`);
    cert = children(myCert, "parm")[0].attrs.value;
    const issued = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(cert)));
    const root = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(children(rootCert, "parm")[0].attrs.value)));
    expect(issued.subject.getField("CN").value).toBe(DEVICE);
    expect(root.verify(issued)).toBe(true);
    expect(forge.pki.publicKeyToPem(issued.publicKey)).toBe(forge.pki.publicKeyToPem(keys.publicKey));
    expect(myCert.attrs.type).toBe(forge.md.sha1.create().update(forge.util.decode64(cert)).digest().toHex().toUpperCase());
    // The token is spent.
    const again = await enrollRoute.POST(new Request("http://devices/api/windows/enroll", { method: "POST", body: enrollXml(token) }));
    expect(await again.text()).toMatch(/Authentication/);
    const [d] = await q<{ id: string; owner: string; platform: string; hostname: string }>(`SELECT id, owner, platform, hostname FROM devices WHERE host_identifier = $1`, [`wmdm:${DEVICE}`]);
    expect(d).toMatchObject({ owner: alice.email, platform: "windows", hostname: "ALICE-LAPTOP" });
    deviceRow = d.id;
  });

  it("refuses check-ins without the PC's own certificate", async () => {
    expect((await checkIn(start, "1", 1, "")).status).toBe(401);
    // A certificate from another CA, with the right name.
    const other = forge.pki.createCertificate();
    other.publicKey = keys.publicKey;
    other.serialNumber = "01";
    other.validity.notBefore = new Date(Date.now() - 1000);
    other.validity.notAfter = new Date(Date.now() + 86400_000);
    other.setSubject([{ name: "commonName", value: DEVICE }]);
    other.setIssuer([{ name: "commonName", value: DEVICE }]);
    other.sign(keys.privateKey, forge.md.sha256.create());
    expect((await checkIn(start, "1", 1, forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(other)).getBytes()))).status).toBe(401);
    // The right certificate, claiming to be another PC.
    const res = await manageRoute.POST(new Request("http://x", { method: "POST", body: syncml("1", 1, start, "OTHERDEVICE123"), headers: { "x-client-cert": cert } }));
    expect(res.status).toBe(401);
  });

  it("completes enrollment at the first check-in and asks for the PC's details", async () => {
    const r = await checkIn(start);
    expect(r.status).toBe(200);
    expect(textAt(r.hdr!, "Target", "LocURI")).toBe(DEVICE);
    expect(r.statuses.map((s) => [textAt(s, "Cmd"), textAt(s, "CmdRef"), textAt(s, "Data")])).toEqual([["SyncHdr", "0", "200"], ["Alert", "2", "200"], ["Replace", "3", "200"]]);
    const gets = r.cmds.filter((c) => c.name === "Get").map((c) => c.uri);
    expect(gets).toContain("./Vendor/MSFT/DeviceStatus/Compliance/EncryptionCompliance");
    expect(gets).toContain("./DevDetail/SwV");
    expect((await q<{ status: string }>(`SELECT status FROM mdm_enrollments WHERE id = $1`, [DEVICE]))[0].status).toBe("enrolled");
    // A PC running osquery with the same serial number: the two become one device.
    await q(`INSERT INTO devices (host_identifier, hostname, platform, os_name, hardware_serial, owner) VALUES ('osq-1', 'ALICE-LAPTOP', 'windows', 'Windows 11 Pro', 'PF3X9Z', NULL)`);
    const results = (pairs: [string, string][]) => `<Results><CmdID>5</CmdID><MsgRef>1</MsgRef><CmdRef>info.0</CmdRef>${pairs.map(([u, d]) => `<Item><Source><LocURI>${u}</LocURI></Source><Data>${d}</Data></Item>`).join("")}</Results>`;
    const r2 = await checkIn(results([
      ["./DevDetail/SwV", "10.0.22631.2861"], ["./DevDetail/Ext/Microsoft/OSPlatform", "Windows 11 Pro"], ["./DevDetail/Ext/Microsoft/SMBIOSSerialNumber", "PF3X9Z"],
      ["./Vendor/MSFT/DeviceStatus/Compliance/EncryptionCompliance", "1"], ["./Vendor/MSFT/DeviceStatus/Firewall/Status", "0"], ["./Vendor/MSFT/DeviceStatus/Antivirus/Status", "0"],
    ]), "1", 2);
    expect(r2.statuses.map((s) => textAt(s, "Cmd"))).toEqual(["SyncHdr", "Results"]);
    expect(r2.cmds).toEqual([]);
    const [osq] = await q<{ id: string; owner: string; facts: Record<string, boolean> }>(`SELECT id, owner, facts FROM devices WHERE host_identifier = 'osq-1'`);
    expect(osq.owner).toBe(alice.email);
    expect(osq.facts).toMatchObject({ disk_encryption: true, firewall: true, antivirus: true });
    expect((await q(`SELECT 1 FROM devices WHERE id = $1`, [deviceRow])).length).toBe(0);
    deviceRow = osq.id;
    expect((await q<{ device_id: string }>(`SELECT device_id FROM mdm_enrollments WHERE id = $1`, [DEVICE]))[0].device_id).toBe(deviceRow);
    expect(((await apple.managementOf(alice, deviceRow)) as Record<string, unknown>).platform).toBe("windows");
  });

  it("pushes settings profiles as CSP settings and records their results", async () => {
    const pass = await catalog.createProfile(admin, { name: "Passcode", kind: "passcode", settings: { min_length: 8, require_alphanumeric: true, max_inactivity_minutes: 10 } });
    await catalog.createProfile(admin, { name: "Office Wi-Fi", kind: "wifi", settings: { ssid: "Office & Co", password: "secretpassword" }, platforms: ["windows"] });
    await catalog.createProfile(admin, { name: "No screenshots", kind: "restrictions", settings: { no_screenshots: true } });
    const r = await checkIn(start, "2", 1);
    const replaces = r.cmds.filter((c) => c.name === "Replace");
    expect(replaces.map((c) => [c.uri.split("/").pop(), c.data, c.format])).toEqual([
      ["DevicePasswordEnabled", "0", "int"], ["MinDevicePasswordLength", "8", "int"], ["AlphanumericDevicePasswordRequired", "0", "int"], ["MaxInactivityTimeDeviceLock", "10", "int"],
    ]);
    const wifiAdd = r.cmds.find((c) => c.name === "Add")!;
    expect(wifiAdd.uri).toBe("./Vendor/MSFT/WiFi/Profile/Office%20%26%20Co/WlanXml");
    expect(parseXml(wifiAdd.data).name).toBe("WLANProfile");
    expect(textAt(parseXml(wifiAdd.data), "MSM", "security", "sharedKey", "keyMaterial")).toBe("secretpassword");
    // The screenshot setting has no Windows equivalent: nothing to send, counted as applied.
    const statusOf = async (name: string) => (await apple.managementOf(admin, deviceRow))!.profiles.find((p) => (p as { name: string }).name === name) as { status: string; error: string | null };
    expect((await statusOf("No screenshots")).status).toBe("installed");
    // Nothing is sent twice in one session.
    expect((await checkIn("", "2", 2)).cmds).toEqual([]);
    const answers = [...r.cmds.filter((c) => c.name !== "Get").map((c, i) => status(c.id, c.name === "Delete" ? 404 : 200, c.name, 10 + i))].join("");
    await checkIn(answers, "2", 3);
    expect((await statusOf("Passcode")).status).toBe("installed");
    expect((await statusOf("Office Wi-Fi")).status).toBe("installed");
    // Turning a profile off removes its settings.
    await catalog.updateProfile(admin, pass.id, { enabled: false });
    const off = await checkIn(start, "3", 1);
    expect(off.cmds.filter((c) => c.name === "Delete").map((c) => c.uri.split("/").pop())).toEqual(["DevicePasswordEnabled", "MinDevicePasswordLength", "AlphanumericDevicePasswordRequired", "MaxInactivityTimeDeviceLock"]);
    await checkIn(off.cmds.map((c, i) => status(c.id, 200, c.name, 20 + i)).join(""), "3", 2);
    expect(await statusOf("Passcode")).toBeUndefined();
  });

  it("installs an MSI checked against its hash, by an admin or the PC's owner", async () => {
    const body = Buffer.from("MSI installer bytes");
    const fetcher = (async () => new Response(body)) as unknown as typeof fetch;
    await expect(catalog.createApp(admin, { name: "7-Zip", source: "msi", store: "nope", version: "24.08", url: "https://dl.example.com/7z.msi" }, fetcher)).rejects.toThrow(/product code/);
    const app = await catalog.createApp(admin, { name: "7-Zip", source: "msi", store: "23170F69-40C1-2702-2408-000001000000", version: "24.08", url: "https://dl.example.com/7z.msi" }, fetcher);
    await expect(catalog.installApp(bob, app.id, { devices: [deviceRow] })).rejects.toThrow(/No enrolled/);
    expect(await catalog.installApp(alice, app.id, { devices: [deviceRow] })).toEqual({ devices: 1 });
    const r = await checkIn(start, "4", 1);
    const [add, exec] = r.cmds.filter((c) => c.uri.includes("EnterpriseDesktopAppManagement"));
    expect(add).toMatchObject({ name: "Add", uri: "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/%7B23170F69-40C1-2702-2408-000001000000%7D/DownloadInstall" });
    expect(exec.name).toBe("Exec");
    const job = parseXml(exec.data);
    expect(textAt(job, "Product", "Validation", "FileHash")).toBe(forge.md.sha256.create().update(body.toString("binary")).digest().toHex().toUpperCase());
    expect(textAt(job, "Product", "Download", "ContentURLList", "ContentURL")).toBe("https://dl.example.com/7z.msi");
    // Add answers 418 when the node exists already; that's fine.
    await checkIn(status(add.id, 418, "Add", 30) + status(exec.id, 202, "Exec", 31), "4", 2);
    const cmd = (await apple.managementOf(alice, deviceRow))!.commands.find((c) => (c as { label: string }).label === "Install 7-Zip") as { status: string };
    expect(cmd.status).toBe("acknowledged");
  });

  it("restarts, reports failures in words, and can't lock", async () => {
    await expect(apple.lock(alice, deviceRow, {})).rejects.toThrow(/can't be locked/);
    await expect(apple.power(alice, deviceRow, "restart")).rejects.toThrow(/admins/);
    await expect(apple.power(admin, deviceRow, "shutdown")).rejects.toThrow(/not shut down/);
    await apple.power(admin, deviceRow, "restart");
    const r = await checkIn(start, "5", 1);
    const reboot = r.cmds.find((c) => c.uri === "./Device/Vendor/MSFT/Reboot/RebootNow")!;
    expect(reboot).toMatchObject({ name: "Exec", format: "null" });
    await checkIn(status(reboot.id, 405, "Exec"), "5", 2);
    const cmd = (await apple.managementOf(admin, deviceRow))!.commands.find((c) => (c as { label: string }).label === "Restart") as { status: string; error: string };
    expect(cmd).toMatchObject({ status: "error", error: "Windows answered 405 (that setting can't be changed this way): ./Device/Vendor/MSFT/Reboot/RebootNow" });
  });

  it("notices when the person removes management on the PC", async () => {
    const token = await tokenFor(bob);
    const second = "1C2D3E4F5A6B7C8D9E0F1A2B3C4D5E6F";
    const res = await enrollRoute.POST(new Request("http://x", { method: "POST", body: enrollXml(token, second) }));
    const prov = parseXml(Buffer.from(child(parseXml(await res.text()), "Body", "RequestSecurityTokenResponseCollection", "RequestSecurityTokenResponse", "RequestedSecurityToken", "BinarySecurityToken")!.text, "base64").toString());
    const bobCert = children(children(prov, "characteristic")[1].children[0].children[0].children[0], "parm")[0].attrs.value;
    const post = (body: string) => manageRoute.POST(new Request("http://x", { method: "POST", body: syncml("1", 1, body, second), headers: { "x-client-cert": bobCert } }));
    expect((await post(start.replaceAll(DEVICE, second))).status).toBe(200);
    await post(`<Alert><CmdID>2</CmdID><Data>1226</Data><Item><Meta><Type xmlns="syncml:metinf">com.microsoft:mdm.unenrollment.userrequest</Type><Format xmlns="syncml:metinf">int</Format></Meta><Data>1</Data></Item></Alert>`);
    expect((await q<{ status: string }>(`SELECT status FROM mdm_enrollments WHERE id = $1`, [second]))[0].status).toBe("unenrolled");
    expect((await q(`SELECT 1 FROM devices WHERE host_identifier = $1 AND retired_at IS NOT NULL`, [`wmdm:${second}`])).length).toBe(1);
    expect((await post(start)).status).toBe(401);
  });

  it("erases: the PC resets and leaves management once it confirms", async () => {
    await expect(apple.erase(admin, deviceRow, { confirm: "nope" })).rejects.toThrow(/Type the device's name/);
    await apple.erase(admin, deviceRow, { confirm: "ALICE-LAPTOP", keep_user_data: true });
    const r = await checkIn(start, "6", 1);
    const wipe = r.cmds.find((c) => c.uri.includes("RemoteWipe"))!;
    expect(wipe.uri).toBe("./Device/Vendor/MSFT/RemoteWipe/doWipePersistUserData");
    await checkIn(status(wipe.id, 200), "6", 2);
    expect((await q<{ status: string }>(`SELECT status FROM mdm_enrollments WHERE id = $1`, [DEVICE]))[0].status).toBe("unenrolled");
    // The osquery row stays: it stops reporting on its own once the PC is reset.
    expect((await q(`SELECT 1 FROM devices WHERE id = $1 AND retired_at IS NULL`, [deviceRow])).length).toBe(1);
  });
});
