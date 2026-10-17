import { createHash } from "node:crypto";
import type { Me } from "../api";
import { audit, q } from "../db";
import { UserError, text, uuid } from "../util";
import { organization, send } from "./apple";
import { mdmConfig } from "./nanomdm";
import { type ApplePlatform, PROFILE_KINDS, type ProfileKind, type Settings, cleanSettings, profileIdentifier, settingsProfile } from "./profiles";

/**
 * Settings profiles and apps for Apple devices, like Intune's configuration profiles and app
 * assignments. A profile goes to every enrolled device of its platforms; changing it sends the new
 * version, and deleting or turning it off removes it from them. An app is installed when someone
 * asks for it on a device or across the fleet, and on new devices when "install automatically" is on.
 */

type ProfileRow = { id: string; name: string; description: string; kind: ProfileKind; settings: Settings; platforms: ApplePlatform[]; enabled: boolean; version: number };

const PLATFORMS: ApplePlatform[] = ["darwin", "ios"];

/** Settings never shown back in full (Wi-Fi passwords). */
function redact(p: ProfileRow): ProfileRow {
  return p.kind === "wifi" ? { ...p, settings: { ...p.settings, password: p.settings.password ? "********" : "" } } : p.kind === "custom" ? { ...p, settings: { payload_types: p.settings.payload_types } } : p;
}

export async function listProfiles() {
  const rows = await q<ProfileRow & { created_by: string; updated_at: Date; installed: number; failed: number; pending: number }>(
    `SELECT p.*, (SELECT count(*)::int FROM mdm_profile_status s WHERE s.profile_id = p.id AND s.status = 'installed' AND s.version = p.version) AS installed,
       (SELECT count(*)::int FROM mdm_profile_status s WHERE s.profile_id = p.id AND s.status = 'error') AS failed,
       (SELECT count(*)::int FROM mdm_profile_status s WHERE s.profile_id = p.id AND (s.status = 'queued' OR s.version <> p.version)) AS pending
     FROM mdm_profiles p ORDER BY p.created_at`,
  );
  return { profiles: rows.map(redact), kinds: PROFILE_KINDS };
}

function platformsOf(kind: ProfileKind, v: unknown): ApplePlatform[] {
  const allowed = PROFILE_KINDS.find((k) => k.kind === kind)!.platforms;
  if (v === undefined || (Array.isArray(v) && !v.length)) return allowed;
  if (!Array.isArray(v) || v.some((p) => !PLATFORMS.includes(p))) throw new UserError("platforms must be darwin or ios");
  const out = (v as ApplePlatform[]).filter((p) => allowed.includes(p));
  if (!out.length) throw new UserError(`${PROFILE_KINDS.find((k) => k.kind === kind)!.label} profiles are for ${allowed.map((p) => (p === "darwin" ? "Mac" : "iPhone and iPad")).join(" and ")} only`);
  return out;
}

export async function createProfile(me: Me, v: Record<string, unknown>): Promise<{ id: string }> {
  const kind = String(v.kind) as ProfileKind;
  if (!PROFILE_KINDS.some((k) => k.kind === kind)) throw new UserError("Choose what the profile sets");
  const name = text(v.name, 120);
  if (!name) throw new UserError("Name the profile");
  const settings = cleanSettings(kind, (v.settings ?? {}) as Settings);
  const [row] = await q<{ id: string }>(
    `INSERT INTO mdm_profiles (name, description, kind, settings, platforms, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, text(v.description, 500), kind, JSON.stringify(settings), platformsOf(kind, v.platforms), me.email],
  );
  await audit(me.email, "mdm.profile.create", row.id, { name, kind });
  await deployProfile(row.id, me.email);
  return row;
}

export async function updateProfile(me: Me, id: string, v: Record<string, unknown>): Promise<void> {
  const [p] = await q<ProfileRow>(`SELECT * FROM mdm_profiles WHERE id = $1`, [uuid(id, "profile")]);
  if (!p) throw new UserError("No such profile", 404);
  const name = v.name === undefined ? p.name : text(v.name, 120);
  if (!name) throw new UserError("Name the profile");
  let settings = p.settings;
  if (v.settings !== undefined) {
    const next = { ...(v.settings as Settings) };
    // A Wi-Fi password left as shown keeps the stored one.
    if (p.kind === "wifi" && next.password === "********") next.password = p.settings.password;
    // A custom profile edited without choosing a new file keeps its document.
    if (p.kind === "custom" && !next.mobileconfig) next.mobileconfig = p.settings.mobileconfig;
    settings = cleanSettings(p.kind, next);
  }
  const platforms = v.platforms === undefined ? p.platforms : platformsOf(p.kind, v.platforms);
  const enabled = v.enabled === undefined ? p.enabled : v.enabled === true;
  const changed = v.settings !== undefined || v.name !== undefined || v.description !== undefined;
  await q(
    `UPDATE mdm_profiles SET name = $2, description = $3, settings = $4, platforms = $5, enabled = $6, version = version + $7, updated_at = now() WHERE id = $1`,
    [p.id, name, v.description === undefined ? p.description : text(v.description, 500), JSON.stringify(settings), platforms, enabled, changed ? 1 : 0],
  );
  await audit(me.email, "mdm.profile.update", p.id, { name, enabled });
  await deployProfile(p.id, me.email);
}

export async function deleteProfile(me: Me, id: string): Promise<void> {
  const [p] = await q<ProfileRow>(`SELECT * FROM mdm_profiles WHERE id = $1`, [uuid(id, "profile")]);
  if (!p) throw new UserError("No such profile", 404);
  const on = await q<{ enrollment_id: string }>(`SELECT enrollment_id FROM mdm_profile_status WHERE profile_id = $1`, [p.id]);
  if (on.length && mdmConfig()) {
    await send(on.map((r) => r.enrollment_id), { RequestType: "RemoveProfile", Identifier: profileIdentifier(p.id) }, `Remove profile ${p.name}`, me.email, {});
  }
  await q(`DELETE FROM mdm_profiles WHERE id = $1`, [p.id]);
  await audit(me.email, "mdm.profile.delete", p.id, { name: p.name, removed_from: on.length });
}

/**
 * Brings every enrolled device in line with one profile: devices that should have it and don't
 * have this version get it; devices that shouldn't (turned off, platform removed) have it removed.
 */
export async function deployProfile(profileId: string, actor: string): Promise<void> {
  if (!mdmConfig()) return;
  const [p] = await q<ProfileRow>(`SELECT * FROM mdm_profiles WHERE id = $1`, [profileId]);
  if (!p) return;
  const want = p.enabled
    ? await q<{ id: string }>(
        `SELECT e.id FROM mdm_enrollments e LEFT JOIN mdm_profile_status s ON s.enrollment_id = e.id AND s.profile_id = $1
         WHERE e.status = 'enrolled' AND e.platform = ANY($2) AND (s.version IS NULL OR s.version <> $3 OR s.status = 'error')`,
        [p.id, p.platforms, p.version],
      )
    : [];
  if (want.length) await installProfileOn(p, want.map((r) => r.id), actor);
  const remove = await q<{ enrollment_id: string }>(
    `SELECT s.enrollment_id FROM mdm_profile_status s JOIN mdm_enrollments e ON e.id = s.enrollment_id
     WHERE s.profile_id = $1 AND s.status <> 'removing' AND (NOT $2 OR NOT (e.platform = ANY($3)))`,
    [p.id, p.enabled, p.platforms],
  );
  if (remove.length) {
    const ids = remove.map((r) => r.enrollment_id);
    const cmd = await send(ids, { RequestType: "RemoveProfile", Identifier: profileIdentifier(p.id) }, `Remove profile ${p.name}`, actor, { profile_id: p.id });
    await q(`UPDATE mdm_profile_status SET status = 'removing', command_uuid = $3, updated_at = now() WHERE profile_id = $1 AND enrollment_id = ANY($2)`, [p.id, ids, cmd]);
  }
}

async function installProfileOn(p: ProfileRow, ids: string[], actor: string): Promise<void> {
  const doc = settingsProfile({ ...p, organization: organization() });
  const cmd = await send(ids, { RequestType: "InstallProfile", Payload: Buffer.from(doc.xml) }, `Install profile ${p.name}`, actor, { profile_id: p.id, version: p.version });
  await q(
    `INSERT INTO mdm_profile_status (enrollment_id, profile_id, version, command_uuid, status)
     SELECT unnest($1::text[]), $2, $3, $4, 'queued'
     ON CONFLICT (enrollment_id, profile_id) DO UPDATE SET version = $3, command_uuid = $4, status = 'queued', error = NULL, updated_at = now()`,
    [ids, p.id, p.version, cmd],
  );
}

/** A newly enrolled device gets every enabled profile and automatic app for its platform. */
export async function deployToEnrollment(enrollmentId: string, platform: ApplePlatform): Promise<void> {
  const profiles = await q<ProfileRow>(`SELECT * FROM mdm_profiles WHERE enabled AND $1 = ANY(platforms) ORDER BY created_at`, [platform]);
  for (const p of profiles) await installProfileOn(p, [enrollmentId], "Devices");
  const apps = await q<AppRow>(`SELECT * FROM mdm_apps WHERE auto_install AND platform = $1 ORDER BY created_at`, [platform]);
  for (const a of apps) await installAppOn(a, [enrollmentId], "Devices");
}

/* ---------------------------------------------------------------- apps */

type AppRow = { id: string; name: string; platform: ApplePlatform; source: "app_store" | "package"; store_id: string | null; bundle_id: string; version: string; url: string | null; manifest: Record<string, unknown> | null; auto_install: boolean };

export async function listApps() {
  return q(
    `SELECT a.id, a.name, a.platform, a.source, a.store_id, a.bundle_id, a.version, a.url, a.auto_install, a.created_by, a.created_at,
       (SELECT count(DISTINCT c.enrollment_id)::int FROM mdm_commands c WHERE c.detail->>'app_id' = a.id::text AND c.status = 'acknowledged') AS installed
     FROM mdm_apps a ORDER BY lower(a.name)`,
  );
}

/** "https://apps.apple.com/us/app/slack/id618783545" or "618783545" → "618783545". */
export function storeId(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /(?:\/id|^)(\d{6,12})(?:[/?#]|$)/.exec(s);
  if (!m) throw new UserError("Paste the app's App Store link (apps.apple.com/…/id123456789) or its number");
  return m[1];
}

/** Hashes a .pkg in 10 MB chunks, the way an InstallEnterpriseApplication manifest describes it. */
export async function packageManifest(url: string, meta: { bundle_id: string; version: string; name: string }, fetcher: typeof fetch = fetch) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UserError("Enter the package's download address (https://…)");
  }
  if (parsed.protocol !== "https:") throw new UserError("The package must be downloadable over https");
  const res = await fetcher(url, { signal: AbortSignal.timeout(30 * 60_000) }).catch(() => null);
  if (!res || !res.ok || !res.body) throw new UserError(`Devices couldn't download ${url}${res ? ` (${res.status})` : ""}`);
  const CHUNK = 10 * 1024 * 1024;
  const hashes: string[] = [];
  let h = createHash("sha256");
  let inChunk = 0;
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let buf = Buffer.from(value);
    total += buf.length;
    if (total > 16 * 1024 ** 3) throw new UserError("That package is larger than 16 GB");
    while (buf.length) {
      const take = Math.min(CHUNK - inChunk, buf.length);
      h.update(buf.subarray(0, take));
      inChunk += take;
      buf = buf.subarray(take);
      if (inChunk === CHUNK) {
        hashes.push(h.digest("hex"));
        h = createHash("sha256");
        inChunk = 0;
      }
    }
  }
  if (inChunk) hashes.push(h.digest("hex"));
  if (!total) throw new UserError("That download is empty");
  return {
    items: [{
      assets: [{ kind: "software-package", url, "sha256-size": CHUNK, sha256s: hashes }],
      metadata: { kind: "software", title: meta.name, "bundle-identifier": meta.bundle_id, "bundle-version": meta.version, sizeInBytes: total },
    }],
  };
}

export async function createApp(me: Me, v: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<{ id: string }> {
  const source = v.source === "package" ? "package" : "app_store";
  const platform: ApplePlatform = source === "package" ? "darwin" : v.platform === "darwin" ? "darwin" : "ios";
  const name = text(v.name, 120);
  if (!name) throw new UserError("Name the app");
  let store: string | null = null;
  let url: string | null = null;
  let manifest: Record<string, unknown> | null = null;
  const bundle = text(v.bundle_id, 200);
  const version = text(v.version, 50);
  if (source === "app_store") {
    store = storeId(v.store);
  } else {
    if (!/^[A-Za-z0-9.-]+$/.test(bundle)) throw new UserError("Enter the package's bundle identifier, like com.example.app");
    if (!version) throw new UserError("Enter the package's version");
    url = text(v.url, 2000);
    manifest = await packageManifest(url, { bundle_id: bundle, version, name }, fetcher);
  }
  const [row] = await q<{ id: string }>(
    `INSERT INTO mdm_apps (name, platform, source, store_id, bundle_id, version, url, manifest, auto_install, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [name, platform, source, store, bundle, version, url, manifest ? JSON.stringify(manifest) : null, v.auto_install === true, me.email],
  );
  await audit(me.email, "mdm.app.create", row.id, { name, platform, source });
  return row;
}

export async function updateApp(me: Me, id: string, v: Record<string, unknown>): Promise<void> {
  const [a] = await q<{ id: string }>(`UPDATE mdm_apps SET auto_install = $2 WHERE id = $1 RETURNING id`, [uuid(id, "app"), v.auto_install === true]);
  if (!a) throw new UserError("No such app", 404);
  await audit(me.email, "mdm.app.update", id, { auto_install: v.auto_install === true });
}

export async function deleteApp(me: Me, id: string): Promise<void> {
  const [a] = await q<{ name: string }>(`DELETE FROM mdm_apps WHERE id = $1 RETURNING name`, [uuid(id, "app")]);
  if (!a) throw new UserError("No such app", 404);
  await audit(me.email, "mdm.app.delete", id, { name: a.name });
}

async function installAppOn(a: AppRow, ids: string[], actor: string): Promise<string> {
  const command = a.source === "app_store"
    // ManagementFlags 1: the app is removed when the device leaves management.
    ? { RequestType: "InstallApplication", iTunesStoreID: Number(a.store_id), ManagementFlags: 1 }
    : { RequestType: "InstallEnterpriseApplication", Manifest: a.manifest as never };
  return send(ids, command, `Install ${a.name}`, actor, { app_id: a.id });
}

/** Installs an app on chosen devices, or on every enrolled device of its platform. */
export async function installApp(me: Me, id: string, v: { devices?: unknown; all?: unknown }): Promise<{ devices: number }> {
  const [a] = await q<AppRow>(`SELECT * FROM mdm_apps WHERE id = $1`, [uuid(id, "app")]);
  if (!a) throw new UserError("No such app", 404);
  const deviceIds = Array.isArray(v.devices) ? v.devices.map((d) => uuid(d, "device")) : null;
  if (!deviceIds && v.all !== true) throw new UserError("Choose devices, or all devices");
  // People may install catalog apps on their own devices, as in a company portal; admins on any.
  const rows = await q<{ id: string }>(
    `SELECT e.id FROM mdm_enrollments e JOIN devices d ON d.id = e.device_id
     WHERE e.status = 'enrolled' AND e.platform = $1 AND d.retired_at IS NULL AND ($2::uuid[] IS NULL OR e.device_id = ANY($2)) AND ($3 OR d.owner = $4)`,
    [a.platform, deviceIds, me.role === "admin", me.email],
  );
  if (!rows.length) throw new UserError(`No enrolled ${a.platform === "darwin" ? "Mac" : "iPhone or iPad"} to install it on`);
  if (v.all === true && me.role !== "admin") throw new UserError("Only device admins can install on every device", 403);
  await installAppOn(a, rows.map((r) => r.id), me.email);
  await audit(me.email, "mdm.app.install", a.id, { name: a.name, devices: rows.length });
  return { devices: rows.length };
}
