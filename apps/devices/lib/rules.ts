import type { Platform } from "./queries";

/** osquery platforms plus iPhone and iPad (ios), which report through Apple MDM. */
export type DevicePlatform = Platform | "ios";
import { UserError } from "./util";

/**
 * Compliance policies, like Intune's: a policy is a set of rules for some platforms (or all), and a
 * device is compliant when every rule of every policy that applies to it passes.
 *
 * Each rule answers pass, fail or unknown. Unknown means the device has not reported that setting
 * (or its platform can't): it is never counted as a pass, but it doesn't make the device
 * non-compliant either. A device with a failing rule is non-compliant; one with no failures and
 * something unknown is "unknown"; only a device where everything was measured and passed is compliant.
 * A rule its platform can't report at all (screen lock on Linux) is left out for that platform.
 */

export type Rule =
  | { check: "disk_encryption" }
  | { check: "firewall" }
  | { check: "antivirus" }
  | { check: "screen_lock" }
  | { check: "system_protection" }
  | { check: "auto_update" }
  | { check: "os_min_version"; version: string }
  | { check: "checked_in"; days: number }
  | { check: "max_admins"; count: number }
  | { check: "max_vulnerabilities"; severity: "critical" | "high"; count: number }
  | { check: "no_open_alerts"; severity: "high" | "critical" };

export type RuleCheck = Rule["check"];

export const RULES: { check: RuleCheck; label: string; describe: string; platforms: DevicePlatform[] }[] = [
  { check: "disk_encryption", label: "Disk encryption", describe: "BitLocker on C:, FileVault, an encrypted root volume on Linux, or data protection on with a passcode on iPhone and iPad.", platforms: ["windows", "darwin", "linux", "ios"] },
  { check: "firewall", label: "Firewall on", describe: "Windows Firewall, the macOS application firewall, or ufw, firewalld or nftables running.", platforms: ["windows", "darwin", "linux"] },
  { check: "antivirus", label: "Antivirus running", describe: "Windows Security reports antivirus as good; on Linux a known scanner is running (ClamAV, Defender, Falcon).", platforms: ["windows", "linux"] },
  { check: "screen_lock", label: "Screen lock", describe: "A password is needed after the screen saver or a period of inactivity; on iPhone and iPad, a passcode is set.", platforms: ["windows", "darwin", "ios"] },
  { check: "system_protection", label: "System protection", describe: "System Integrity Protection and Gatekeeper on (macOS), User Account Control on (Windows).", platforms: ["windows", "darwin"] },
  { check: "auto_update", label: "Automatic updates", describe: "Windows Security reports automatic updates as good.", platforms: ["windows"] },
  { check: "os_min_version", label: "Minimum OS version", describe: "The operating system is at least this version.", platforms: ["windows", "darwin", "linux", "ios"] },
  { check: "checked_in", label: "Checked in recently", describe: "The device reported to Devices within this many days.", platforms: ["windows", "darwin", "linux", "ios"] },
  { check: "max_admins", label: "Limit administrators", describe: "No more than this many local administrator accounts.", platforms: ["windows", "darwin", "linux"] },
  { check: "max_vulnerabilities", label: "Limit vulnerabilities", describe: "No more than this many known vulnerabilities at this severity or worse in installed packages.", platforms: ["linux"] },
  { check: "no_open_alerts", label: "No open threats", describe: "No unresolved security alert at this severity or worse.", platforms: ["windows", "darwin", "linux"] },
];

export type Outcome = "pass" | "fail" | "unknown";
export type RuleResult = { policy: string; check: RuleCheck; outcome: Outcome; detail: string };

/** What a rule looks at. Booleans are null when the device hasn't said. */
export type DeviceState = {
  platform: string;
  osVersion: string;
  lastSeen: Date;
  facts: Facts;
  vulns: Record<"critical" | "high" | "medium" | "low" | "unknown", number>;
  /** Open alerts at each severity. */
  alerts: Record<"critical" | "high" | "medium" | "low", number>;
  /** False until a package inventory has been checked against advisories. */
  vulnsChecked: boolean;
};

export type Facts = {
  disk_encryption?: boolean | null;
  firewall?: boolean | null;
  antivirus?: boolean | null;
  screen_lock?: boolean | null;
  system_protection?: boolean | null;
  auto_update?: boolean | null;
  admins?: string[];
  users?: string[];
  /** Where OSV files advisories for this Linux distribution, e.g. "Debian:12". */
  osv_ecosystem?: string;
};

export type PolicyLike = { id: string; name: string; platforms: string[]; rules: Rule[]; enabled: boolean };

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

/** "10.0.22631" vs "10.0.19045": numeric, part by part; text after the numbers is ignored. */
export function compareVersions(a: string, b: string): number {
  const nums = (v: string) => (v.match(/^\s*v?(\d+(?:\.\d+)*)/)?.[1] ?? "").split(".").filter(Boolean).map(Number);
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function bool(v: boolean | null | undefined, on: string, off: string): [Outcome, string] {
  if (v === true) return ["pass", on];
  if (v === false) return ["fail", off];
  return ["unknown", "Not reported by this device yet"];
}

export function evaluateRule(rule: Rule, d: DeviceState, now = new Date()): [Outcome, string] {
  const f = d.facts;
  switch (rule.check) {
    case "disk_encryption":
      return bool(f.disk_encryption, "Encrypted", "The system disk is not encrypted");
    case "firewall":
      return bool(f.firewall, "On", "The firewall is off");
    case "antivirus":
      return bool(f.antivirus, "Running", "No working antivirus");
    case "screen_lock":
      return bool(f.screen_lock, "On", "The screen doesn't lock with a password");
    case "system_protection":
      return bool(f.system_protection, "On", "System protection is turned off");
    case "auto_update":
      return bool(f.auto_update, "On", "Automatic updates are off");
    case "os_min_version": {
      if (!d.osVersion || !/\d/.test(d.osVersion)) return ["unknown", "Version not reported yet"];
      return compareVersions(d.osVersion, rule.version) >= 0
        ? ["pass", d.osVersion]
        : ["fail", `${d.osVersion} is older than ${rule.version}`];
    }
    case "checked_in": {
      const days = (now.getTime() - d.lastSeen.getTime()) / 86_400_000;
      return days <= rule.days ? ["pass", "Seen recently"] : ["fail", `Last seen ${Math.floor(days)} days ago`];
    }
    case "max_admins": {
      if (!f.admins) return ["unknown", "Administrators not reported yet"];
      return f.admins.length <= rule.count
        ? ["pass", `${f.admins.length} administrator${f.admins.length === 1 ? "" : "s"}`]
        : ["fail", `${f.admins.length} administrators (${f.admins.slice(0, 5).join(", ")}${f.admins.length > 5 ? ", …" : ""})`];
    }
    case "max_vulnerabilities": {
      if (!d.vulnsChecked) return ["unknown", "Installed packages not checked against advisories yet"];
      const n = SEVERITIES.slice(SEVERITIES.indexOf(rule.severity)).reduce((s, k) => s + (d.vulns[k] ?? 0), 0);
      return n <= rule.count ? ["pass", `${n} ${rule.severity} or worse`] : ["fail", `${n} ${rule.severity} or worse vulnerabilities`];
    }
    case "no_open_alerts": {
      const n = SEVERITIES.slice(SEVERITIES.indexOf(rule.severity)).reduce((s, k) => s + (d.alerts[k as keyof DeviceState["alerts"]] ?? 0), 0);
      return n === 0 ? ["pass", "None open"] : ["fail", `${n} open ${rule.severity} or worse alert${n === 1 ? "" : "s"}`];
    }
  }
}

export function applies(p: PolicyLike, platform: string): boolean {
  return p.enabled && (p.platforms.length === 0 || p.platforms.includes(platform));
}

export function evaluate(policies: PolicyLike[], d: DeviceState, now = new Date()): { state: "compliant" | "noncompliant" | "unknown"; results: RuleResult[] } {
  const results: RuleResult[] = [];
  for (const p of policies) {
    if (!applies(p, d.platform)) continue;
    for (const r of p.rules) {
      // A check the platform can't report (screen lock on Linux) doesn't apply there.
      if (!RULES.find((x) => x.check === r.check)?.platforms.includes(d.platform as DevicePlatform)) continue;
      const [outcome, detail] = evaluateRule(r, d, now);
      results.push({ policy: p.name, check: r.check, outcome, detail });
    }
  }
  const state = results.some((r) => r.outcome === "fail")
    ? "noncompliant"
    : results.length === 0 || results.some((r) => r.outcome === "unknown")
      ? "unknown"
      : "compliant";
  return { state, results };
}

/** Checks rules sent from the browser. */
export function parseRules(v: unknown): Rule[] {
  if (!Array.isArray(v)) throw new UserError("rules must be a list");
  if (v.length > 30) throw new UserError("A policy can have at most 30 rules");
  return v.map((raw): Rule => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const n = (k: string, min: number, max: number) => {
      const x = Number(r[k]);
      if (!Number.isInteger(x) || x < min || x > max) throw new UserError(`${k} must be a whole number from ${min} to ${max}`);
      return x;
    };
    switch (r.check) {
      case "disk_encryption":
      case "firewall":
      case "antivirus":
      case "screen_lock":
      case "system_protection":
      case "auto_update":
        return { check: r.check };
      case "os_min_version": {
        const version = String(r.version ?? "").trim();
        if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new UserError("Minimum OS version must look like 14.0 or 10.0.22631");
        return { check: "os_min_version", version };
      }
      case "checked_in":
        return { check: "checked_in", days: n("days", 1, 365) };
      case "max_admins":
        return { check: "max_admins", count: n("count", 0, 100) };
      case "max_vulnerabilities": {
        if (r.severity !== "critical" && r.severity !== "high") throw new UserError("severity must be critical or high");
        return { check: "max_vulnerabilities", severity: r.severity, count: n("count", 0, 10_000) };
      }
      case "no_open_alerts": {
        if (r.severity !== "critical" && r.severity !== "high") throw new UserError("severity must be critical or high");
        return { check: "no_open_alerts", severity: r.severity };
      }
      default:
        throw new UserError(`Unknown rule ${String(r.check)}`);
    }
  });
}

/** A sensible starting policy, offered on an empty Compliance page. */
export const BASELINE: { name: string; description: string; platforms: DevicePlatform[]; rules: Rule[] } = {
  name: "Security baseline",
  description: "Encrypted, firewalled, locked when idle, reporting in, and free of open high-severity threats.",
  platforms: [],
  rules: [
    { check: "disk_encryption" },
    { check: "firewall" },
    { check: "screen_lock" },
    { check: "checked_in", days: 14 },
    { check: "no_open_alerts", severity: "high" },
  ],
};
