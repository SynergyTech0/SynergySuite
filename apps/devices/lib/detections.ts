import type { Row } from "./facts";
import { sha256 } from "./util";

/**
 * Endpoint detections, the Defender side of Devices. Each turns a row osquery reported into an
 * alert, or nothing. Changes (a new listening port, a new startup item, a new SSH key) only count
 * after the device's baseline: the first run of a differential query lists everything already
 * there, which is not news. States that are suspicious however long they've been true (a program
 * running from a temporary folder, a known-bad file) are raised from the first report.
 */

export type Severity = "low" | "medium" | "high" | "critical";

export type AlertDraft = {
  detection: string;
  severity: Severity;
  title: string;
  detail: Record<string, unknown>;
  /** The same thing seen again while the alert is open counts as another occurrence, not a new alert. */
  fingerprint: string;
};

export type DetectionInfo = { id: string; title: string; severity: Severity; describe: string; afterBaseline: boolean };

export const DETECTIONS: DetectionInfo[] = [
  { id: "listening", title: "New program listening on the network", severity: "medium", afterBaseline: true,
    describe: "A program started accepting connections from other machines. Expected for servers and some apps; unexpected listeners are how remote access tools and backdoors get in." },
  { id: "startup", title: "New program set to start automatically", severity: "medium", afterBaseline: true,
    describe: "Something added itself to startup items, launch agents, cron or systemd. Persistence is the first thing most malware sets up." },
  { id: "temp_exec", title: "Program running from a temporary folder", severity: "high", afterBaseline: false,
    describe: "A program is running from /tmp, a Temp folder or the Recycle Bin. Installers do this briefly; droppers and ransomware do it too." },
  { id: "deleted_binary", title: "Program running after its file was deleted", severity: "medium", afterBaseline: true,
    describe: "A running program's file is gone from disk. Package upgrades cause this until a restart; malware does it to hide." },
  { id: "ssh_keys", title: "New SSH key can sign in", severity: "medium", afterBaseline: true,
    describe: "A key was added to a user's authorized_keys, so whoever holds it can sign in without a password." },
  { id: "indicator", title: "Known malicious program running", severity: "critical", afterBaseline: false,
    describe: "A running program's SHA-256 matches one of your indicators." },
  { id: "new_admin", title: "New administrator account", severity: "high", afterBaseline: false,
    describe: "An account joined the local administrators group." },
  { id: "posture_disk_encryption", title: "Disk encryption was turned off", severity: "high", afterBaseline: false,
    describe: "BitLocker, FileVault or the encrypted root volume went from on to off." },
  { id: "posture_firewall", title: "The firewall was turned off", severity: "medium", afterBaseline: false,
    describe: "The device's firewall went from on to off." },
  { id: "posture_antivirus", title: "Antivirus was turned off", severity: "high", afterBaseline: false,
    describe: "Antivirus went from working to not." },
  { id: "posture_system_protection", title: "System protection was turned off", severity: "high", afterBaseline: false,
    describe: "System Integrity Protection, Gatekeeper or User Account Control went from on to off." },
];

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const fp = (...parts: unknown[]) => sha256(parts.map(s).join("\u0000")).slice(0, 32);

/** Common, expected listeners that would otherwise raise an alert on every new laptop. */
const QUIET_LISTENERS = /^(mdnsresponder|rapportd|controlcenter|sharingd|spoolsv|svchost|lsass|wininit|services|system|systemd-resolved|avahi-daemon|cupsd|chronyd|ntpd|dhclient|systemd-networkd|osqueryd)(\.exe)?$/i;

export function detectionFor(queryId: string): string | null {
  if (queryId.startsWith("startup_")) return "startup";
  if (["listening", "temp_exec", "deleted_binary", "ssh_keys"].includes(queryId)) return queryId;
  return null;
}

/** Alerts from rows osquery reported as added by a differential detection query. */
export function detect(queryId: string, rows: Row[], opts: { baseline: boolean }): AlertDraft[] {
  const id = detectionFor(queryId);
  if (!id) return [];
  const info = DETECTIONS.find((d) => d.id === id)!;
  if (opts.baseline && info.afterBaseline) return [];
  const out: AlertDraft[] = [];
  for (const r of rows) {
    switch (id) {
      case "listening": {
        if (QUIET_LISTENERS.test(s(r.name))) continue;
        const proto = s(r.protocol) === "17" ? "UDP" : s(r.protocol) === "6" ? "TCP" : `protocol ${s(r.protocol)}`;
        out.push({ detection: id, severity: info.severity, title: `${s(r.name) || "A program"} is listening on ${proto} port ${s(r.port)}`,
          detail: { name: r.name, path: r.path, port: r.port, protocol: proto }, fingerprint: fp(id, r.path, r.port, r.protocol) });
        break;
      }
      case "startup":
        out.push({ detection: id, severity: info.severity, title: `${s(r.name) || s(r.path)} was set to start automatically`,
          detail: { name: r.name, path: r.path, args: r.args, source: r.source, username: r.username }, fingerprint: fp(id, r.name, r.path, r.source) });
        break;
      case "temp_exec":
        out.push({ detection: id, severity: info.severity, title: `${s(r.name)} is running from a temporary folder`,
          detail: { name: r.name, path: r.path, cmdline: r.cmdline }, fingerprint: fp(id, r.path) });
        break;
      case "deleted_binary":
        out.push({ detection: id, severity: info.severity, title: `${s(r.name)} is running but its file was deleted`,
          detail: { name: r.name, path: r.path, cmdline: r.cmdline }, fingerprint: fp(id, r.path) });
        break;
      case "ssh_keys":
        out.push({ detection: id, severity: info.severity, title: `New SSH key for ${s(r.username)}`,
          // The key itself is public, but long; keep a fingerprint of it, not the whole thing.
          detail: { username: r.username, key_file: r.key_file, algorithm: r.algorithm, key_sha256: sha256(s(r.key)).slice(0, 16) },
          fingerprint: fp(id, r.username, r.key) });
        break;
    }
  }
  return out;
}

/** Running programs whose SHA-256 is a known-bad indicator. */
export function matchIndicators(rows: Row[], indicators: Map<string, string>): AlertDraft[] {
  if (!indicators.size) return [];
  const out: AlertDraft[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const hash = s(r.sha256).toLowerCase();
    const title = indicators.get(hash);
    if (!title || seen.has(`${hash}${s(r.path)}`)) continue;
    seen.add(`${hash}${s(r.path)}`);
    out.push({ detection: "indicator", severity: "critical", title: `Known malicious program running: ${title}`,
      detail: { name: r.name, path: r.path, sha256: hash, indicator: title }, fingerprint: fp("indicator", hash, r.path) });
  }
  return out;
}
