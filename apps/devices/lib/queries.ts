/**
 * What Devices asks osquery to run on every enrolled computer. osquery (https://osquery.io,
 * Apache-2.0 / GPL-2.0) is the agent: it answers SQL over the operating system's own state, and
 * this app is its TLS server (see lib/osquery.ts). Nothing here changes a device: every query reads.
 *
 *   inventory   hardware, operating system, installed software and who signs in
 *   posture     the settings compliance policies check: disk encryption, firewall, antivirus,
 *               screen lock, system protection, automatic updates, administrators
 *   detection   differential queries: osquery reports only rows that appeared since its last
 *               run, and each new row is a possible threat (see lib/detections.ts)
 *
 * Every query belongs to one platform (or all), so a Mac is never asked for the Windows registry.
 */

export type Platform = "windows" | "darwin" | "linux";
export const PLATFORMS: Platform[] = ["windows", "darwin", "linux"];
export const PLATFORM_LABEL: Record<Platform, string> = { windows: "Windows", darwin: "macOS", linux: "Linux" };

export type QueryDef = {
  /** Scheduled as synergy_<id>. */
  id: string;
  sql: string;
  /** Seconds between runs. */
  interval: number;
  platform: Platform | "all";
  kind: "snapshot" | "differential";
  purpose: "inventory" | "posture" | "detection";
};

const HOUR = 3600;

export const QUERIES: QueryDef[] = [
  // Inventory
  { id: "system", platform: "all", kind: "snapshot", purpose: "inventory", interval: HOUR,
    sql: "SELECT hostname, computer_name, uuid, hardware_vendor, hardware_model, hardware_serial, cpu_brand, physical_memory FROM system_info;" },
  { id: "os", platform: "all", kind: "snapshot", purpose: "inventory", interval: HOUR,
    sql: "SELECT name, version, major, minor, patch, build, platform FROM os_version;" },
  { id: "agent", platform: "all", kind: "snapshot", purpose: "inventory", interval: HOUR,
    sql: "SELECT version FROM osquery_info;" },
  { id: "users", platform: "all", kind: "snapshot", purpose: "inventory", interval: HOUR,
    sql: "SELECT DISTINCT user FROM logged_in_users WHERE user <> '' AND user NOT LIKE '%$';" },
  { id: "software_programs", platform: "windows", kind: "snapshot", purpose: "inventory", interval: 6 * HOUR,
    sql: "SELECT name, version, publisher FROM programs WHERE name <> '';" },
  { id: "software_apps", platform: "darwin", kind: "snapshot", purpose: "inventory", interval: 6 * HOUR,
    sql: "SELECT name, bundle_short_version AS version, bundle_identifier AS publisher FROM apps;" },
  { id: "software_homebrew", platform: "darwin", kind: "snapshot", purpose: "inventory", interval: 6 * HOUR,
    sql: "SELECT name, version, '' AS publisher FROM homebrew_packages;" },
  { id: "software_deb", platform: "linux", kind: "snapshot", purpose: "inventory", interval: 6 * HOUR,
    sql: "SELECT name, version, maintainer AS publisher, source AS package FROM deb_packages;" },
  { id: "software_rpm", platform: "linux", kind: "snapshot", purpose: "inventory", interval: 6 * HOUR,
    sql: "SELECT name, CASE WHEN epoch <> '' AND epoch <> '0' THEN epoch || ':' ELSE '' END || version || '-' || release AS version, vendor AS publisher, source AS package FROM rpm_packages;" },

  // Posture: each answers one row, with 1/0 columns or the platform's own status words.
  { id: "encryption_windows", platform: "windows", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM bitlocker_info WHERE drive_letter = 'C:' AND protection_status = 1) THEN 1 ELSE 0 END AS encrypted;" },
  { id: "encryption_darwin", platform: "darwin", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM disk_encryption WHERE user_uuid IS NOT '' AND filevault_status = 'on') THEN 1 ELSE 0 END AS encrypted;" },
  { id: "encryption_linux", platform: "linux", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM mounts m JOIN disk_encryption d ON d.name = m.device_alias WHERE m.path = '/' AND d.encrypted = 1) THEN 1 ELSE 0 END AS encrypted;" },
  { id: "security_center", platform: "windows", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT firewall, autoupdate, antivirus, user_account_control FROM windows_security_center;" },
  { id: "firewall_darwin", platform: "darwin", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN global_state IN (1, 2) THEN 1 ELSE 0 END AS enabled FROM alf;" },
  { id: "firewall_linux", platform: "linux", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM systemd_units WHERE id IN ('ufw.service', 'firewalld.service', 'nftables.service') AND active_state = 'active') THEN 1 ELSE 0 END AS enabled;" },
  { id: "protection_darwin", platform: "darwin", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT (SELECT enabled FROM sip_config WHERE config_flag = 'sip') AS sip, (SELECT assessments_enabled FROM gatekeeper) AS gatekeeper;" },
  { id: "antivirus_linux", platform: "linux", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM processes WHERE name IN ('clamd', 'freshclam', 'mdatp', 'wdavdaemon', 'falcon-sensor')) THEN 1 ELSE 0 END AS running;" },
  { id: "screenlock_darwin", platform: "darwin", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT enabled, grace_period FROM screenlock;" },
  { id: "screenlock_windows", platform: "windows", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM registry WHERE path LIKE 'HKEY_USERS\\%\\Control Panel\\Desktop\\ScreenSaverIsSecure' AND data = '1') OR EXISTS (SELECT 1 FROM registry WHERE path = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\InactivityTimeoutSecs' AND CAST(data AS INTEGER) > 0) THEN 1 ELSE 0 END AS enabled;" },
  { id: "admins_windows", platform: "windows", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT u.username FROM users u JOIN user_groups ug ON ug.uid = u.uid JOIN groups g ON g.gid = ug.gid WHERE g.groupname = 'Administrators';" },
  { id: "admins_darwin", platform: "darwin", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT u.username FROM users u JOIN user_groups ug ON ug.uid = u.uid JOIN groups g ON g.gid = ug.gid WHERE g.groupname = 'admin' AND u.username NOT LIKE '\\_%' ESCAPE '\\' AND u.username <> 'root';" },
  { id: "admins_linux", platform: "linux", kind: "snapshot", purpose: "posture", interval: HOUR,
    sql: "SELECT u.username FROM users u JOIN user_groups ug ON ug.uid = u.uid JOIN groups g ON g.gid = ug.gid WHERE g.groupname IN ('sudo', 'wheel', 'admin');" },

  // Detection: osquery logs only what is new since the previous run.
  { id: "listening", platform: "all", kind: "differential", purpose: "detection", interval: 600,
    sql: "SELECT DISTINCT p.name, p.path, lp.port, lp.protocol FROM listening_ports lp JOIN processes p ON p.pid = lp.pid WHERE lp.port <> 0 AND lp.address NOT IN ('127.0.0.1', '::1') AND lp.address NOT LIKE '127.%';" },
  { id: "startup_windows", platform: "windows", kind: "differential", purpose: "detection", interval: 900,
    sql: "SELECT name, path, args, source, username FROM startup_items;" },
  { id: "startup_darwin", platform: "darwin", kind: "differential", purpose: "detection", interval: 900,
    sql: "SELECT label AS name, program AS path, program_arguments AS args, path AS source FROM launchd WHERE run_at_load = '1' OR keep_alive = '1';" },
  { id: "startup_linux", platform: "linux", kind: "differential", purpose: "detection", interval: 900,
    sql: "SELECT command AS name, path AS source FROM crontab UNION SELECT id AS name, fragment_path AS source FROM systemd_units WHERE unit_file_state = 'enabled';" },
  { id: "temp_exec", platform: "all", kind: "differential", purpose: "detection", interval: 300,
    sql: "SELECT DISTINCT name, path, cmdline FROM processes WHERE path LIKE '/tmp/%' OR path LIKE '/var/tmp/%' OR path LIKE '/dev/shm/%' OR path LIKE '/private/tmp/%' OR lower(path) LIKE '%\\appdata\\local\\temp\\%' OR lower(path) LIKE 'c:\\windows\\temp\\%' OR lower(path) LIKE '%\\$recycle.bin\\%';" },
  { id: "deleted_binary", platform: "linux", kind: "differential", purpose: "detection", interval: 300,
    sql: "SELECT DISTINCT name, path, cmdline FROM processes WHERE on_disk = 0 AND path <> '' AND path NOT LIKE '/memfd:%' AND path NOT LIKE '%(deleted)%';" },
  { id: "ssh_keys", platform: "all", kind: "differential", purpose: "detection", interval: 900,
    sql: "SELECT u.username, ak.key_file, ak.algorithm, ak.key FROM users u CROSS JOIN authorized_keys ak USING (uid);" },
  // A full list each time, not a difference: a program already running when an indicator is added
  // must still be found.
  { id: "process_hashes", platform: "all", kind: "snapshot", purpose: "detection", interval: 900,
    sql: "SELECT DISTINCT p.name, p.path, h.sha256 FROM processes p JOIN hash h ON h.path = p.path WHERE p.path <> '';" },
];

export const QUERY_PREFIX = "synergy_";

export function scheduledName(q: QueryDef): string {
  return `${QUERY_PREFIX}${q.id}`;
}

export function queryByName(name: string): QueryDef | undefined {
  // Results from a pack arrive as pack_<pack>_<query>; this app schedules without packs.
  const id = name.startsWith(QUERY_PREFIX) ? name.slice(QUERY_PREFIX.length) : "";
  return QUERIES.find((q) => q.id === id);
}

export function queriesFor(platform: string): QueryDef[] {
  return QUERIES.filter((q) => q.platform === "all" || q.platform === platform);
}

/**
 * Our platform from what osquery says at enrollment (os_version.platform and platform_like).
 * BSDs and anything else Unix-like are treated as Linux: the Linux queries that need Linux-only
 * tables simply fail there and leave those checks unknown.
 */
export function platformOf(osPlatform: string | undefined, like?: string): Platform {
  const p = `${osPlatform ?? ""} ${like ?? ""}`.toLowerCase();
  if (p.includes("windows")) return "windows";
  if (p.includes("darwin") || p.includes("macos")) return "darwin";
  return "linux";
}

/** The osquery configuration this app serves to a device of `platform`. */
export function osqueryConfig(platform: Platform): Record<string, unknown> {
  const schedule: Record<string, Record<string, unknown>> = {};
  for (const q of queriesFor(platform)) {
    schedule[scheduledName(q)] = {
      query: q.sql,
      interval: q.interval,
      ...(q.platform === "all" ? {} : { platform: q.platform }),
      ...(q.kind === "snapshot" ? { snapshot: true } : { removed: false }),
    };
  }
  return {
    options: {
      // Live queries and "refresh now" are picked up this often (seconds).
      distributed_interval: 30,
      // Results are sent at least this often (seconds).
      logger_tls_period: 60,
    },
    schedule,
  };
}
