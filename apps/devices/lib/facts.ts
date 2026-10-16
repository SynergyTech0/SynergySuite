import type { Facts } from "./rules";
import { osvEcosystem } from "./vulns";

/**
 * Turns one snapshot of an inventory or posture query into what Devices stores: columns on the
 * device row, facts for compliance rules, or the installed software list. Pure, so it is tested
 * without osquery.
 */

export type Row = Record<string, string | number | null | undefined>;

export type DeviceColumns = Partial<{
  hostname: string;
  hardware_vendor: string;
  hardware_model: string;
  hardware_serial: string;
  cpu: string;
  memory_bytes: number;
  os_name: string;
  os_version: string;
  osquery_version: string;
}>;

export type SoftwareRow = { name: string; version: string; source: string; package: string };

export type Applied = { columns?: DeviceColumns; facts?: Facts; software?: { source: string; rows: SoftwareRow[] } };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const flag = (v: unknown): boolean | null => (s(v) === "1" ? true : s(v) === "0" ? false : null);

/** Windows Security Center words: Good is on, Poor and Snoozed are off, anything else unknown. */
function wsc(v: unknown): boolean | null {
  const w = s(v).toLowerCase();
  if (w === "good") return true;
  if (w === "poor" || w === "snoozed") return false;
  return null;
}

/** "openssl (3.0.11-1)" → "openssl": deb_packages gives the source package with its version when they differ. */
function sourcePackage(v: unknown): string {
  return s(v).replace(/\s*\(.*\)\s*$/, "");
}

export function applySnapshot(queryId: string, rows: Row[]): Applied | null {
  const first = rows[0] ?? {};
  switch (queryId) {
    case "system":
      if (!rows.length) return null;
      return {
        columns: {
          hostname: s(first.computer_name) || s(first.hostname),
          hardware_vendor: s(first.hardware_vendor),
          hardware_model: s(first.hardware_model),
          hardware_serial: s(first.hardware_serial),
          cpu: s(first.cpu_brand),
          ...(Number(first.physical_memory) > 0 ? { memory_bytes: Number(first.physical_memory) } : {}),
        },
      };
    case "os": {
      if (!rows.length) return null;
      const eco = osvEcosystem(s(first.name), s(first.major), s(first.minor));
      return {
        columns: { os_name: s(first.name), os_version: osVersion(first) },
        facts: eco ? { osv_ecosystem: eco } : {},
      };
    }
    case "agent":
      return rows.length ? { columns: { osquery_version: s(first.version) } } : null;
    case "users":
      return { facts: { users: [...new Set(rows.map((r) => s(r.user)).filter(Boolean))].sort() } };
    case "software_programs":
    case "software_apps":
    case "software_homebrew":
    case "software_deb":
    case "software_rpm": {
      const source = queryId.slice("software_".length);
      const seen = new Set<string>();
      const out: SoftwareRow[] = [];
      for (const r of rows) {
        const row = { name: s(r.name).slice(0, 300), version: s(r.version).slice(0, 100), source, package: sourcePackage(r.package).slice(0, 300) };
        const key = `${row.name}\u0000${row.version}`;
        if (!row.name || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
      return { software: { source, rows: out } };
    }
    case "encryption_windows":
    case "encryption_darwin":
    case "encryption_linux":
      return rows.length ? { facts: { disk_encryption: flag(first.encrypted) } } : null;
    case "security_center":
      if (!rows.length) return null;
      return {
        facts: {
          firewall: wsc(first.firewall),
          antivirus: wsc(first.antivirus),
          auto_update: wsc(first.autoupdate),
          system_protection: wsc(first.user_account_control),
        },
      };
    case "firewall_darwin":
    case "firewall_linux":
      return rows.length ? { facts: { firewall: flag(first.enabled) } } : null;
    case "protection_darwin": {
      if (!rows.length) return null;
      const sip = flag(first.sip);
      const gk = flag(first.gatekeeper);
      return { facts: { system_protection: sip === false || gk === false ? false : sip && gk ? true : null } };
    }
    case "antivirus_linux":
      return rows.length ? { facts: { antivirus: flag(first.running) } } : null;
    case "screenlock_darwin":
      // A grace period of more than five minutes before the password is asked is as good as none.
      if (!rows.length) return null;
      return { facts: { screen_lock: flag(first.enabled) === null ? null : flag(first.enabled) === true && Number(first.grace_period ?? 0) <= 300 } };
    case "screenlock_windows":
      return rows.length ? { facts: { screen_lock: flag(first.enabled) } } : null;
    case "admins_windows":
    case "admins_darwin":
    case "admins_linux":
      return { facts: { admins: [...new Set(rows.map((r) => s(r.username)).filter(Boolean))].sort() } };
    default:
      return null;
  }
}

/** "22.04.4 LTS (Jammy Jellyfish)" → "22.04.4 LTS"; "10.0.22631" stays; major.minor.patch when there's no version. */
export function osVersion(r: Row): string {
  const v = s(r.version).replace(/\s*\(.*\)\s*$/, "");
  return v || [s(r.major), s(r.minor), s(r.patch)].filter((x) => x !== "").join(".");
}

export type PostureChange = { detection: string; severity: "medium" | "high"; title: string; detail: Record<string, unknown> };

const TURNED_OFF: [keyof Facts, "medium" | "high", string][] = [
  ["disk_encryption", "high", "Disk encryption was turned off"],
  ["firewall", "medium", "The firewall was turned off"],
  ["antivirus", "high", "Antivirus was turned off"],
  ["system_protection", "high", "System protection was turned off"],
];

/** Security settings that went from on to off, and administrators who weren't there before. */
export function postureChanges(prev: Facts, next: Facts): PostureChange[] {
  const out: PostureChange[] = [];
  for (const [key, severity, title] of TURNED_OFF) {
    if (key in next && prev[key] === true && next[key] === false) out.push({ detection: `posture_${key}`, severity, title, detail: { setting: key } });
  }
  if (prev.admins && next.admins) {
    for (const user of next.admins.filter((u) => !prev.admins!.includes(u))) {
      out.push({ detection: "new_admin", severity: "high", title: `New administrator account: ${user}`, detail: { username: user } });
    }
  }
  return out;
}
