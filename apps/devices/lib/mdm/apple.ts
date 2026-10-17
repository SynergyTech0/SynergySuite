import { randomInt } from "node:crypto";
import type { Me } from "../api";
import { audit, q, tx } from "../db";
import { serverHost } from "../enroll";
import type { Facts } from "../rules";
import { recompute } from "../state";
import { UserError, secret, sha256, text, uuid } from "../util";
import { deployToEnrollment } from "./catalog";
import { MdmUnavailable, type PushCert, enqueue, mdmConfig, uploadPushCert } from "./nanomdm";
import { type PlistValue, PlistError, boolOrNull, dict, num, parsePlist, str } from "./plist";
import { type ApplePlatform, MDM_PROFILE_ID, enrollmentProfile } from "./profiles";

/**
 * Apple device management: enrollment of iPhones, iPads and Macs, what they report, and the
 * commands people send them (lock, erase, restart, install a profile or an app).
 *
 * A Mac can be in Devices twice over: osquery reports its posture, MDM lets admins act on it.
 * Both land on one device row, matched by serial number. An iPhone or iPad only has MDM, and gets
 * a device row of its own (host_identifier "mdm:<enrollment id>").
 */

export const organization = (env: NodeJS.ProcessEnv = process.env) => env.DEVICES_ORG_NAME?.trim() || "Synergy";

/* ---------------------------------------------------------------- settings and status */

async function setting<T>(key: string): Promise<T | null> {
  const [r] = await q<{ value: T }>(`SELECT value FROM mdm_settings WHERE key = $1`, [key]);
  return r?.value ?? null;
}

export async function appleStatus() {
  const cfg = mdmConfig();
  const push = await setting<PushCert & { uploaded_by: string; uploaded_at: string }>("apple_push");
  const [counts] = await q<{ enrolled: number; pending: number; unenrolled: number }>(
    `SELECT count(*) FILTER (WHERE status = 'enrolled')::int AS enrolled, count(*) FILTER (WHERE status = 'authenticated')::int AS pending,
       count(*) FILTER (WHERE status = 'unenrolled')::int AS unenrolled FROM mdm_enrollments`,
  );
  const expires = push ? new Date(push.expires_at) : null;
  return {
    configured: !!cfg,
    push,
    push_expires_in_days: expires ? Math.floor((expires.getTime() - Date.now()) / 86_400_000) : null,
    ready: !!cfg && !!push && !!expires && expires > new Date(),
    server: `https://${serverHost()}`,
    ...counts,
  };
}

export async function setPushCert(me: Me, pem: string): Promise<PushCert> {
  if (!mdmConfig()) throw new MdmUnavailable();
  const previous = await setting<PushCert>("apple_push");
  const cert = await uploadPushCert(pem);
  // A renewal keeps the topic. A different one orphans every enrolled device: they'd need re-enrolling.
  if (previous && previous.topic !== cert.topic) {
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM mdm_enrollments WHERE status = 'enrolled'`);
    if (n > 0) {
      throw new UserError(`That certificate is for a different topic (${cert.topic}) than the one ${n} devices are enrolled with (${previous.topic}). Renew the existing certificate at identity.apple.com instead of making a new one.`, 409);
    }
  }
  await q(
    `INSERT INTO mdm_settings (key, value, updated_by) VALUES ('apple_push', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`,
    [JSON.stringify({ ...cert, uploaded_by: me.email, uploaded_at: new Date().toISOString() }), me.email],
  );
  await audit(me.email, "mdm.push_cert", cert.topic, { expires_at: cert.expires_at, renewed: !!previous });
  return cert;
}

/* ---------------------------------------------------------------- enrollment */

/**
 * An enrollment profile for the signed-in person (their device becomes theirs), or for the
 * organization (admins; the device starts without an owner). Each download has its own token.
 */
export async function enrollmentFor(me: Me, org: boolean): Promise<{ filename: string; xml: string }> {
  if (org && me.role !== "admin") throw new UserError("Only device admins can make organization profiles", 403);
  const cfg = mdmConfig();
  if (!cfg) throw new MdmUnavailable();
  const push = await setting<PushCert>("apple_push");
  if (!push) throw new UserError("Apple device management needs its push certificate first (Devices › Apple devices)", 409);
  const token = secret(24);
  await q(`INSERT INTO mdm_enroll_tokens (token_hash, owner, created_by) VALUES ($1, $2, $3)`, [sha256(token), org ? null : me.email, me.email]);
  await audit(me.email, "mdm.profile_download", "", { organization: org });
  const xml = enrollmentProfile({
    base: `https://${serverHost()}`,
    topic: push.topic,
    challenge: cfg.challenge,
    token,
    organization: organization(),
    caPem: process.env.DEVICES_TLS_CA || undefined,
  });
  return { filename: org ? "organization-enrollment.mobileconfig" : "enroll.mobileconfig", xml };
}

/** iPhone, iPad, iPod and Apple TV report through MDM only; anything else Apple makes is a Mac. */
export function applePlatform(model: string, product: string): ApplePlatform {
  return /^(iPhone|iPad|iPod|AppleTV)/i.test(product) || /^(iPhone|iPad|iPod|Apple\s?TV)/i.test(model) ? "ios" : "darwin";
}

function osName(platform: ApplePlatform, product: string): string {
  if (platform === "darwin") return "macOS";
  return /^iPad/i.test(product) ? "iPadOS" : "iOS";
}

/* ---------------------------------------------------------------- webhook */

export type WebhookEvent = {
  topic?: string;
  created_at?: string;
  checkin_event?: { ids?: { id?: string; type?: string; parent_id?: string }; udid?: string; raw_payload?: string; url_params?: Record<string, string>; token_update_tally?: number };
  acknowledge_event?: { ids?: { id?: string; type?: string }; udid?: string; status?: string; command_uuid?: string; raw_payload?: string; url_params?: Record<string, string> };
};

type Enrollment = { id: string; device_id: string | null; platform: ApplePlatform; status: string; enrolled_at: Date | null };

const DEVICE_CHANNELS = new Set(["Device", "User Enrollment (Device)"]);

function payloadOf(b64: string | undefined): Record<string, PlistValue> {
  if (!b64) return {};
  try {
    return dict(parsePlist(Buffer.from(b64, "base64")));
  } catch (e) {
    if (e instanceof PlistError) return {};
    throw e;
  }
}

/** Handles one NanoMDM webhook event. Unknown and user-channel events are ignored. */
export async function handleWebhook(ev: WebhookEvent): Promise<void> {
  const topic = ev.topic ?? "";
  if (ev.checkin_event) {
    const c = ev.checkin_event;
    const id = c.ids?.id;
    if (!id || !DEVICE_CHANNELS.has(c.ids?.type ?? "Device")) return;
    const p = payloadOf(c.raw_payload);
    if (topic === "mdm.Authenticate") await authenticated(id, c.ids?.type ?? "Device", p, c.url_params ?? {});
    else if (topic === "mdm.TokenUpdate") await tokenUpdated(id, p, c.url_params ?? {});
    else if (topic === "mdm.CheckOut") await checkedOut(id);
    return;
  }
  if (ev.acknowledge_event && topic === "mdm.Connect") {
    const a = ev.acknowledge_event;
    const id = a.ids?.id;
    if (!id || !DEVICE_CHANNELS.has(a.ids?.type ?? "Device")) return;
    await seen(id);
    if (a.command_uuid && a.status && a.status !== "Idle") await commandResult(id, a.command_uuid, a.status, payloadOf(a.raw_payload));
    else await refreshDue([id]);
  }
}

async function seen(id: string): Promise<void> {
  const [e] = await q<{ device_id: string | null }>(`UPDATE mdm_enrollments SET last_seen = now() WHERE id = $1 RETURNING device_id`, [id]);
  if (e?.device_id) await q(`UPDATE devices SET last_seen = greatest(last_seen, now()) WHERE id = $1`, [e.device_id]);
}

async function tokenOwner(params: Record<string, string>): Promise<{ id: string; owner: string | null } | null> {
  const token = params.enroll;
  if (!token) return null;
  const [t] = await q<{ id: string; owner: string | null }>(
    `UPDATE mdm_enroll_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING id, owner`,
    [sha256(token)],
  );
  return t ?? null;
}

/**
 * Authenticate: a device is installing the enrollment profile. It gets an enrollment row and a
 * device row: the Mac osquery already reports (same serial number), or a new one.
 */
async function authenticated(id: string, type: string, p: Record<string, PlistValue>, params: Record<string, string>): Promise<void> {
  const serial = text(str(p.SerialNumber), 100);
  const model = text(str(p.Model), 100);
  const product = text(str(p.ProductName), 100);
  const platform = applePlatform(model, product);
  const t = await tokenOwner(params);
  await tx(async (tq) => {
    const [existing] = await tq<{ device_id: string | null }>(`SELECT device_id FROM mdm_enrollments WHERE id = $1 FOR UPDATE`, [id]);
    let deviceId = existing?.device_id ?? null;
    if (!deviceId && serial) {
      const [d] = await tq<{ id: string }>(
        `SELECT id FROM devices WHERE hardware_serial = $1 AND retired_at IS NULL ORDER BY (host_identifier LIKE 'mdm:%'), last_seen DESC LIMIT 1`,
        [serial],
      );
      deviceId = d?.id ?? null;
    }
    const cols = [
      text(str(p.DeviceName), 300) || product || "Apple device", platform, osName(platform, product),
      text(str(p.OSVersion), 50), product || model, serial, t?.owner ?? null,
    ];
    if (deviceId) {
      // Fill in what osquery hasn't; an owner already set stays (someone else's profile can't claim it).
      await tq(
        `UPDATE devices SET hostname = CASE WHEN hostname = '' THEN $2 ELSE hostname END,
           os_name = CASE WHEN os_name = '' THEN $4 ELSE os_name END, os_version = CASE WHEN os_version = '' THEN $5 ELSE os_version END,
           hardware_vendor = CASE WHEN hardware_vendor = '' THEN 'Apple' ELSE hardware_vendor END,
           hardware_model = CASE WHEN hardware_model = '' THEN $6 ELSE hardware_model END,
           hardware_serial = CASE WHEN hardware_serial = '' THEN $7 ELSE hardware_serial END,
           platform = CASE WHEN platform = '' THEN $3 ELSE platform END,
           owner = COALESCE(owner, $8), last_seen = now(), retired_at = NULL, retired_by = NULL
         WHERE id = $1`,
        [deviceId, ...cols],
      );
    } else {
      const [d] = await tq<{ id: string }>(
        `INSERT INTO devices (host_identifier, hostname, platform, os_name, os_version, hardware_vendor, hardware_model, hardware_serial, owner)
         VALUES ($1, $2, $3, $4, $5, 'Apple', $6, $7, $8)
         ON CONFLICT (host_identifier) DO UPDATE SET hostname = $2, os_version = $5, owner = COALESCE(devices.owner, $8),
           last_seen = now(), retired_at = NULL, retired_by = NULL, enrolled_at = CASE WHEN devices.retired_at IS NOT NULL THEN now() ELSE devices.enrolled_at END
         RETURNING id`,
        [`mdm:${id}`, ...cols],
      );
      deviceId = d.id;
    }
    await tq(
      `INSERT INTO mdm_enrollments (id, device_id, enrollment_type, token_id, serial, model, product, platform, status, authenticated_at, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'authenticated', now(), now())
       ON CONFLICT (id) DO UPDATE SET device_id = $2, enrollment_type = $3, token_id = COALESCE($4, mdm_enrollments.token_id),
         serial = $5, model = $6, product = $7, platform = $8, status = 'authenticated', authenticated_at = now(),
         enrolled_at = NULL, unenrolled_at = NULL, last_seen = now()`,
      [id, deviceId, type, t?.id ?? null, serial, model, product, platform],
    );
  });
  await audit("Devices", "mdm.authenticate", id, { serial, product, owner: t?.owner ?? null });
}

/**
 * TokenUpdate: the device can now be reached by push. The first one after Authenticate completes
 * enrollment: Devices asks for the device's details and sends the profiles and apps meant for it.
 */
async function tokenUpdated(id: string, _p: Record<string, PlistValue>, params: Record<string, string>): Promise<void> {
  // The subquery reads the row as it was before this update, so `was` says whether this completes enrollment.
  const [e] = await q<Enrollment & { was: string }>(
    `UPDATE mdm_enrollments e SET status = 'enrolled', enrolled_at = COALESCE(e.enrolled_at, now()), last_seen = now()
     FROM (SELECT status FROM mdm_enrollments WHERE id = $1 FOR UPDATE) old
     WHERE e.id = $1 RETURNING e.id, e.device_id, e.platform, e.status, e.enrolled_at, old.status AS was`,
    [id],
  );
  if (!e || e.was === "enrolled") return;
  await audit("Devices", "mdm.enrolled", id, { device: e.device_id, via: params.enroll ? "profile" : "unknown" });
  await askForInfo([id], "Devices");
  await deployToEnrollment(e.id, e.platform);
}

async function checkedOut(id: string): Promise<void> {
  const [e] = await q<{ device_id: string | null }>(
    `UPDATE mdm_enrollments SET status = 'unenrolled', unenrolled_at = now() WHERE id = $1 RETURNING device_id`,
    [id],
  );
  await q(`UPDATE mdm_commands SET status = 'error', error = 'The device left management', updated_at = now() WHERE enrollment_id = $1 AND status IN ('queued', 'notnow')`, [id]);
  await q(`DELETE FROM mdm_profile_status WHERE enrollment_id = $1`, [id]);
  // A phone or tablet with nothing but MDM is gone from Devices' view; a Mac keeps reporting through osquery.
  if (e?.device_id) await q(`UPDATE devices SET retired_at = now(), retired_by = 'Devices' WHERE id = $1 AND host_identifier LIKE 'mdm:%' AND retired_at IS NULL`, [e.device_id]);
  await audit("Devices", "mdm.checkout", id, { device: e?.device_id ?? null });
}

/* ---------------------------------------------------------------- what devices report */

const INFO_QUERIES = [
  "DeviceName", "OSVersion", "BuildVersion", "ModelName", "Model", "ProductName", "SerialNumber", "DeviceCapacity",
  "AvailableDeviceCapacity", "BatteryLevel", "IMEI", "MEID", "PhoneNumber", "WiFiMAC", "IsSupervised",
  "IsActivationLockEnabled", "IsCloudBackupEnabled", "LastCloudBackupDate", "IsDeviceLocatorServiceEnabled",
];

/** Asks for device information, security settings and installed apps. */
export async function askForInfo(ids: string[], actor: string): Promise<void> {
  if (!ids.length) return;
  await send(ids, { RequestType: "DeviceInformation", Queries: INFO_QUERIES }, "Get device details", actor);
  await send(ids, { RequestType: "SecurityInfo" }, "Get security settings", actor);
  await send(ids, { RequestType: "InstalledApplicationList" }, "Get installed apps", actor);
  await q(`UPDATE mdm_enrollments SET info_asked_at = now() WHERE id = ANY($1)`, [ids]);
}

let lastSweep = 0;
/**
 * Details older than a day are asked for again. Runs at most every 15 minutes, from list and
 * overview requests and device check-ins (Devices has no scheduler of its own).
 */
export async function refreshDue(only?: string[]): Promise<void> {
  if (!mdmConfig()) return;
  if (!only && Date.now() - lastSweep < 15 * 60_000) return;
  if (!only) lastSweep = Date.now();
  const rows = await q<{ id: string }>(
    `SELECT id FROM mdm_enrollments WHERE status = 'enrolled' AND (info_asked_at IS NULL OR info_asked_at < now() - interval '1 day')
       AND ($1::text[] IS NULL OR id = ANY($1)) LIMIT 200`,
    [only ?? null],
  );
  if (rows.length) await askForInfo(rows.map((r) => r.id), "Devices").catch((e) => console.error("[devices] mdm refresh", e));
}

async function commandResult(enrollmentId: string, commandUuid: string, status: string, p: Record<string, PlistValue>): Promise<void> {
  const mapped = status === "Acknowledged" ? "acknowledged" : status === "NotNow" ? "notnow" : "error";
  const chain = Array.isArray(p.ErrorChain) ? (p.ErrorChain as PlistValue[]).map((x) => str(dict(x).LocalizedDescription) || str(dict(x).USEnglishDescription)).filter(Boolean) : [];
  const error = mapped === "error" ? text(chain.join(" ") || `The device answered ${status}`, 1000) : null;
  const [cmd] = await q<{ request_type: string; detail: Record<string, unknown> }>(
    `UPDATE mdm_commands SET status = $3, error = $4, updated_at = now() WHERE uuid = $1 AND enrollment_id = $2 RETURNING request_type, detail`,
    [commandUuid, enrollmentId, mapped, error],
  );
  if (!cmd || mapped !== "acknowledged") {
    if (cmd && mapped === "error") await profileOutcome(enrollmentId, cmd, "error", error);
    return;
  }
  switch (cmd.request_type) {
    case "DeviceInformation":
      await deviceInformation(enrollmentId, dict(p.QueryResponses));
      break;
    case "SecurityInfo":
      await securityInfo(enrollmentId, dict(p.SecurityInfo));
      break;
    case "InstalledApplicationList":
      await installedApps(enrollmentId, Array.isArray(p.InstalledApplicationList) ? (p.InstalledApplicationList as PlistValue[]) : []);
      break;
    case "InstallProfile":
    case "RemoveProfile":
      await profileOutcome(enrollmentId, cmd, "ok", null);
      break;
  }
}

async function profileOutcome(enrollmentId: string, cmd: { request_type: string; detail: Record<string, unknown> }, outcome: "ok" | "error", error: string | null): Promise<void> {
  const profileId = typeof cmd.detail.profile_id === "string" ? cmd.detail.profile_id : null;
  if (!profileId) return;
  if (cmd.request_type === "InstallProfile") {
    await q(
      `UPDATE mdm_profile_status SET status = $3, error = $4, updated_at = now() WHERE enrollment_id = $1 AND profile_id = $2 AND version = $5`,
      [enrollmentId, profileId, outcome === "ok" ? "installed" : "error", error, Number(cmd.detail.version) || 0],
    );
  } else if (cmd.request_type === "RemoveProfile" && outcome === "ok") {
    await q(`DELETE FROM mdm_profile_status WHERE enrollment_id = $1 AND profile_id = $2 AND status = 'removing'`, [enrollmentId, profileId]);
  }
}

async function enrollmentDevice(id: string): Promise<{ device_id: string; platform: ApplePlatform; mdm_only: boolean; product: string } | null> {
  const [r] = await q<{ device_id: string; platform: ApplePlatform; mdm_only: boolean; product: string }>(
    `SELECT e.device_id, e.platform, d.host_identifier LIKE 'mdm:%' AS mdm_only, e.product FROM mdm_enrollments e JOIN devices d ON d.id = e.device_id WHERE e.id = $1`,
    [id],
  );
  return r ?? null;
}

/** Device details. For a device MDM alone reports, they are its inventory. */
async function deviceInformation(id: string, r: Record<string, PlistValue>): Promise<void> {
  const info: Record<string, unknown> = {};
  for (const k of INFO_QUERIES) {
    const v = r[k];
    if (v === undefined) continue;
    info[k] = v instanceof Date ? v.toISOString() : Buffer.isBuffer(v) ? undefined : v;
  }
  await q(`UPDATE mdm_enrollments SET info = info || $2::jsonb, info_at = now() WHERE id = $1`, [id, JSON.stringify(info)]);
  const d = await enrollmentDevice(id);
  if (!d) return;
  const product = str(r.ProductName) || d.product;
  if (d.mdm_only) {
    await q(
      `UPDATE devices SET hostname = COALESCE(NULLIF($2, ''), hostname), os_name = $3, os_version = COALESCE(NULLIF($4, ''), os_version),
         hardware_model = COALESCE(NULLIF($5, ''), hardware_model), hardware_serial = COALESCE(NULLIF($6, ''), hardware_serial), facts_at = now()
       WHERE id = $1`,
      [d.device_id, text(str(r.DeviceName), 300), osName(d.platform, product), text(str(r.OSVersion), 50), text(str(r.ModelName) || product, 200), text(str(r.SerialNumber), 100)],
    );
    await recompute([d.device_id]);
  }
}

/** Security settings become the device's compliance facts. */
export function securityFacts(platform: ApplePlatform, s: Record<string, PlistValue>): Facts {
  if (platform === "ios") {
    const passcode = boolOrNull(s.PasscodePresent);
    const caps = num(s.HardwareEncryptionCaps);
    // Data protection needs both the hardware (block or file level) and a passcode to protect the keys.
    return {
      screen_lock: passcode,
      disk_encryption: passcode === null || caps === null ? null : passcode && (caps & 3) > 0,
    };
  }
  const fw = dict(s.FirewallSettings);
  return {
    disk_encryption: boolOrNull(s.FDE_Enabled),
    firewall: boolOrNull(fw.FirewallEnabled),
    system_protection: boolOrNull(s.SystemIntegrityProtectionEnabled),
  };
}

async function securityInfo(id: string, s: Record<string, PlistValue>): Promise<void> {
  const d = await enrollmentDevice(id);
  if (!d) return;
  const facts = Object.fromEntries(Object.entries(securityFacts(d.platform, s)).filter(([, v]) => v !== null && v !== undefined));
  await q(`UPDATE mdm_enrollments SET info = info || jsonb_build_object('security', $2::jsonb) WHERE id = $1`, [id, JSON.stringify({ ...facts, passcode_compliant: boolOrNull(s.PasscodeCompliant) })]);
  if (!Object.keys(facts).length) return;
  // osquery is the source for a Mac it reports on; MDM fills in only what it hasn't said.
  await q(
    d.mdm_only
      ? `UPDATE devices SET facts = facts || $2::jsonb, facts_at = now() WHERE id = $1`
      : `UPDATE devices SET facts = $2::jsonb || facts WHERE id = $1`,
    [d.device_id, JSON.stringify(facts)],
  );
  await recompute([d.device_id]);
}

async function installedApps(id: string, list: PlistValue[]): Promise<void> {
  const d = await enrollmentDevice(id);
  if (!d || !d.mdm_only) return; // osquery inventories a Mac's apps itself
  const rows = list.map((x) => dict(x)).map((a) => ({
    name: text(str(a.Name) || str(a.Identifier), 300),
    version: text(str(a.ShortVersion) || str(a.Version), 100),
    package: text(str(a.Identifier), 300),
  })).filter((a) => a.name).slice(0, 5000);
  await tx(async (tq) => {
    await tq(`DELETE FROM software WHERE device_id = $1 AND source = 'mdm'`, [d.device_id]);
    if (rows.length) {
      await tq(
        `INSERT INTO software (device_id, name, version, source, package)
         SELECT $1, x.name, x.version, 'mdm', x.package FROM jsonb_to_recordset($2::jsonb) AS x(name text, version text, package text)
         ON CONFLICT DO NOTHING`,
        [d.device_id, JSON.stringify(rows)],
      );
    }
  });
}

/* ---------------------------------------------------------------- commands */

/** Queues a command and records it. Push failures are kept on the command so the screen can say why. */
export async function send(ids: string[], command: Record<string, PlistValue | undefined>, label: string, actor: string, detail: Record<string, unknown> = {}): Promise<string> {
  const { uuid: cmdUuid, pushErrors, failed } = await enqueue(ids, command);
  if (!cmdUuid) return "";
  const rows = ids.map((id) => ({
    id,
    status: failed[id] ? "error" : "queued",
    err: failed[id] ? `Couldn't queue the command: ${failed[id]}` : pushErrors[id] ? `Couldn't wake the device: ${pushErrors[id]}` : null,
  }));
  await q(
    `INSERT INTO mdm_commands (uuid, enrollment_id, request_type, label, requested_by, detail, status, error)
     SELECT $1, x.id, $2, $3, $4, $5, x.status, x.err FROM jsonb_to_recordset($6::jsonb) AS x(id text, status text, err text)`,
    [cmdUuid, String(command.RequestType), label, actor, JSON.stringify(detail), JSON.stringify(rows)],
  );
  return cmdUuid;
}

export type Managed = { enrollment_id: string; platform: ApplePlatform; status: string; owner: string | null; hostname: string; supervised: boolean | null };

/** The device's active Apple enrollment, checked against who is asking. */
export async function managed(me: Me, deviceId: string): Promise<Managed> {
  const [m] = await q<Managed>(
    `SELECT e.id AS enrollment_id, e.platform, e.status, d.owner, d.hostname, (e.info->>'IsSupervised')::boolean AS supervised
     FROM mdm_enrollments e JOIN devices d ON d.id = e.device_id
     WHERE e.device_id = $1 AND d.retired_at IS NULL AND ($2 OR d.owner = $3)
     ORDER BY (e.status = 'enrolled') DESC, e.last_seen DESC LIMIT 1`,
    [uuid(deviceId, "device"), me.role === "admin", me.email],
  );
  if (!m) throw new UserError("No such device", 404);
  if (m.status !== "enrolled") throw new UserError("This device isn't under management (it hasn't finished enrolling, or it left)", 409);
  return m;
}

const pin6 = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Lock: the screen locks now. A Mac locks with a six-digit PIN Devices makes and shows to admins;
 * an iPhone or iPad needs its own passcode. Owners can lock their own device (lost or stolen).
 */
export async function lock(me: Me, deviceId: string, v: { message?: unknown; phone?: unknown }): Promise<{ pin: string | null }> {
  const m = await managed(me, deviceId);
  const pin = m.platform === "darwin" ? pin6() : null;
  const message = text(v.message, 200) || undefined;
  const phone = text(v.phone, 40) || undefined;
  await send([m.enrollment_id], { RequestType: "DeviceLock", PIN: pin ?? undefined, Message: message, PhoneNumber: phone }, "Lock", me.email, pin ? { pin } : {});
  await audit(me.email, "mdm.lock", deviceId, { hostname: m.hostname, message: message ?? null });
  return { pin };
}

/**
 * Erase: everything on the device is deleted and it returns to setup. Admins only, and only after
 * typing the device's name. A Mac without Apple silicon or a T2 chip locks with a PIN afterwards.
 */
export async function erase(me: Me, deviceId: string, v: { confirm?: unknown; keep_data_plan?: unknown }): Promise<{ pin: string | null }> {
  if (me.role !== "admin") throw new UserError("Only device admins can erase a device", 403);
  const m = await managed(me, deviceId);
  if (text(v.confirm, 300) !== m.hostname) throw new UserError("Type the device's name exactly to confirm");
  const pin = m.platform === "darwin" ? pin6() : null;
  await send(
    [m.enrollment_id],
    { RequestType: "EraseDevice", PIN: pin ?? undefined, PreserveDataPlan: m.platform === "ios" ? v.keep_data_plan !== false : undefined },
    "Erase",
    me.email,
    pin ? { pin } : {},
  );
  await audit(me.email, "mdm.erase", deviceId, { hostname: m.hostname });
  return { pin };
}

export async function power(me: Me, deviceId: string, action: "restart" | "shutdown"): Promise<void> {
  if (me.role !== "admin") throw new UserError("Only device admins can restart or shut down devices", 403);
  const m = await managed(me, deviceId);
  if (m.platform === "ios" && m.supervised !== true) throw new UserError("iPhones and iPads can be restarted remotely only when supervised (Apple Business Manager or Apple Configurator)");
  await send([m.enrollment_id], { RequestType: action === "restart" ? "RestartDevice" : "ShutDownDevice" }, action === "restart" ? "Restart" : "Shut down", me.email);
  await audit(me.email, `mdm.${action}`, deviceId, { hostname: m.hostname });
}

export async function refreshManaged(me: Me, deviceId: string): Promise<boolean> {
  const [e] = await q<{ id: string }>(`SELECT id FROM mdm_enrollments WHERE device_id = $1 AND status = 'enrolled' LIMIT 1`, [deviceId]);
  if (!e || !mdmConfig()) return false;
  await askForInfo([e.id], me.email);
  return true;
}

/** Retiring a managed device also removes management from it: the device deletes the enrollment profile. */
export async function unenroll(actor: string, deviceId: string): Promise<void> {
  const rows = await q<{ id: string }>(`SELECT id FROM mdm_enrollments WHERE device_id = $1 AND status = 'enrolled'`, [deviceId]);
  if (!rows.length || !mdmConfig()) return;
  await send(rows.map((r) => r.id), { RequestType: "RemoveProfile", Identifier: MDM_PROFILE_ID }, "Remove management", actor);
}

/** What the device screen shows about management. */
export async function managementOf(me: Me, deviceId: string) {
  const [e] = await q<Record<string, unknown> & { id: string }>(
    `SELECT e.id, e.platform, e.status, e.enrollment_type, e.info, e.info_at, e.enrolled_at, e.last_seen, e.unenrolled_at
     FROM mdm_enrollments e WHERE e.device_id = $1 ORDER BY (e.status = 'enrolled') DESC, e.last_seen DESC LIMIT 1`,
    [deviceId],
  );
  if (!e) return null;
  const commands = await q(
    `SELECT uuid, request_type, label, status, requested_by, error, created_at, updated_at,
       CASE WHEN $2 OR requested_by = $3 THEN detail->>'pin' END AS pin
     FROM mdm_commands WHERE enrollment_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [e.id, me.role === "admin", me.email],
  );
  const profiles = await q(
    `SELECT p.id, p.name, s.status, s.error, s.updated_at FROM mdm_profile_status s JOIN mdm_profiles p ON p.id = s.profile_id
     WHERE s.enrollment_id = $1 ORDER BY p.name`,
    [e.id],
  );
  return { ...e, commands, profiles };
}
