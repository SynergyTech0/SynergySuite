import { createHash, randomBytes, randomUUID } from "node:crypto";
import forge from "node-forge";
import { cameThroughGateway } from "@synergy/identity";
import type { Me } from "../api";
import { audit, q, tx } from "../db";
import { serverHost } from "../enroll";
import type { Facts } from "../rules";
import { recompute } from "../state";
import { UserError, sha256, text } from "../util";
import { organization } from "./apple";
import { deployToEnrollment } from "./catalog";
import type { Settings } from "./profiles";
import { type XmlNode, XmlError, child, children, esc, parseXml, textAt } from "./xml";

/**
 * Windows device management, built into Devices from Microsoft's published protocols: enrollment
 * (MS-MDE2, with MS-XCEP and MS-WSTEP) and OMA-DM 1.2 sessions with the configuration service
 * providers (CSPs) Windows has built in. Nothing is installed on the PC.
 *
 * Enrolling: the person opens an ms-device-enrollment link (or Settings › Accounts › Access work or
 * school › Enroll only in device management). Windows asks Devices how to enroll (discovery), shows
 * the suite's sign-in page in a window (the "federated" policy), gets a one-time token back, and
 * sends a certificate request. Devices signs it with its own Windows device CA and answers with a
 * provisioning document: that certificate, and where and how often to check in.
 *
 * Managing: Windows checks in to https://devices-windows.<domain>/ManagementServer/MDM.svc with
 * that certificate (TLS client authentication, done by the proxy, which passes the certificate on)
 * about once an hour. Each check-in is a SyncML conversation: Devices answers with the commands
 * waiting for the PC, and the PC answers with their results. Windows has no wake-up channel
 * without Microsoft's push service, so commands wait for the next check-in.
 */

export const PROVIDER_ID = "Synergy";

export const windowsEnabled = (env: NodeJS.ProcessEnv = process.env) => (env.DEVICES_WINDOWS_MDM ?? "").toLowerCase() !== "off";

/** The host Windows checks in to: one that asks for a client certificate, so it is separate from Devices' own. */
export function managementHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DEVICES_WINDOWS_MDM_HOST) return env.DEVICES_WINDOWS_MDM_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const host = serverHost(env);
  return host.startsWith("devices.") ? `devices-windows.${host.slice("devices.".length)}` : `devices-windows.${host}`;
}

export function windowsUrls(env: NodeJS.ProcessEnv = process.env) {
  const base = `https://${serverHost(env)}`;
  return {
    discovery: `${base}/api/windows/discovery`,
    policy: `${base}/api/windows/policy`,
    enrollment: `${base}/api/windows/enroll`,
    auth: `${base}/api/enroll/windows/auth`,
    management: `https://${managementHost(env)}/ManagementServer/MDM.svc`,
  };
}

/** The link that starts enrollment on a Windows PC. */
export function enrollmentLink(email: string, env: NodeJS.ProcessEnv = process.env): string {
  const p = new URLSearchParams({ mode: "mdm", username: email, servername: windowsUrls(env).discovery });
  return `ms-device-enrollment:?${p.toString().replace(/\+/g, "%20")}`;
}

/* ---------------------------------------------------------------- the device CA */

type CaSetting = { cert: string; key: string; created_at: string };
type Ca = { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey; der: string; thumbprint: string };
let ca: Ca | null = null;

const thumbprint = (derBinary: string) => forge.md.sha1.create().update(derBinary).digest().toHex().toUpperCase();
const derOf = (c: forge.pki.Certificate) => forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
const serial = () => `01${randomBytes(15).toString("hex")}`;

function load(s: CaSetting): Ca {
  const cert = forge.pki.certificateFromPem(s.cert);
  return { cert, key: forge.pki.privateKeyFromPem(s.key) as forge.pki.rsa.PrivateKey, der: derOf(cert), thumbprint: thumbprint(derOf(cert)) };
}

/** Devices' certificate authority for Windows device identities, made on first use and kept in the database. */
export async function deviceCa(): Promise<Ca> {
  if (ca) return ca;
  const [row] = await q<{ value: CaSetting }>(`SELECT value FROM mdm_settings WHERE key = 'windows_ca'`);
  if (row) return (ca = load(row.value));
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 3600_000);
  cert.validity.notAfter = new Date(Date.now() + 20 * 365 * 86400_000);
  const name = [{ name: "commonName", value: `${organization()} Windows Device CA` }, { name: "organizationName", value: organization() }];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const value: CaSetting = { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey), created_at: new Date().toISOString() };
  // Two first requests at once: whichever saved first wins, and both use it.
  await q(`INSERT INTO mdm_settings (key, value, updated_by) VALUES ('windows_ca', $1, 'Devices') ON CONFLICT (key) DO NOTHING`, [JSON.stringify(value)]);
  const [saved] = await q<{ value: CaSetting }>(`SELECT value FROM mdm_settings WHERE key = 'windows_ca'`);
  return (ca = load(saved.value));
}

/** Signs a PC's certificate request (PKCS#10, base64 DER): its identity for checking in, named after its device ID. */
export async function issueIdentity(csrBase64: string, deviceId: string): Promise<{ der: string; thumbprint: string }> {
  const c = await deviceCa();
  let csr: forge.pki.CertificateSigningRequest;
  try {
    csr = forge.pki.certificationRequestFromAsn1(forge.asn1.fromDer(forge.util.decode64(csrBase64.replace(/\s+/g, ""))));
  } catch {
    throw new EnrollError("CertificateRequest", "The certificate request can't be read");
  }
  if (!csr.verify() || !csr.publicKey) throw new EnrollError("CertificateRequest", "The certificate request isn't signed by its key");
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 3600_000);
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 86400_000);
  cert.setSubject([{ name: "commonName", value: deviceId }, { name: "organizationName", value: organization() }]);
  cert.setIssuer(c.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", clientAuth: true },
  ]);
  cert.sign(c.key, forge.md.sha256.create());
  const der = derOf(cert);
  return { der: forge.util.encode64(der), thumbprint: thumbprint(der) };
}

/** The device ID a check-in certificate (base64 DER, from the proxy) proves, if Devices' CA issued it. */
export async function certificateIdentity(derBase64: string): Promise<{ deviceId: string; thumbprint: string } | null> {
  if (!derBase64) return null;
  try {
    const der = forge.util.decode64(derBase64.replace(/\s+/g, ""));
    const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
    const c = await deviceCa();
    if (!c.cert.verify(cert)) return null;
    const now = new Date();
    if (cert.validity.notBefore > now || cert.validity.notAfter < now) return null;
    const cn = cert.subject.getField("CN")?.value;
    return typeof cn === "string" && cn ? { deviceId: cn, thumbprint: thumbprint(der) } : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- enrollment (SOAP) */

const NS = {
  s: "http://www.w3.org/2003/05/soap-envelope",
  a: "http://www.w3.org/2005/08/addressing",
  wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
  u: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
  enroll: "http://schemas.microsoft.com/windows/management/2012/01/enrollment",
  xcep: "http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy",
  wstep: "http://schemas.microsoft.com/windows/pki/2009/01/enrollment",
  wst: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
};
const B64 = `${NS.wsse}#base64binary`;
const TOKEN_TYPE = "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken";
const USER_TOKEN = "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentUserToken";

/** A SOAP fault Windows shows as an enrollment error. Subcodes are MS-MDE2's. */
export class EnrollError extends Error {
  constructor(readonly subcode: "MessageFormat" | "Authentication" | "Authorization" | "CertificateRequest" | "EnrollmentServer" | "DeviceNotSupported", message: string) {
    super(message);
  }
}

function envelope(action: string, relatesTo: string, body: string, extraHeader = ""): string {
  return `<s:Envelope xmlns:s="${NS.s}" xmlns:a="${NS.a}" xmlns:u="${NS.u}">` +
    `<s:Header><a:Action s:mustUnderstand="1">${action}</a:Action>` +
    (relatesTo ? `<a:RelatesTo>${esc(relatesTo)}</a:RelatesTo>` : "") +
    `${extraHeader}</s:Header>` +
    `<s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">${body}</s:Body></s:Envelope>`;
}

export function soapFault(e: EnrollError, relatesTo = ""): string {
  return envelope("http://schemas.microsoft.com/net/2005/08/addressing/soap/fault", relatesTo,
    `<s:Fault><s:Code><s:Value>s:Receiver</s:Value><s:Subcode><s:Value xmlns:e="${NS.wstep}">e:${e.subcode}</s:Value></s:Subcode></s:Code>` +
    `<s:Reason><s:Text xml:lang="en-US">${esc(e.message)}</s:Text></s:Reason></s:Fault>`);
}

function readSoap(xml: string): { doc: XmlNode; messageId: string } {
  let doc: XmlNode;
  try {
    doc = parseXml(xml);
  } catch (e) {
    throw new EnrollError("MessageFormat", e instanceof XmlError ? `The request isn't valid XML: ${e.message}` : "The request isn't valid XML");
  }
  if (doc.name !== "Envelope") throw new EnrollError("MessageFormat", "Expected a SOAP envelope");
  return { doc, messageId: textAt(doc, "Header", "MessageID") };
}

/** Discovery: Windows asks how to enroll. Devices answers with its sign-in page and its two services. */
export function discover(xml: string): string {
  const { doc, messageId } = readSoap(xml);
  const req = child(doc, "Body", "Discover", "request");
  if (!req) throw new EnrollError("MessageFormat", "Expected a Discover request");
  const policies = children(child(req, "AuthPolicies"), "AuthPolicy").map((p) => p.text.trim());
  if (policies.length && !policies.includes("Federated")) throw new EnrollError("DeviceNotSupported", "This version of Windows can't sign in to enroll");
  const u = windowsUrls();
  return envelope(`${NS.enroll}/IDiscoveryService/DiscoverResponse`, messageId,
    `<DiscoverResponse xmlns="${NS.enroll}"><DiscoverResult>` +
    `<AuthPolicy>Federated</AuthPolicy><EnrollmentVersion>4.0</EnrollmentVersion>` +
    `<EnrollmentPolicyServiceUrl>${esc(u.policy)}</EnrollmentPolicyServiceUrl>` +
    `<EnrollmentServiceUrl>${esc(u.enrollment)}</EnrollmentServiceUrl>` +
    `<AuthenticationServiceUrl>${esc(u.auth)}</AuthenticationServiceUrl>` +
    `</DiscoverResult></DiscoverResponse>`,
    `<ActivityId xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics">${randomUUID()}</ActivityId>`);
}

/**
 * The sign-in page Windows shows during enrollment ("federated" policy): the person is already
 * signed in to the suite here, so Devices hands Windows a one-time token for this person.
 */
export async function authPage(me: Me, appru: string): Promise<string> {
  if (!/^ms-app:\/\/[^\s"<>]+$/i.test(appru)) throw new UserError("Open this page from Windows enrollment (Settings › Accounts › Access work or school)");
  const token = randomBytes(32).toString("base64url");
  await q(`INSERT INTO mdm_enroll_tokens (token_hash, owner, created_by) VALUES ($1, $2, $2)`, [sha256(token), me.email]);
  await audit(me.email, "windows.enrollment_token", "", {});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Enroll this PC</title>` +
    `<style>body{font:15px system-ui,sans-serif;margin:40px;color:#1f2328}button{font:inherit;padding:8px 18px;border-radius:6px;border:0;background:#0f6cbd;color:#fff}</style></head>` +
    `<body><h1 style="font-size:20px">Enroll this PC in ${esc(organization())}</h1>` +
    `<p>Signed in as ${esc(me.email)}. ${esc(organization())} will be able to apply required settings, install work apps, and restart or reset this PC. It can't see your personal files.</p>` +
    `<form id="f" method="post" action="${esc(appru)}"><input type="hidden" name="wresult" value="${token}"><button type="submit">Continue</button></form>` +
    `<script>document.getElementById("f").submit()</script></body></html>`;
}

/** The person a token belongs to. Windows sends it back as given, or base64 of it. */
async function tokenOwner(raw: string, consume: boolean): Promise<{ id: string; owner: string | null }> {
  const candidates = [raw.trim()];
  try {
    const decoded = Buffer.from(raw.trim(), "base64").toString("utf8");
    if (/^[A-Za-z0-9_-]{20,}$/.test(decoded)) candidates.push(decoded);
  } catch {
    // Not base64: the token as given.
  }
  const [t] = await q<{ id: string; owner: string | null }>(
    `${consume ? "UPDATE mdm_enroll_tokens SET last_used_at = now()" : "SELECT id, owner FROM mdm_enroll_tokens"}
     WHERE token_hash = ANY($1) AND last_used_at IS NULL AND created_at > now() - interval '1 hour' ${consume ? "RETURNING id, owner" : ""}`,
    [candidates.map(sha256)],
  );
  if (!t) throw new EnrollError("Authentication", "Sign in again to enroll: the enrollment sign-in expired or was already used");
  return t;
}

function securityToken(doc: XmlNode): string {
  const tok = children(child(doc, "Header", "Security"), "BinarySecurityToken").find((t) => t.attrs.ValueType === USER_TOKEN);
  if (!tok?.text.trim()) throw new EnrollError("Authentication", "Sign in to enroll this PC");
  return tok.text;
}

/** MS-XCEP GetPolicies: the kind of key Windows should make for its identity certificate. */
export async function policies(xml: string): Promise<string> {
  const { doc, messageId } = readSoap(xml);
  if (!child(doc, "Body", "GetPolicies")) throw new EnrollError("MessageFormat", "Expected a GetPolicies request");
  await tokenOwner(securityToken(doc), false);
  return envelope(`${NS.xcep}/IPolicy/GetPoliciesResponse`, messageId,
    `<GetPoliciesResponse xmlns="${NS.xcep}"><response>` +
    `<policyID/><policyFriendlyName xsi:nil="true"/><nextUpdateHours xsi:nil="true"/><policiesNotChanged xsi:nil="true"/>` +
    `<policies><policy><policyOIDReference>0</policyOIDReference><cAs xsi:nil="true"/><attributes>` +
    `<commonName>SynergyDevices</commonName><policySchema>3</policySchema>` +
    `<certificateValidity><validityPeriodSeconds>157680000</validityPeriodSeconds><renewalPeriodSeconds>2592000</renewalPeriodSeconds></certificateValidity>` +
    `<permission><enroll>true</enroll><autoEnroll>false</autoEnroll></permission>` +
    `<privateKeyAttributes><minimalKeyLength>2048</minimalKeyLength><keySpec xsi:nil="true"/><keyUsageProperty xsi:nil="true"/><permissions xsi:nil="true"/>` +
    `<algorithmOIDReference xsi:nil="true"/><cryptoProviders xsi:nil="true"/></privateKeyAttributes>` +
    `<revision><majorRevision>101</majorRevision><minorRevision>0</minorRevision></revision>` +
    `<supersededPolicies xsi:nil="true"/><privateKeyFlags xsi:nil="true"/><subjectNameFlags xsi:nil="true"/><enrollmentFlags xsi:nil="true"/>` +
    `<generalFlags xsi:nil="true"/><hashAlgorithmOIDReference>0</hashAlgorithmOIDReference><rARequirements xsi:nil="true"/>` +
    `<keyArchivalAttributes xsi:nil="true"/><extensions xsi:nil="true"/></attributes></policy></policies></response>` +
    `<cAs xsi:nil="true"/><oIDs><oID><value>1.3.14.3.2.29</value><group>1</group><oIDReferenceID>0</oIDReferenceID><defaultName>szOID_OIWSEC_sha1RSASign</defaultName></oID></oIDs>` +
    `</GetPoliciesResponse>`);
}

const attr = (s: string) => esc(s);

/** The provisioning document: the CA to trust, the PC's identity, and how to check in. */
export function provisioningDoc(o: { caDer: string; caThumbprint: string; certDer: string; certThumbprint: string; deviceId: string; management: string; name: string }): string {
  return `<wap-provisioningdoc version="1.1">` +
    `<characteristic type="CertificateStore"><characteristic type="Root"><characteristic type="System">` +
    `<characteristic type="${o.caThumbprint}"><parm name="EncodedCertificate" value="${o.caDer}"/></characteristic>` +
    `</characteristic></characteristic></characteristic>` +
    `<characteristic type="CertificateStore"><characteristic type="My"><characteristic type="System">` +
    `<characteristic type="${o.certThumbprint}"><parm name="EncodedCertificate" value="${o.certDer}"/></characteristic>` +
    `<characteristic type="PrivateKeyContainer"/>` +
    `</characteristic></characteristic></characteristic>` +
    `<characteristic type="APPLICATION">` +
    `<parm name="APPID" value="w7"/><parm name="PROVIDER-ID" value="${PROVIDER_ID}"/><parm name="NAME" value="${attr(o.name)}"/>` +
    `<parm name="ADDR" value="${attr(o.management)}"/><parm name="CONNRETRYFREQ" value="6"/><parm name="INITIALBACKOFFTIME" value="30000"/>` +
    `<parm name="MAXBACKOFFTIME" value="120000"/><parm name="BACKCOMPATRETRYDISABLED"/><parm name="DEFAULTENCODING" value="application/vnd.syncml.dm+xml"/>` +
    `<parm name="SSLCLIENTCERTSEARCHCRITERIA" value="${attr(`Subject=${encodeURIComponent(`CN=${o.deviceId}`)}&Stores=MY%5CSystem`)}"/>` +
    `</characteristic>` +
    `<characteristic type="DMClient"><characteristic type="Provider"><characteristic type="${PROVIDER_ID}">` +
    `<characteristic type="Poll">` +
    // Every 3 minutes for the first 45 minutes (settings and apps land quickly), then every 15 for
    // four hours, then hourly.
    `<parm name="NumberOfFirstRetries" value="15" datatype="integer"/><parm name="IntervalForFirstSetOfRetries" value="3" datatype="integer"/>` +
    `<parm name="NumberOfSecondRetries" value="16" datatype="integer"/><parm name="IntervalForSecondSetOfRetries" value="15" datatype="integer"/>` +
    `<parm name="NumberOfRemainingScheduledRetries" value="0" datatype="integer"/><parm name="IntervalForRemainingScheduledRetries" value="60" datatype="integer"/>` +
    `<parm name="PollOnLogin" value="true" datatype="boolean"/>` +
    `</characteristic>` +
    `<parm name="EntDeviceName" value="${attr(o.name)}" datatype="string"/>` +
    `</characteristic></characteristic></characteristic>` +
    `</wap-provisioningdoc>`;
}

/**
 * MS-WSTEP RequestSecurityToken: the PC's certificate request and who it is. Devices records the
 * PC, signs the request and answers with the provisioning document.
 */
export async function enroll(xml: string): Promise<string> {
  const { doc, messageId } = readSoap(xml);
  const rst = child(doc, "Body", "RequestSecurityToken");
  if (!rst) throw new EnrollError("MessageFormat", "Expected a RequestSecurityToken");
  const csr = children(rst, "BinarySecurityToken").find((t) => (t.attrs.ValueType ?? "").endsWith("#PKCS10"));
  if (!csr?.text.trim()) throw new EnrollError("CertificateRequest", "No certificate request");
  const ctx: Record<string, string> = {};
  for (const item of children(child(rst, "AdditionalContext"), "ContextItem")) {
    if (item.attrs.Name && !(item.attrs.Name in ctx)) ctx[item.attrs.Name] = textAt(item, "Value");
  }
  const deviceId = text(ctx.DeviceID, 100);
  if (!/^[A-Za-z0-9{}-]{8,100}$/.test(deviceId)) throw new EnrollError("MessageFormat", "The request has no device ID");
  if (ctx.EnrollmentType && ctx.EnrollmentType !== "Full" && ctx.EnrollmentType !== "Device") throw new EnrollError("DeviceNotSupported", "Only full device management is supported");
  const t = await tokenOwner(securityToken(doc), true);
  const identity = await issueIdentity(csr.text, deviceId);
  const c = await deviceCa();
  const name = text(ctx.DeviceName, 300) || "Windows PC";
  const info = {
    hw_dev_id: text(ctx.HWDevID, 200), os_edition: text(ctx.OSEdition, 20), locale: text(ctx.Locale, 20),
    cert_thumbprint: identity.thumbprint, enrolled_with: ctx.UXInitiated === "true" ? "settings" : "link",
  };
  await tx(async (tq) => {
    const [existing] = await tq<{ device_id: string | null }>(`SELECT device_id FROM mdm_enrollments WHERE id = $1 FOR UPDATE`, [deviceId]);
    const [d] = existing?.device_id
      ? await tq<{ id: string }>(
          `UPDATE devices SET owner = COALESCE(owner, $2), retired_at = NULL, retired_by = NULL, last_seen = now() WHERE id = $1 RETURNING id`,
          [existing.device_id, t.owner],
        )
      : [];
    const deviceRow = d ?? (await tq<{ id: string }>(
      `INSERT INTO devices (host_identifier, hostname, platform, os_name, os_version, owner)
       VALUES ($1, $2, 'windows', 'Windows', $3, $4)
       ON CONFLICT (host_identifier) DO UPDATE SET hostname = $2, os_version = $3, owner = COALESCE(devices.owner, $4),
         last_seen = now(), retired_at = NULL, retired_by = NULL, enrolled_at = CASE WHEN devices.retired_at IS NOT NULL THEN now() ELSE devices.enrolled_at END
       RETURNING id`,
      [`wmdm:${deviceId}`, name, text(ctx.OSVersion, 50), t.owner],
    ))[0];
    await tq(
      `INSERT INTO mdm_enrollments (id, device_id, enrollment_type, token_id, platform, status, info, authenticated_at, last_seen)
       VALUES ($1, $2, 'windows', $3, 'windows', 'authenticated', $4, now(), now())
       ON CONFLICT (id) DO UPDATE SET device_id = $2, enrollment_type = 'windows', token_id = $3, platform = 'windows', status = 'authenticated',
         info = mdm_enrollments.info || $4, authenticated_at = now(), enrolled_at = NULL, unenrolled_at = NULL, last_seen = now()`,
      [deviceId, deviceRow.id, t.id, JSON.stringify(info)],
    );
    // A new certificate: commands meant for the old enrollment won't be answered.
    await tq(`UPDATE mdm_commands SET status = 'error', error = 'The PC enrolled again', updated_at = now() WHERE enrollment_id = $1 AND status = 'queued'`, [deviceId]);
    await tq(`DELETE FROM mdm_profile_status WHERE enrollment_id = $1`, [deviceId]);
  });
  await audit(t.owner ?? "Devices", "windows.enroll", deviceId, { name, os: ctx.OSVersion ?? "", owner: t.owner });
  const doc64 = Buffer.from(provisioningDoc({
    caDer: forge.util.encode64(c.der), caThumbprint: c.thumbprint, certDer: identity.der, certThumbprint: identity.thumbprint,
    deviceId, management: windowsUrls().management, name: organization(),
  })).toString("base64");
  const now = new Date();
  return envelope(`${NS.wstep}/RSTRC/wstep`, messageId,
    `<RequestSecurityTokenResponseCollection xmlns="${NS.wst}"><RequestSecurityTokenResponse>` +
    `<TokenType>${TOKEN_TYPE}</TokenType><DispositionMessage xmlns="${NS.wstep}"/>` +
    `<RequestedSecurityToken><BinarySecurityToken ValueType="http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc" EncodingType="${B64}" xmlns="${NS.wsse}">${doc64}</BinarySecurityToken></RequestedSecurityToken>` +
    `<RequestID xmlns="${NS.wstep}">0</RequestID>` +
    `</RequestSecurityTokenResponse></RequestSecurityTokenResponseCollection>`,
    `<o:Security s:mustUnderstand="1" xmlns:o="${NS.wsse}"><u:Timestamp u:Id="_0"><u:Created>${now.toISOString()}</u:Created>` +
    `<u:Expires>${new Date(now.getTime() + 5 * 60_000).toISOString()}</u:Expires></u:Timestamp></o:Security>`);
}

/* ---------------------------------------------------------------- commands */

/** One OMA-DM command inside a Devices command. `ok`: answers that count as success besides 2xx. */
export type SubCommand = { verb: "Add" | "Replace" | "Delete" | "Exec" | "Get"; uri: string; format?: "int" | "chr" | "bool" | "xml" | "b64" | "null"; data?: string; ok?: number[] };

/** Queues a command for PCs; it goes out at each one's next check-in. */
export async function queue(ids: string[], type: string, label: string, subs: SubCommand[], actor: string, detail: Record<string, unknown> = {}): Promise<string> {
  if (!ids.length) return "";
  const uuid = randomUUID();
  await q(
    `INSERT INTO mdm_commands (uuid, enrollment_id, request_type, label, requested_by, detail, payload)
     SELECT $1, unnest($2::text[]), $3, $4, $5, $6, $7`,
    [uuid, ids, type, label, actor, JSON.stringify(detail), JSON.stringify(subs)],
  );
  return uuid;
}

const POLICY = "./Device/Vendor/MSFT/Policy/Config";
const int = (uri: string, v: number): SubCommand => ({ verb: "Replace", uri, format: "int", data: String(v) });

/** A WLAN profile for the WiFi CSP. */
function wlanXml(s: Settings): string {
  const ssid = String(s.ssid);
  const hex = Buffer.from(ssid, "utf8").toString("hex").toUpperCase();
  const open = s.security === "None";
  const auth = open ? "open" : s.security === "WPA3" ? "WPA3SAE" : "WPA2PSK";
  return `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">` +
    `<name>${esc(ssid)}</name><SSIDConfig><SSID><hex>${hex}</hex><name>${esc(ssid)}</name></SSID>${s.hidden ? "<nonBroadcast>true</nonBroadcast>" : ""}</SSIDConfig>` +
    `<connectionType>ESS</connectionType><connectionMode>${s.auto_join === false ? "manual" : "auto"}</connectionMode>` +
    `<MSM><security><authEncryption><authentication>${auth}</authentication><encryption>${open ? "none" : "AES"}</encryption><useOneX>false</useOneX></authEncryption>` +
    (open ? "" : `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${esc(String(s.password))}</keyMaterial></sharedKey>`) +
    `</security></MSM></WLANProfile>`;
}

const wifiNode = (s: Settings) => `./Vendor/MSFT/WiFi/Profile/${encodeURIComponent(String(s.ssid))}`;

/** The CSP settings for a settings profile; `remove` undoes them. Kinds Windows has no equivalent for give nothing. */
export function profileCommands(kind: string, s: Settings, remove = false): SubCommand[] {
  const del = (uri: string): SubCommand => ({ verb: "Delete", uri, ok: [404] });
  switch (kind) {
    case "passcode": {
      const base = `${POLICY}/DeviceLock`;
      const nodes: [string, number | undefined][] = [
        ["DevicePasswordEnabled", 0],
        ["MinDevicePasswordLength", s.min_length as number],
        // 0: a password or alphanumeric PIN; 2: anything.
        ["AlphanumericDevicePasswordRequired", s.require_alphanumeric ? 0 : 2],
        ["MaxInactivityTimeDeviceLock", s.max_inactivity_minutes as number],
        ["MaxDevicePasswordFailedAttempts", s.max_failed_attempts as number | undefined],
        ["DevicePasswordExpiration", s.max_age_days as number | undefined],
      ];
      return nodes.filter(([, v]) => v !== undefined).map(([n, v]) => (remove ? del(`${base}/${n}`) : int(`${base}/${n}`, v!)));
    }
    case "filevault":
      return [remove ? del("./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption") : int("./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption", 1)];
    case "firewall": {
      const out: SubCommand[] = [];
      for (const p of ["DomainProfile", "PrivateProfile", "PublicProfile"]) {
        const base = `./Vendor/MSFT/Firewall/MdmStore/${p}`;
        if (remove) {
          out.push(del(`${base}/EnableFirewall`), del(`${base}/Shielded`), del(`${base}/DisableStealthMode`));
        } else {
          out.push({ verb: "Replace", uri: `${base}/EnableFirewall`, format: "bool", data: "true" });
          out.push({ verb: "Replace", uri: `${base}/Shielded`, format: "bool", data: s.block_all_incoming ? "true" : "false" });
          out.push({ verb: "Replace", uri: `${base}/DisableStealthMode`, format: "bool", data: s.stealth ? "false" : "true" });
        }
      }
      return out;
    }
    case "software_update":
      // 2: install automatically and restart outside active hours; 0: only tell the person.
      return [remove ? del(`${POLICY}/Update/AllowAutoUpdate`) : int(`${POLICY}/Update/AllowAutoUpdate`, s.install_os_updates === false ? 0 : 2)];
    case "wifi":
      return remove
        ? [del(wifiNode(s))]
        : [del(wifiNode(s)), { verb: "Add", uri: `${wifiNode(s)}/WlanXml`, format: "chr", data: wlanXml(s) }];
    case "restrictions":
      return s.no_camera ? [remove ? del(`${POLICY}/Camera/AllowCamera`) : int(`${POLICY}/Camera/AllowCamera`, 0)] : [];
    default:
      return [];
  }
}

/** An MSI from a download address, checked against its SHA-256 (EnterpriseDesktopAppManagement CSP). */
export function msiCommands(a: { store_id: string; version: string; url: string; sha256: string }): SubCommand[] {
  const node = `./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/${encodeURIComponent(a.store_id)}/DownloadInstall`;
  const job = `<MsiInstallJob id="${esc(a.store_id)}"><Product Version="${esc(a.version)}"><Download><ContentURLList><ContentURL>${esc(a.url)}</ContentURL></ContentURLList></Download>` +
    `<Validation><FileHash>${a.sha256.toUpperCase()}</FileHash></Validation>` +
    `<Enforcement><CommandLine>/quiet</CommandLine><TimeOut>10</TimeOut><RetryCount>1</RetryCount><RetryInterval>5</RetryInterval></Enforcement></Product></MsiInstallJob>`;
  return [{ verb: "Add", uri: node, ok: [418] }, { verb: "Exec", uri: node, format: "xml", data: job }];
}

export const wipeCommand = (keepUserData: boolean): SubCommand[] => [
  { verb: "Exec", uri: `./Device/Vendor/MSFT/RemoteWipe/${keepUserData ? "doWipePersistUserData" : "doWipe"}`, format: "chr", data: "" },
];
export const restartCommand: SubCommand[] = [{ verb: "Exec", uri: "./Device/Vendor/MSFT/Reboot/RebootNow", format: "null", data: "" }];
export const unenrollCommand: SubCommand[] = [{ verb: "Exec", uri: "./Vendor/MSFT/DMClient/Unenroll", format: "chr", data: PROVIDER_ID }];

/* ---------------------------------------------------------------- check-ins (OMA-DM over SyncML) */

const INVENTORY: Record<string, string> = {
  "./DevDetail/SwV": "os_version",
  "./DevDetail/Ext/Microsoft/OSPlatform": "os_name",
  "./DevDetail/Ext/Microsoft/DeviceName": "hostname",
  "./DevInfo/Man": "vendor",
  "./DevInfo/Mod": "model",
  "./DevDetail/Ext/Microsoft/SMBIOSSerialNumber": "serial",
  "./DevDetail/Ext/Microsoft/TotalRAM": "ram_mb",
  "./Vendor/MSFT/DeviceStatus/Compliance/EncryptionCompliance": "encryption",
  "./Vendor/MSFT/DeviceStatus/Firewall/Status": "firewall",
  "./Vendor/MSFT/DeviceStatus/Antivirus/Status": "antivirus",
  "./Vendor/MSFT/DeviceStatus/TPM/SpecificationVersion": "tpm",
};

/** What a PC reports, as compliance facts. DeviceStatus CSP: firewall and antivirus 0 is "on and monitoring". */
export function windowsFacts(v: Record<string, string>): Facts {
  const out: Facts = {};
  if (v.encryption !== undefined) out.disk_encryption = v.encryption === "1";
  if (v.firewall !== undefined) out.firewall = v.firewall === "0";
  if (v.antivirus !== undefined && v.antivirus !== "4") out.antivirus = v.antivirus === "0";
  return out;
}

type Incoming = { sessionId: string; msgId: string; deviceId: string; target: string; commands: XmlNode[] };

function readSyncMl(xml: string): Incoming {
  const doc = parseXml(xml);
  if (doc.name !== "SyncML") throw new XmlError("Expected SyncML");
  const hdr = child(doc, "SyncHdr");
  return {
    sessionId: textAt(hdr, "SessionID"),
    msgId: textAt(hdr, "MsgID"),
    deviceId: textAt(hdr, "Source", "LocURI"),
    target: textAt(hdr, "Target", "LocURI"),
    commands: child(doc, "SyncBody")?.children.filter((c) => c.name !== "Final") ?? [],
  };
}

function writeCommand(cmdId: string, c: SubCommand): string {
  const meta = c.format ? `<Meta><Format xmlns="syncml:metinf">${c.format}</Format>${c.format === "xml" || c.format === "chr" ? `<Type xmlns="syncml:metinf">text/plain</Type>` : ""}</Meta>` : "";
  const data = c.verb === "Get" || c.verb === "Delete" ? "" : `<Data>${c.data === undefined ? "" : esc(c.data)}</Data>`;
  return `<${c.verb}><CmdID>${esc(cmdId)}</CmdID><Item><Target><LocURI>${esc(c.uri)}</LocURI></Target>${meta}${data}</Item></${c.verb}>`;
}

const okCode = (code: number, sub: SubCommand) => (code >= 200 && code < 300) || (sub.ok ?? []).includes(code);

/** Windows' result codes, in words. */
function codeText(code: number): string {
  const words: Record<number, string> = {
    400: "the command was malformed", 401: "the PC refused the server", 403: "not allowed on this PC", 404: "this edition of Windows doesn't have that setting",
    405: "that setting can't be changed this way", 406: "an optional feature isn't supported", 418: "it already exists", 425: "permission denied", 500: "it failed on the PC",
    507: "the whole batch failed", 516: "rolled back",
  };
  return `Windows answered ${code}${words[code] ? ` (${words[code]})` : ""}`;
}

type Pending = { uuid: string; payload: SubCommand[]; results: Record<string, number>; request_type: string; detail: Record<string, unknown> };

/**
 * One SyncML message from a PC and Devices' answer. `cert` is the base64 DER client certificate
 * the proxy passed on; the PC must present the one Devices issued it. Returns null for a request
 * that doesn't come from an enrolled PC.
 */
export async function checkIn(xml: string, cert: string): Promise<string | null> {
  let msg: Incoming;
  try {
    msg = readSyncMl(xml);
  } catch {
    return null;
  }
  const who = await certificateIdentity(cert);
  if (!who || who.deviceId !== msg.deviceId) return null;
  const [e] = await q<{ id: string; device_id: string | null; status: string; info: Record<string, unknown>; info_asked_at: Date | null; info_at: Date | null }>(
    `SELECT id, device_id, status, info, info_asked_at, info_at FROM mdm_enrollments WHERE id = $1 AND platform = 'windows'`,
    [msg.deviceId],
  );
  if (!e || e.info.cert_thumbprint !== who.thumbprint || e.status === "unenrolled") return null;

  await q(`UPDATE mdm_enrollments SET last_seen = now() WHERE id = $1`, [e.id]);
  if (e.device_id) await q(`UPDATE devices SET last_seen = greatest(last_seen, now()) WHERE id = $1`, [e.device_id]);
  if (e.status === "authenticated") {
    await q(`UPDATE mdm_enrollments SET status = 'enrolled', enrolled_at = now() WHERE id = $1`, [e.id]);
    await audit("Devices", "windows.enrolled", e.id, { device: e.device_id });
    await deployToEnrollment(e.id, "windows");
  }

  const statuses: string[] = [`<Status><CmdID>1</CmdID><MsgRef>${esc(msg.msgId)}</MsgRef><CmdRef>0</CmdRef><Cmd>SyncHdr</Cmd><Data>200</Data></Status>`];
  let n = 1;
  const inventory: Record<string, string> = {};
  const codes = new Map<string, Map<number, number>>();
  let leaving = false;
  for (const c of msg.commands) {
    if (c.name === "Status") {
      const ref = textAt(c, "CmdRef");
      const code = Number(textAt(c, "Data"));
      const m = /^([0-9a-f-]{36})\.(\d+)$/i.exec(ref);
      if (m && Number.isFinite(code)) {
        if (!codes.has(m[1])) codes.set(m[1], new Map());
        codes.get(m[1])!.set(Number(m[2]), code);
      }
      continue;
    }
    statuses.push(`<Status><CmdID>${++n}</CmdID><MsgRef>${esc(msg.msgId)}</MsgRef><CmdRef>${esc(textAt(c, "CmdID"))}</CmdRef><Cmd>${c.name}</Cmd><Data>200</Data></Status>`);
    for (const item of children(c, "Item")) {
      const uri = textAt(item, "Source", "LocURI");
      if ((c.name === "Results" || c.name === "Replace") && INVENTORY[uri]) inventory[INVENTORY[uri]] = textAt(item, "Data");
      if (c.name === "Alert" && textAt(item, "Meta", "Type") === "com.microsoft:mdm.unenrollment.userrequest") leaving = true;
    }
  }

  if (codes.size) await settle(e.id, codes);
  if (Object.keys(inventory).length) await saveInventory(e.id, e.device_id, inventory);
  if (leaving) {
    await left(e.id, e.device_id, "The person removed management from the PC");
    return response(msg, statuses, []);
  }

  // What to send: inventory now and then, and commands not yet answered.
  const out: string[] = [];
  const due = !e.info_at || Date.now() - new Date(e.info_at).getTime() > 4 * 3600_000;
  const askedRecently = e.info_asked_at && Date.now() - new Date(e.info_asked_at).getTime() < 10 * 60_000;
  if (due && !askedRecently) {
    Object.keys(INVENTORY).forEach((uri, i) => out.push(writeCommand(`info.${i}`, { verb: "Get", uri })));
    await q(`UPDATE mdm_enrollments SET info_asked_at = now() WHERE id = $1`, [e.id]);
  }
  // A command goes out once per session; it's sent again only if a later check-in still lacks its answer.
  const pending = await q<Pending>(
    `UPDATE mdm_commands SET sent_at = now(), detail = detail || jsonb_build_object('session', $2::text)
     WHERE enrollment_id = $1 AND status = 'queued' AND payload IS NOT NULL AND (detail->>'session' IS DISTINCT FROM $2::text)
       AND uuid IN (SELECT uuid FROM mdm_commands WHERE enrollment_id = $1 AND status = 'queued' AND payload IS NOT NULL ORDER BY created_at LIMIT 20)
     RETURNING uuid, payload, results, request_type, detail`,
    [e.id, msg.sessionId],
  );
  for (const p of pending.sort((a, b) => a.uuid.localeCompare(b.uuid))) {
    p.payload.forEach((sub, i) => {
      if (p.results?.[i] === undefined) out.push(writeCommand(`${p.uuid}.${i}`, sub));
    });
  }
  return response(msg, statuses, out);
}

function response(msg: Incoming, statuses: string[], commands: string[]): string {
  return `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto>` +
    `<SessionID>${esc(msg.sessionId)}</SessionID><MsgID>${esc(msg.msgId)}</MsgID>` +
    `<Target><LocURI>${esc(msg.deviceId)}</LocURI></Target><Source><LocURI>${esc(msg.target || windowsUrls().management)}</LocURI></Source></SyncHdr>` +
    `<SyncBody>${statuses.join("")}${commands.join("")}<Final/></SyncBody></SyncML>`;
}

/** Records the answers to Devices' commands; a command is done when all its parts are answered. */
async function settle(enrollmentId: string, codes: Map<string, Map<number, number>>): Promise<void> {
  for (const [uuid, parts] of codes) {
    const [c] = await q<Pending>(
      `UPDATE mdm_commands SET results = COALESCE(results, '{}') || $3, updated_at = now() WHERE uuid = $1 AND enrollment_id = $2 AND status = 'queued'
       RETURNING uuid, payload, results, request_type, detail`,
      [uuid, enrollmentId, JSON.stringify(Object.fromEntries(parts))],
    );
    if (!c?.payload) continue;
    const failed = c.payload.findIndex((sub, i) => c.results[i] !== undefined && !okCode(c.results[i], sub));
    const done = c.payload.every((_, i) => c.results[i] !== undefined);
    if (failed < 0 && !done) continue;
    const error = failed >= 0 ? text(`${codeText(c.results[failed])}: ${c.payload[failed].uri}`, 1000) : null;
    await q(`UPDATE mdm_commands SET status = $3, error = $4, updated_at = now() WHERE uuid = $1 AND enrollment_id = $2`,
      [uuid, enrollmentId, error ? "error" : "acknowledged", error]);
    const profileId = c.detail.profile_id as string | undefined;
    if (profileId) {
      if (c.request_type === "RemoveProfile") {
        await q(`DELETE FROM mdm_profile_status WHERE enrollment_id = $1 AND profile_id = $2 AND command_uuid = $3`, [enrollmentId, profileId, uuid]);
      } else {
        await q(`UPDATE mdm_profile_status SET status = $4, error = $5, updated_at = now() WHERE enrollment_id = $1 AND profile_id = $2 AND command_uuid = $3`,
          [enrollmentId, profileId, uuid, error ? "error" : "installed", error]);
      }
    }
    if (!error && c.request_type === "Wipe") await left(enrollmentId, null, "The PC was reset");
    if (!error && c.request_type === "Unenroll") await left(enrollmentId, null, "Management was removed");
  }
}

/** The PC's details. A PC that also runs osquery is one device: the MDM-only row joins it, matched by serial number. */
async function saveInventory(enrollmentId: string, deviceId: string | null, v: Record<string, string>): Promise<void> {
  const facts = windowsFacts(v);
  const info = { ...v, tpm: v.tpm ?? null };
  await q(`UPDATE mdm_enrollments SET info = info || $2, info_at = now(), serial = COALESCE(NULLIF($3, ''), serial), model = COALESCE(NULLIF($4, ''), model) WHERE id = $1`,
    [enrollmentId, JSON.stringify(info), text(v.serial, 100), text(v.model, 100)]);
  if (!deviceId) return;
  let id = deviceId;
  const serial = text(v.serial, 100);
  if (serial && !/^(0|none|default string|to be filled by o\.e\.m\.|system serial number)$/i.test(serial)) {
    const [other] = await q<{ id: string }>(
      `SELECT id FROM devices WHERE hardware_serial = $1 AND platform = 'windows' AND id <> $2 AND retired_at IS NULL AND host_identifier NOT LIKE 'wmdm:%'
       ORDER BY last_seen DESC LIMIT 1`,
      [serial, deviceId],
    );
    const [mine] = await q<{ host_identifier: string; owner: string | null }>(`SELECT host_identifier, owner FROM devices WHERE id = $1`, [deviceId]);
    if (other && mine?.host_identifier.startsWith("wmdm:")) {
      await tx(async (tq) => {
        await tq(`UPDATE mdm_enrollments SET device_id = $2 WHERE device_id = $1`, [deviceId, other.id]);
        await tq(`UPDATE devices SET owner = COALESCE(owner, $2) WHERE id = $1`, [other.id, mine.owner]);
        await tq(`DELETE FROM devices WHERE id = $1`, [deviceId]);
      });
      id = other.id;
    }
  }
  await q(
    `UPDATE devices SET hostname = COALESCE(NULLIF($2, ''), hostname),
       os_name = CASE WHEN host_identifier LIKE 'wmdm:%' THEN COALESCE(NULLIF($3, ''), os_name) ELSE os_name END,
       os_version = CASE WHEN host_identifier LIKE 'wmdm:%' THEN COALESCE(NULLIF($4, ''), os_version) ELSE os_version END,
       hardware_vendor = CASE WHEN hardware_vendor = '' THEN $5 ELSE hardware_vendor END,
       hardware_model = CASE WHEN hardware_model = '' THEN $6 ELSE hardware_model END,
       hardware_serial = CASE WHEN hardware_serial = '' THEN $7 ELSE hardware_serial END,
       memory_bytes = COALESCE(memory_bytes, $8), facts = facts || $9, facts_at = now()
     WHERE id = $1`,
    [id, text(v.hostname, 300), text(v.os_name, 200), text(v.os_version, 50), text(v.vendor, 200), text(v.model, 200), serial,
      Number(v.ram_mb) > 0 ? Number(v.ram_mb) * 1024 * 1024 : null, JSON.stringify(facts)],
  );
  await recompute([id]);
}

/** The PC left management. A PC with nothing but MDM leaves Devices' lists; one with osquery keeps reporting. */
async function left(enrollmentId: string, deviceId: string | null, why: string): Promise<void> {
  const [e] = await q<{ device_id: string | null }>(
    `UPDATE mdm_enrollments SET status = 'unenrolled', unenrolled_at = now() WHERE id = $1 RETURNING device_id`,
    [enrollmentId],
  );
  await q(`UPDATE mdm_commands SET status = 'error', error = $2, updated_at = now() WHERE enrollment_id = $1 AND status = 'queued'`, [enrollmentId, why]);
  await q(`DELETE FROM mdm_profile_status WHERE enrollment_id = $1`, [enrollmentId]);
  const id = deviceId ?? e?.device_id;
  if (id) await q(`UPDATE devices SET retired_at = now(), retired_by = 'Devices' WHERE id = $1 AND host_identifier LIKE 'wmdm:%' AND retired_at IS NULL`, [id]);
  await audit("Devices", "windows.unenrolled", enrollmentId, { why });
}

/* ---------------------------------------------------------------- what admins and people see */

export async function windowsStatus() {
  const [counts] = await q<{ enrolled: number; pending: number }>(
    `SELECT count(*) FILTER (WHERE status = 'enrolled')::int AS enrolled, count(*) FILTER (WHERE status = 'authenticated')::int AS pending
     FROM mdm_enrollments WHERE platform = 'windows'`,
  );
  const u = windowsUrls();
  return { ready: windowsEnabled(), management: u.management, discovery: u.discovery, ...counts };
}

/** Hash of an MSI for the install job: Windows checks the download against it. */
export async function fileHash(url: string, fetcher: typeof fetch = fetch): Promise<{ sha256: string; size: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UserError("Enter the installer's download address (https://…)");
  }
  if (parsed.protocol !== "https:") throw new UserError("The installer must be downloadable over https");
  const res = await fetcher(url, { signal: AbortSignal.timeout(30 * 60_000) }).catch(() => null);
  if (!res || !res.ok || !res.body) throw new UserError(`Devices couldn't download ${url}${res ? ` (${res.status})` : ""}`);
  const h = createHash("sha256");
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8 * 1024 ** 3) throw new UserError("That installer is larger than 8 GB");
    h.update(value);
  }
  if (!size) throw new UserError("That download is empty");
  return { sha256: h.digest("hex"), size };
}

/** "{12345678-1234-1234-1234-123456789ABC}" (an MSI's ProductCode), with or without braces. */
export function productCode(v: unknown): string {
  const m = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i.exec(String(v ?? "").trim());
  if (!m) throw new UserError("Enter the installer's product code, like {12345678-1234-1234-1234-123456789ABC} (Orca or msiinfo shows it)");
  return `{${m[1].toUpperCase()}}`;
}

/* ---------------------------------------------------------------- HTTP */

const SOAP = "application/soap+xml; charset=utf-8";

async function readBody(req: Request, max = 1_000_000): Promise<string> {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > max) throw new EnrollError("MessageFormat", "The request is too large");
  return buf.toString("utf8");
}

/** An enrollment endpoint: SOAP in, SOAP out, and a SOAP fault Windows can show when something's wrong. */
export function soapRoute(fn: (xml: string) => Promise<string> | string) {
  return async (req: Request): Promise<Response> => {
    if (!windowsEnabled()) return new Response("Windows device management is off", { status: 404 });
    let relates = "";
    try {
      const xml = await readBody(req);
      relates = /<(?:\w+:)?MessageID[^>]*>([^<]*)</.exec(xml)?.[1] ?? "";
      return new Response(await fn(xml), { headers: { "content-type": SOAP } });
    } catch (err) {
      const e = err instanceof EnrollError ? err : new EnrollError("EnrollmentServer", "Enrollment failed on the server; try again");
      if (!(err instanceof EnrollError)) console.error("[devices] windows enrollment", err);
      return new Response(soapFault(e, relates), { status: 500, headers: { "content-type": SOAP } });
    }
  };
}

/** The check-in endpoint, behind the proxy that checks the PC's certificate and passes it on. */
export async function managementRoute(req: Request): Promise<Response> {
  if (!windowsEnabled()) return new Response(null, { status: 404 });
  // The certificate header is believed only from the proxy.
  if (!cameThroughGateway(req.headers, process.env.PROXY_SHARED_SECRET)) return new Response(null, { status: 401 });
  try {
    const out = await checkIn(await readBody(req, 4_000_000), req.headers.get("x-client-cert") ?? "");
    if (!out) return new Response(null, { status: 401 });
    return new Response(out, { headers: { "content-type": "application/vnd.syncml.dm+xml" } });
  } catch (err) {
    console.error("[devices] windows check-in", err);
    return new Response(null, { status: 500 });
  }
}
