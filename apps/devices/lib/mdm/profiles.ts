import { randomUUID } from "node:crypto";
import { UserError } from "../util";
import { type PlistValue, PlistInteger, PlistError, buildPlist, dict, parsePlist, str } from "./plist";

/**
 * Configuration profiles (.mobileconfig): the enrollment profile that puts an iPhone, iPad or Mac
 * under management, and the settings profiles admins push afterwards. Each settings kind is a form
 * in the app that becomes one Apple payload; "custom" takes a profile made elsewhere (Apple
 * Configurator, iMazing Profile Editor) as it is.
 */

export const ID_PREFIX = "cloud.synergy.devices";
/** The enrollment profile's identifier. Removing the profile with this identifier ends management. */
export const MDM_PROFILE_ID = `${ID_PREFIX}.mdm`;

export type ApplePlatform = "darwin" | "ios";
/** Where a settings profile or app can go: Apple devices through MDM, Android through Google, Windows through OMA-DM. */
export type MdmPlatform = ApplePlatform | "android" | "windows";

type Profile = { identifier: string; name: string; description: string; organization: string; payloads: Record<string, PlistValue>[]; removable?: boolean };

/** Wraps payloads into a profile document. */
export function profileDocument(p: Profile): string {
  return buildPlist({
    PayloadType: "Configuration",
    PayloadVersion: new PlistInteger(1),
    PayloadIdentifier: p.identifier,
    PayloadUUID: randomUUID().toUpperCase(),
    PayloadDisplayName: p.name,
    PayloadDescription: p.description,
    PayloadOrganization: p.organization,
    PayloadScope: "System",
    PayloadRemovalDisallowed: p.removable === false ? true : undefined,
    PayloadContent: p.payloads,
  });
}

function payload(type: string, identifier: string, name: string, body: Record<string, PlistValue | undefined>): Record<string, PlistValue> {
  const out: Record<string, PlistValue> = {
    PayloadType: type,
    PayloadVersion: 1,
    PayloadIdentifier: identifier,
    PayloadUUID: randomUUID().toUpperCase(),
    PayloadDisplayName: name,
  };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) out[k] = v;
  return out;
}

export type EnrollmentOptions = {
  /** https://devices.example.com — where /mdm/apple/mdm and /scep are served. */
  base: string;
  /** APNs topic of the push certificate (com.apple.mgmt.External.…). */
  topic: string;
  /** SCEP challenge password. */
  challenge: string;
  /** Ties the enrollment to its owner; comes back with every MDM request. */
  token: string;
  organization: string;
  /** Private CA certificate (PEM) when the server's TLS certificate isn't publicly trusted. */
  caPem?: string;
};

/**
 * The enrollment profile: a SCEP payload that gets the device an identity certificate from
 * Devices' certificate authority, and the MDM payload that uses it to check in.
 */
export function enrollmentProfile(o: EnrollmentOptions): string {
  const scepId = randomUUID().toUpperCase();
  const url = `${o.base}/mdm/apple/mdm?enroll=${encodeURIComponent(o.token)}`;
  const payloads: Record<string, PlistValue>[] = [];
  if (o.caPem) {
    const der = Buffer.from(o.caPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
    payloads.push(payload("com.apple.security.root", `${ID_PREFIX}.mdm.ca`, "Server certificate authority", { PayloadContent: der }));
  }
  const scep = payload("com.apple.security.scep", `${ID_PREFIX}.mdm.scep`, "Device identity", {
    PayloadContent: {
      URL: `${o.base}/scep`,
      Challenge: o.challenge,
      Keysize: 2048,
      KeyType: "RSA",
      // 1 = signing, 4 = encryption.
      KeyUsage: 5,
      Subject: [[["CN", "Synergy Devices identity"]]],
    } as unknown as PlistValue,
  });
  scep.PayloadUUID = scepId;
  payloads.push(scep);
  payloads.push(
    payload("com.apple.mdm", `${ID_PREFIX}.mdm.payload`, "Device management", {
      IdentityCertificateUUID: scepId,
      Topic: o.topic,
      ServerURL: url,
      CheckInURL: url,
      // The device signs each request with its identity certificate (Mdm-Signature header),
      // which NanoMDM verifies; that keeps working behind a TLS-terminating proxy.
      SignMessage: true,
      CheckOutWhenRemoved: true,
      // Everything: profiles, apps, device info, security info, network info, restrictions,
      // lock, erase, settings, app management.
      AccessRights: 8191,
      ServerCapabilities: ["com.apple.mdm.per-user-connections", "com.apple.mdm.bootstraptoken"],
    }),
  );
  return profileDocument({
    identifier: MDM_PROFILE_ID,
    name: `${o.organization} device management`,
    description: `Lets ${o.organization} keep this device secure: check its settings, install apps and settings, and lock or erase it if it is lost.`,
    organization: o.organization,
    payloads,
  });
}

/* ---------------------------------------------------------------- settings profiles */

export type ProfileKind = "passcode" | "filevault" | "firewall" | "software_update" | "wifi" | "restrictions" | "custom";

export const PROFILE_KINDS: { kind: ProfileKind; label: string; describe: string; platforms: MdmPlatform[] }[] = [
  { kind: "passcode", label: "Passcode", describe: "Require a passcode or password, its length and how soon the screen locks.", platforms: ["darwin", "ios", "android", "windows"] },
  { kind: "filevault", label: "Disk encryption", describe: "Turn on FileVault (at the next sign-in on a Mac) or BitLocker (Windows).", platforms: ["darwin", "windows"] },
  { kind: "firewall", label: "Firewall", describe: "Turn on the macOS or Windows firewall, optionally blocking all incoming connections.", platforms: ["darwin", "windows"] },
  { kind: "software_update", label: "Software updates", describe: "Download and install macOS or Windows updates automatically.", platforms: ["darwin", "windows"] },
  { kind: "wifi", label: "Wi-Fi", describe: "Add a Wi-Fi network so devices join it without typing the password.", platforms: ["darwin", "ios", "android", "windows"] },
  { kind: "restrictions", label: "Restrictions", describe: "Turn off the camera or screenshots, and require encrypted backups (Apple). Windows applies the camera setting only.", platforms: ["darwin", "ios", "android", "windows"] },
  { kind: "custom", label: "Custom profile", describe: "Upload a .mobileconfig made with Apple Configurator or iMazing Profile Editor.", platforms: ["darwin", "ios"] },
];

export type Settings = Record<string, unknown>;

const int = (v: unknown, lo: number, hi: number, label: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new UserError(`${label} must be a whole number from ${lo} to ${hi}`);
  return n;
};
const flag = (v: unknown): boolean => v === true || v === "true" || v === 1;

/** Checks and normalizes the settings of one kind; throws UserError for anything invalid. */
export function cleanSettings(kind: ProfileKind, s: Settings): Settings {
  switch (kind) {
    case "passcode":
      return {
        min_length: int(s.min_length, 4, 16, "Minimum length") ?? 6,
        require_alphanumeric: flag(s.require_alphanumeric),
        max_inactivity_minutes: int(s.max_inactivity_minutes, 1, 60, "Lock after") ?? 5,
        max_failed_attempts: int(s.max_failed_attempts, 2, 11, "Failed attempts before erase or lockout"),
        max_age_days: int(s.max_age_days, 1, 730, "Passcode age"),
      };
    case "filevault":
      return { show_recovery_key: s.show_recovery_key === undefined ? true : flag(s.show_recovery_key) };
    case "firewall":
      return { block_all_incoming: flag(s.block_all_incoming), stealth: flag(s.stealth) };
    case "software_update":
      return { install_os_updates: s.install_os_updates === undefined ? true : flag(s.install_os_updates) };
    case "wifi": {
      const ssid = String(s.ssid ?? "").trim();
      if (!ssid || ssid.length > 32) throw new UserError("Enter the network name (up to 32 characters)");
      const security = ["WPA", "WPA3", "None"].includes(String(s.security)) ? String(s.security) : "WPA";
      const password = String(s.password ?? "");
      if (security !== "None" && (password.length < 8 || password.length > 63)) throw new UserError("A WPA password is 8 to 63 characters");
      return { ssid, security, password: security === "None" ? "" : password, hidden: flag(s.hidden), auto_join: s.auto_join === undefined ? true : flag(s.auto_join) };
    }
    case "restrictions":
      return { no_camera: flag(s.no_camera), no_screenshots: flag(s.no_screenshots), encrypted_backups: flag(s.encrypted_backups) };
    case "custom": {
      const xml = String(s.mobileconfig ?? "");
      if (!xml.trim()) throw new UserError("Choose a .mobileconfig file");
      if (xml.length > 1_000_000) throw new UserError("That profile is too large");
      if (xml.includes("<?xml") === false && xml.includes("<plist") === false) {
        throw new UserError("That isn't an unsigned .mobileconfig. Signed profiles can't be changed; export it unsigned.");
      }
      let doc: Record<string, PlistValue>;
      try {
        doc = dict(parsePlist(xml));
      } catch (e) {
        throw new UserError(e instanceof PlistError ? `That profile can't be read: ${e.message}` : "That profile can't be read");
      }
      if (str(doc.PayloadType) !== "Configuration" || !Array.isArray(doc.PayloadContent)) throw new UserError("That isn't a configuration profile");
      if ((doc.PayloadContent as PlistValue[]).some((p) => str(dict(p).PayloadType) === "com.apple.mdm")) {
        throw new UserError("Enrollment profiles can't be pushed as settings");
      }
      return { mobileconfig: xml, payload_types: (doc.PayloadContent as PlistValue[]).map((p) => str(dict(p).PayloadType)).filter(Boolean) };
    }
  }
}

/** The payloads for one settings profile (custom profiles keep their own). */
function payloadsFor(kind: Exclude<ProfileKind, "custom">, s: Settings, id: string, name: string): Record<string, PlistValue>[] {
  const pid = `${id}.payload`;
  switch (kind) {
    case "passcode":
      return [payload("com.apple.mobiledevice.passwordpolicy", pid, name, {
        forcePIN: true,
        allowSimple: false,
        minLength: s.min_length as number,
        requireAlphanumeric: s.require_alphanumeric as boolean,
        maxInactivity: s.max_inactivity_minutes as number,
        maxGracePeriod: 0,
        maxFailedAttempts: s.max_failed_attempts as number | undefined,
        maxPINAgeInDays: s.max_age_days as number | undefined,
      })];
    case "filevault":
      return [payload("com.apple.MCX.FileVault2", pid, name, {
        Enable: "On",
        Defer: true,
        DeferForceAtUserLoginMaxBypassAttempts: 0,
        ShowRecoveryKey: s.show_recovery_key as boolean,
        UseRecoveryKey: true,
      })];
    case "firewall":
      return [payload("com.apple.security.firewall", pid, name, {
        EnableFirewall: true,
        BlockAllIncoming: s.block_all_incoming as boolean,
        EnableStealthMode: s.stealth as boolean,
      })];
    case "software_update":
      return [payload("com.apple.SoftwareUpdate", pid, name, {
        AutomaticCheckEnabled: true,
        AutomaticDownload: true,
        CriticalUpdateInstall: true,
        ConfigDataInstall: true,
        AutomaticallyInstallMacOSUpdates: s.install_os_updates as boolean,
        AutomaticallyInstallAppUpdates: true,
      })];
    case "wifi":
      return [payload("com.apple.wifi.managed", pid, name, {
        SSID_STR: s.ssid as string,
        HIDDEN_NETWORK: s.hidden as boolean,
        AutoJoin: s.auto_join as boolean,
        EncryptionType: s.security === "None" ? "None" : s.security === "WPA3" ? "WPA3" : "WPA",
        Password: s.security === "None" ? undefined : (s.password as string),
      })];
    case "restrictions":
      return [payload("com.apple.applicationaccess", pid, name, {
        allowCamera: s.no_camera ? false : undefined,
        allowScreenShot: s.no_screenshots ? false : undefined,
        forceEncryptedBackup: s.encrypted_backups ? true : undefined,
      })];
  }
}

/** The profile document pushed to devices for a stored settings profile. */
export function settingsProfile(p: { id: string; name: string; description: string; kind: ProfileKind; settings: Settings; organization: string }): { identifier: string; xml: string } {
  const identifier = profileIdentifier(p.id);
  if (p.kind === "custom") {
    // A custom profile goes out under our identifier, so it can be replaced and removed like the others.
    const doc = dict(parsePlist(String(p.settings.mobileconfig)));
    doc.PayloadIdentifier = identifier;
    doc.PayloadUUID = randomUUID().toUpperCase();
    doc.PayloadDisplayName = p.name;
    return { identifier, xml: buildPlist(doc) };
  }
  return {
    identifier,
    xml: profileDocument({
      identifier,
      name: p.name,
      description: p.description || PROFILE_KINDS.find((k) => k.kind === p.kind)!.describe,
      organization: p.organization,
      payloads: payloadsFor(p.kind, p.settings, identifier, p.name),
      removable: false,
    }),
  };
}

export const profileIdentifier = (id: string) => `${ID_PREFIX}.profile.${id}`;
