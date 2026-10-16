import { createHash, createSign } from "node:crypto";
import QRCode from "qrcode";
import type { Me } from "../api";
import { audit, q, tx } from "../db";
import { serverHost } from "../enroll";
import type { Facts } from "../rules";
import { recompute } from "../state";
import { UserError, text } from "../util";

/**
 * Android phones and tablets through Google's Android Management API, the way Intune manages them:
 * a work profile on a personal phone, or the whole device when it belongs to the organization.
 * Devices keeps one policy for everyone (profiles and apps meant for Android) plus one per phone
 * that has apps of its own, reads each phone's state back on a schedule, and sends lock, reboot and
 * wipe. Commands and state go through Google; phones need no app beyond what Android has built in.
 *
 *   DEVICES_ANDROID_SERVICE_ACCOUNT  a Google Cloud service account key (its JSON, or that base64) in a
 *                                    project with the Android Management API turned on
 */

const SCOPE = "https://www.googleapis.com/auth/androidmanagement";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };
export type AndroidConfig = { sa: ServiceAccount; api: string; tokenUrl: string };

export function androidConfig(env: NodeJS.ProcessEnv = process.env): AndroidConfig | null {
  const raw = (env.DEVICES_ANDROID_SERVICE_ACCOUNT ?? "").trim();
  if (!raw) return null;
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    console.error("[devices] DEVICES_ANDROID_SERVICE_ACCOUNT isn't a service account key");
    return null;
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
  return {
    sa,
    api: (env.DEVICES_ANDROID_API_URL || "https://androidmanagement.googleapis.com").replace(/\/+$/, ""),
    tokenUrl: env.DEVICES_ANDROID_TOKEN_URL || "https://oauth2.googleapis.com/token",
  };
}

function need(): AndroidConfig {
  const c = androidConfig();
  if (!c) throw new UserError("Android management isn't set up on this server (see the Devices README)", 503);
  return c;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** A signed service-account assertion, exchanged for an access token (RFC 7523). */
export function assertion(sa: ServiceAccount, aud: string, now = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(sa.private_key);
  return `${head}.${body}.${b64url(sig)}`;
}

let cached: { token: string; until: number; key: string } | null = null;

async function accessToken(c: AndroidConfig): Promise<string> {
  if (cached && cached.key === c.sa.client_email && cached.until > Date.now()) return cached.token;
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion(c.sa, c.tokenUrl) }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res?.ok || !out?.access_token) throw new UserError(`Google refused the service account${out?.error_description ? `: ${out.error_description}` : ""}`, 502);
  cached = { token: out.access_token, until: Date.now() + Math.max(60, (out.expires_in ?? 3600) - 120) * 1000, key: c.sa.client_email };
  return out.access_token;
}

/** One Android Management API call. A 404 comes back as null when `missingOk`. */
async function call<T>(method: string, path: string, body?: unknown, opts: { missingOk?: boolean } = {}): Promise<T> {
  const c = need();
  const res = await fetch(`${c.api}/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken(c)}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) throw new UserError("Devices can't reach Google's Android Management API right now", 503);
  if (res.status === 404 && opts.missingOk) return null as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new UserError(`Google refused that: ${json.error?.message ?? `status ${res.status}`}`, 502);
  return json as T;
}

/* ---------------------------------------------------------------- the organization's enterprise */

type AndroidSetting = { enterprise: string; display_name: string; connected_by: string; connected_at: string; signup?: string };

async function setting(): Promise<AndroidSetting | null> {
  const [r] = await q<{ value: AndroidSetting }>(`SELECT value FROM mdm_settings WHERE key = 'android'`);
  return r?.value ?? null;
}

async function saveSetting(v: AndroidSetting, by: string): Promise<void> {
  await q(
    `INSERT INTO mdm_settings (key, value, updated_by) VALUES ('android', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`,
    [JSON.stringify(v), by],
  );
}

async function enterprise(): Promise<string> {
  const s = await setting();
  if (!s?.enterprise) throw new UserError("Connect Android management to Google first (Devices › Android devices)", 409);
  return s.enterprise;
}

export async function androidStatus() {
  const s = await setting();
  const [counts] = await q<{ enrolled: number; work_profile: number; fully_managed: number }>(
    `SELECT count(*)::int AS enrolled, count(*) FILTER (WHERE enrollment_type = 'work_profile')::int AS work_profile,
       count(*) FILTER (WHERE enrollment_type = 'fully_managed')::int AS fully_managed
     FROM mdm_enrollments WHERE platform = 'android' AND status = 'enrolled'`,
  );
  return { configured: !!androidConfig(), ready: !!androidConfig() && !!s?.enterprise, enterprise: s?.enterprise ? s : null, ...counts };
}

/** Starts the Google sign-up for a managed Google Play enterprise; the admin finishes it at the returned address. */
export async function startSignup(me: Me): Promise<{ url: string }> {
  const c = need();
  const callback = `https://${serverHost()}/api/mdm/android/callback`;
  const out = await call<{ name: string; url: string }>("POST", `signupUrls?${new URLSearchParams({ projectId: c.sa.project_id, callbackUrl: callback })}`);
  const s = await setting();
  await saveSetting({ ...(s ?? { enterprise: "", display_name: "", connected_by: "", connected_at: "" }), signup: out.name }, me.email);
  return { url: out.url };
}

/** Google sends the admin back with an enterprise token; it becomes the organization's enterprise. */
export async function finishSignup(me: Me, enterpriseToken: string, displayName: string): Promise<void> {
  const c = need();
  const s = await setting();
  if (s?.enterprise) throw new UserError("Android management is already connected", 409);
  if (!s?.signup) throw new UserError("Start connecting from Devices › Android devices", 409);
  if (!/^[A-Za-z0-9_-]{8,}$/.test(enterpriseToken)) throw new UserError("Google didn't send back a sign-up token");
  const params = new URLSearchParams({ projectId: c.sa.project_id, signupUrlName: s.signup, enterpriseToken });
  const e = await call<{ name: string }>("POST", `enterprises?${params}`, { enterpriseDisplayName: displayName });
  await saveSetting({ enterprise: e.name, display_name: displayName, connected_by: me.email, connected_at: new Date().toISOString() }, me.email);
  await audit(me.email, "android.connect", e.name, { display_name: displayName });
  await syncAndroidPolicies(me.email);
}

/* ---------------------------------------------------------------- policies */

type ProfileRow = { id: string; kind: string; settings: Record<string, unknown> };
type AppRow = { id: string; store_id: string; auto_install: boolean };

/** The Android Management policy for a set of settings profiles and apps. */
export function buildPolicy(profiles: ProfileRow[], apps: AppRow[], forced: string[] = []): Record<string, unknown> {
  const policy: Record<string, unknown> = {
    statusReportingSettings: { applicationReportsEnabled: true, deviceSettingsEnabled: true, softwareInfoEnabled: true, hardwareStatusEnabled: true, networkInfoEnabled: true },
    // Only the apps below show in the work Play Store.
    playStoreMode: "WHITELIST",
  };
  const wifi: Record<string, unknown>[] = [];
  for (const p of profiles) {
    const s = p.settings;
    if (p.kind === "passcode") {
      policy.passwordPolicies = [{
        passwordScope: "SCOPE_DEVICE",
        passwordQuality: s.require_alphanumeric ? "ALPHANUMERIC" : "NUMERIC_COMPLEX",
        passwordMinimumLength: s.min_length ?? 6,
        maximumFailedPasswordsForWipe: s.max_failed_attempts ?? undefined,
        passwordExpirationTimeout: s.max_age_days ? `${Number(s.max_age_days) * 86400}s` : undefined,
      }];
      policy.maximumTimeToLock = String(Number(s.max_inactivity_minutes ?? 5) * 60_000);
    } else if (p.kind === "restrictions") {
      if (s.no_camera) policy.cameraAccess = "CAMERA_ACCESS_DISABLED";
      if (s.no_screenshots) policy.screenCaptureDisabled = true;
    } else if (p.kind === "wifi") {
      wifi.push({
        GUID: `synergy-${p.id}`,
        Name: s.ssid,
        Type: "WiFi",
        WiFi: {
          SSID: s.ssid,
          Security: s.security === "None" ? "None" : "WPA-PSK",
          Passphrase: s.security === "None" ? undefined : s.password,
          AutoConnect: s.auto_join !== false,
          HiddenSSID: s.hidden === true,
        },
      });
    }
  }
  if (wifi.length) policy.openNetworkConfiguration = { NetworkConfigurations: wifi };
  policy.applications = apps.map((a) => ({ packageName: a.store_id, installType: a.auto_install || forced.includes(a.id) ? "FORCE_INSTALLED" : "AVAILABLE" }));
  return JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
}

export const DEFAULT_POLICY = "default";
const devicePolicyId = (deviceName: string) => `device-${createHash("sha256").update(deviceName).digest("hex").slice(0, 20)}`;

/** Sends the current profiles and apps to Google: the shared policy, and each phone's own. */
export async function syncAndroidPolicies(actor: string): Promise<void> {
  if (!androidConfig()) return;
  const s = await setting();
  if (!s?.enterprise) return;
  const profiles = await q<ProfileRow>(`SELECT id, kind, settings FROM mdm_profiles WHERE enabled AND 'android' = ANY(platforms) ORDER BY created_at`);
  const apps = await q<AppRow>(`SELECT id, store_id, auto_install FROM mdm_apps WHERE platform = 'android' ORDER BY created_at`);
  await call("PATCH", `${s.enterprise}/policies/${DEFAULT_POLICY}`, buildPolicy(profiles, apps));
  const own = await q<{ id: string; apps: string[] }>(
    `SELECT id, ARRAY(SELECT jsonb_array_elements_text(info->'android_apps')) AS apps FROM mdm_enrollments
     WHERE platform = 'android' AND status = 'enrolled' AND info ? 'android_apps'`,
  );
  for (const e of own) await call("PATCH", `${s.enterprise}/policies/${devicePolicyId(e.id)}`, buildPolicy(profiles, apps, e.apps));
  await audit(actor, "android.policy", s.enterprise, { profiles: profiles.length, apps: apps.length, devices_with_own_apps: own.length });
}

/** Installs a catalog app on chosen phones: each moves to a policy of its own that forces the app. */
export async function installOnAndroid(enrollmentIds: string[], appId: string, actor: string): Promise<void> {
  const ent = await enterprise();
  await q(
    `UPDATE mdm_enrollments SET info = jsonb_set(info, '{android_apps}', COALESCE(info->'android_apps', '[]'::jsonb) || to_jsonb($2::text))
     WHERE id = ANY($1) AND NOT (COALESCE(info->'android_apps', '[]'::jsonb) ? $2)`,
    [enrollmentIds, appId],
  );
  await syncAndroidPolicies(actor);
  for (const id of enrollmentIds) {
    await call("PATCH", `${id}?updateMask=policyName`, { policyName: `${ent}/policies/${devicePolicyId(id)}` });
    await record(id, {}, "INSTALL_APP", "Install app", actor, true);
  }
}

/* ---------------------------------------------------------------- enrollment */

export type AndroidEnrollment = { link: string; qr: string; value: string; expires: string; mode: "work_profile" | "fully_managed" };

/**
 * A one-time enrollment token. "work_profile": a personal phone opens the link and gets a work
 * profile (the organization never sees personal apps or data). "fully_managed": a company phone,
 * scanned from its setup screen after a factory reset (tap the welcome screen six times).
 */
export async function androidEnrollment(me: Me, v: { mode?: unknown; org?: unknown }): Promise<AndroidEnrollment> {
  const org = v.org === true || v.org === "1";
  const mode = v.mode === "fully_managed" ? "fully_managed" : "work_profile";
  if ((org || mode === "fully_managed") && me.role !== "admin") throw new UserError("Only device admins can enroll company phones", 403);
  const ent = await enterprise();
  const t = await call<{ value: string; qrCode: string; expirationTimestamp: string }>("POST", `${ent}/enrollmentTokens`, {
    policyName: `${ent}/policies/${DEFAULT_POLICY}`,
    duration: `${7 * 86400}s`,
    oneTimeOnly: true,
    allowPersonalUsage: mode === "fully_managed" ? "PERSONAL_USAGE_DISALLOWED" : "PERSONAL_USAGE_ALLOWED",
    additionalData: JSON.stringify({ owner: org ? null : me.email, by: me.email }),
  });
  await audit(me.email, "android.enrollment_token", "", { mode, organization: org });
  return {
    link: `https://enterprise.google.com/android/enroll?et=${encodeURIComponent(t.value)}`,
    qr: await QRCode.toDataURL(t.qrCode, { margin: 1, width: 280 }),
    value: t.value,
    expires: t.expirationTimestamp,
    mode,
  };
}

/* ---------------------------------------------------------------- what phones report */

export type AndroidDevice = {
  name: string; managementMode?: string; ownership?: string; state?: string; enrollmentTime?: string; lastStatusReportTime?: string;
  lastPolicySyncTime?: string; policyCompliant?: boolean; enrollmentTokenData?: string; appliedPolicyName?: string;
  hardwareInfo?: { brand?: string; manufacturer?: string; model?: string; serialNumber?: string };
  softwareInfo?: { androidVersion?: string; securityPatchLevel?: string };
  deviceSettings?: { isDeviceSecure?: boolean; isEncrypted?: boolean; adbEnabled?: boolean; unknownSourcesEnabled?: boolean; developmentSettingsEnabled?: boolean; verifyAppsEnabled?: boolean };
  securityPosture?: { devicePosture?: string };
  nonComplianceDetails?: { settingName?: string; nonComplianceReason?: string; packageName?: string }[];
  applicationReports?: { packageName?: string; displayName?: string; versionName?: string; state?: string }[];
  networkInfo?: { telephonyInfos?: { phoneNumber?: string }[] };
};

/** What a phone reports, as compliance facts. */
export function androidFacts(d: AndroidDevice): Facts {
  const ds = d.deviceSettings ?? {};
  const posture = d.securityPosture?.devicePosture;
  return {
    disk_encryption: typeof ds.isEncrypted === "boolean" ? ds.isEncrypted : null,
    screen_lock: typeof ds.isDeviceSecure === "boolean" ? ds.isDeviceSecure : null,
    // Play Integrity: SECURE means a genuine, unmodified Android build.
    system_protection: posture ? posture === "SECURE" : null,
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ownerOf(d: AndroidDevice): string | null {
  try {
    const o = (JSON.parse(d.enrollmentTokenData ?? "{}") as { owner?: unknown }).owner;
    return typeof o === "string" && o.includes("@") ? o : null;
  } catch {
    return null;
  }
}

/** Brings one phone's report into Devices: its device row, enrollment, facts and apps. */
export async function upsertAndroid(d: AndroidDevice): Promise<string | null> {
  if (!d.name) return null;
  const gone = d.state === "DELETED";
  const mode = d.managementMode === "PROFILE_OWNER" ? "work_profile" : "fully_managed";
  const hw = d.hardwareInfo ?? {};
  const label = text([hw.brand ? capital(hw.brand) : "", hw.model].filter(Boolean).join(" ") || "Android device", 300);
  const facts = Object.fromEntries(Object.entries(androidFacts(d)).filter(([, v]) => v !== null));
  const seen = d.lastStatusReportTime ?? d.lastPolicySyncTime ?? d.enrollmentTime ?? new Date().toISOString();
  const info = {
    management_mode: mode,
    state: d.state ?? "",
    policy_compliant: d.policyCompliant ?? null,
    noncompliance: (d.nonComplianceDetails ?? []).slice(0, 20),
    security_patch: d.softwareInfo?.securityPatchLevel ?? null,
    posture: d.securityPosture?.devicePosture ?? null,
    adb: d.deviceSettings?.adbEnabled ?? null,
    unknown_sources: d.deviceSettings?.unknownSourcesEnabled ?? null,
    phone: d.networkInfo?.telephonyInfos?.find((t) => t.phoneNumber)?.phoneNumber ?? null,
    policy: d.appliedPolicyName ?? null,
  };
  const deviceId = await tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO devices (host_identifier, hostname, platform, os_name, os_version, hardware_vendor, hardware_model, hardware_serial, owner, facts, facts_at, last_seen)
       VALUES ($1, $2, 'android', 'Android', $3, $4, $5, $6, $7, $8, now(), $9)
       ON CONFLICT (host_identifier) DO UPDATE SET hostname = CASE WHEN devices.hostname = '' THEN $2 ELSE devices.hostname END,
         os_version = COALESCE(NULLIF($3, ''), devices.os_version), hardware_vendor = $4, hardware_model = $5,
         hardware_serial = COALESCE(NULLIF($6, ''), devices.hardware_serial), owner = COALESCE(devices.owner, $7),
         facts = devices.facts || $8, facts_at = now(), last_seen = greatest(devices.last_seen, $9)
       RETURNING id`,
      [`android:${d.name.split("/").pop()}`, label, text(d.softwareInfo?.androidVersion, 50), text(hw.manufacturer ? capital(hw.manufacturer) : "", 200),
        text(hw.model, 200), text(hw.serialNumber, 100), ownerOf(d), JSON.stringify(facts), seen],
    );
    await tq(
      `INSERT INTO mdm_enrollments (id, device_id, enrollment_type, serial, model, product, platform, status, info, info_at, authenticated_at, enrolled_at, last_seen)
       VALUES ($1, $2, $3, $4, $5, $5, 'android', $6, $7, now(), COALESCE($8::timestamptz, now()), COALESCE($8::timestamptz, now()), $9)
       ON CONFLICT (id) DO UPDATE SET device_id = $2, enrollment_type = $3, serial = $4, model = $5, product = $5, status = $6,
         info = mdm_enrollments.info || $7, info_at = now(), last_seen = $9,
         unenrolled_at = CASE WHEN $6 = 'unenrolled' THEN COALESCE(mdm_enrollments.unenrolled_at, now()) END`,
      [d.name, row.id, mode, text(hw.serialNumber, 100), text(hw.model, 100), gone ? "unenrolled" : "enrolled", JSON.stringify(info), d.enrollmentTime ?? null, seen],
    );
    const apps = (d.applicationReports ?? []).filter((a) => a.packageName && a.state !== "REMOVED").slice(0, 5000)
      .map((a) => ({ name: text(a.displayName || a.packageName, 300), version: text(a.versionName, 100), package: text(a.packageName, 300) }));
    if (d.applicationReports) {
      await tq(`DELETE FROM software WHERE device_id = $1 AND source = 'mdm'`, [row.id]);
      if (apps.length) {
        await tq(
          `INSERT INTO software (device_id, name, version, source, package)
           SELECT $1, x.name, x.version, 'mdm', x.package FROM jsonb_to_recordset($2::jsonb) AS x(name text, version text, package text)
           ON CONFLICT DO NOTHING`,
          [row.id, JSON.stringify(apps)],
        );
      }
    }
    if (gone) await tq(`UPDATE devices SET retired_at = COALESCE(retired_at, now()), retired_by = COALESCE(retired_by, 'Devices') WHERE id = $1`, [row.id]);
    return row.id;
  });
  await recompute([deviceId]);
  return deviceId;
}

/** Reads every phone from Google. A phone Google no longer lists has left management. */
export async function syncAndroidDevices(): Promise<number> {
  const ent = await enterprise();
  const names: string[] = [];
  let page = "";
  do {
    const out = await call<{ devices?: AndroidDevice[]; nextPageToken?: string }>("GET", `${ent}/devices?${new URLSearchParams({ pageSize: "100", ...(page ? { pageToken: page } : {}) })}`);
    for (const d of out.devices ?? []) {
      await upsertAndroid(d);
      names.push(d.name);
    }
    page = out.nextPageToken ?? "";
  } while (page);
  const left = await q<{ id: string; device_id: string | null }>(
    `UPDATE mdm_enrollments SET status = 'unenrolled', unenrolled_at = now() WHERE platform = 'android' AND status = 'enrolled' AND NOT (id = ANY($1))
     RETURNING id, device_id`,
    [names],
  );
  for (const e of left) if (e.device_id) await q(`UPDATE devices SET retired_at = now(), retired_by = 'Devices' WHERE id = $1 AND retired_at IS NULL`, [e.device_id]);
  await settleCommands();
  return names.length;
}

/** Commands Google has finished: done, or failed with its reason. */
async function settleCommands(): Promise<void> {
  const open = await q<{ uuid: string; enrollment_id: string }>(
    `SELECT c.uuid, c.enrollment_id FROM mdm_commands c JOIN mdm_enrollments e ON e.id = c.enrollment_id
     WHERE e.platform = 'android' AND c.status = 'queued' AND c.uuid LIKE 'enterprises/%' AND c.created_at > now() - interval '7 days' LIMIT 100`,
  );
  for (const c of open) {
    const op = await call<{ done?: boolean; error?: { message?: string } } | null>("GET", c.uuid, undefined, { missingOk: true });
    if (!op?.done) continue;
    await q(`UPDATE mdm_commands SET status = $3, error = $4, updated_at = now() WHERE uuid = $1 AND enrollment_id = $2`,
      [c.uuid, c.enrollment_id, op.error ? "error" : "acknowledged", op.error ? text(op.error.message ?? "The phone refused it", 1000) : null]);
  }
}

let lastSweep = 0;
/** Reads phones from Google at most every 15 minutes, from list and overview requests. */
export async function androidRefreshDue(): Promise<void> {
  if (!androidConfig() || Date.now() - lastSweep < 15 * 60_000) return;
  lastSweep = Date.now();
  if (!(await setting())?.enterprise) return;
  await syncAndroidDevices().catch((e) => console.error("[devices] android sync", e));
}

export async function refreshAndroid(enrollmentId: string): Promise<void> {
  const d = await call<AndroidDevice | null>("GET", enrollmentId, undefined, { missingOk: true });
  if (d) await upsertAndroid(d);
  await settleCommands();
}

/* ---------------------------------------------------------------- commands */

async function record(enrollmentId: string, op: { name?: string }, type: string, label: string, actor: string, done = false): Promise<void> {
  await q(
    `INSERT INTO mdm_commands (uuid, enrollment_id, request_type, label, status, requested_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [op.name || `local:${Date.now()}:${Math.random().toString(36).slice(2)}`, enrollmentId, type, label, done ? "acknowledged" : "queued", actor],
  );
}

export async function androidCommand(enrollmentId: string, type: "LOCK" | "REBOOT", actor: string): Promise<void> {
  const op = await call<{ name?: string }>("POST", `${enrollmentId}:issueCommand`, { type });
  await record(enrollmentId, op, type, type === "LOCK" ? "Lock" : "Restart", actor);
}

/**
 * Wipe: on a company phone, a factory reset; on a personal phone, only the work profile and its
 * apps and data go. Either way the phone leaves management.
 */
export async function androidWipe(enrollmentId: string, deviceId: string, actor: string, keepEsim: boolean): Promise<void> {
  const flags = keepEsim ? "" : `?${new URLSearchParams({ wipeDataFlags: "WIPE_ESIMS" })}`;
  await call("DELETE", `${enrollmentId}${flags}`, undefined, { missingOk: true });
  await record(enrollmentId, {}, "WIPE", "Erase", actor, true);
  await q(`UPDATE mdm_enrollments SET status = 'unenrolled', unenrolled_at = now() WHERE id = $1`, [enrollmentId]);
  await q(`UPDATE devices SET retired_at = now(), retired_by = $2 WHERE id = $1 AND retired_at IS NULL`, [deviceId, actor]);
}

/**
 * Retiring a phone: a work profile is removed (personal data stays). A company phone is left as it
 * is, because Google's only way to release one is a factory reset; erase it for that.
 */
export async function androidRetire(enrollmentId: string, mode: string, actor: string): Promise<void> {
  if (mode !== "work_profile") return;
  await call("DELETE", enrollmentId, undefined, { missingOk: true });
  await record(enrollmentId, {}, "WIPE", "Remove work profile", actor, true);
  await q(`UPDATE mdm_enrollments SET status = 'unenrolled', unenrolled_at = now() WHERE id = $1`, [enrollmentId]);
}

/** "https://play.google.com/store/apps/details?id=com.slack" or "com.slack" → "com.slack". */
export function playPackage(v: unknown): string {
  const s = String(v ?? "").trim();
  let id = s;
  try {
    if (/^https?:/i.test(s)) id = new URL(s).searchParams.get("id") ?? "";
  } catch {
    id = "";
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(id)) throw new UserError("Paste the app's Google Play link (play.google.com/…?id=com.example.app) or its package name");
  return id;
}
