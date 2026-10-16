import { appUrl } from "@synergy/config";
import { audit, q } from "./db";
import type { Platform } from "./queries";
import { secret, sha256, text, UserError, uuid } from "./util";

/**
 * Enrollment: a device joins by running osquery with an enroll secret. A personal secret (made on
 * My devices) makes the devices that use it belong to that person, like enrolling through Intune's
 * Company Portal. An organization secret (admins) is for deploying to many machines at once; those
 * devices start without an owner. Secrets are shown once and stored as hashes.
 */

export type SecretRow = {
  id: string; name: string; owner: string | null; created_by: string; created_at: Date;
  last_used_at: Date | null; revoked_at: Date | null; devices: number;
};

export async function listSecrets(owner?: string): Promise<SecretRow[]> {
  return q<SecretRow>(
    `SELECT s.id, s.name, s.owner, s.created_by, s.created_at, s.last_used_at, s.revoked_at,
       (SELECT count(*)::int FROM devices d WHERE d.enroll_secret_id = s.id AND d.retired_at IS NULL) AS devices
     FROM enroll_secrets s WHERE ($1::text IS NULL OR s.owner = $1) ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC`,
    [owner ?? null],
  );
}

export async function createSecret(actor: string, v: { name?: unknown; personal: boolean }): Promise<{ id: string; secret: string; package: EnrollPackage }> {
  const name = text(v.name, 120) || (v.personal ? `Personal enrollment for ${actor}` : "Organization enrollment");
  if (v.personal) {
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM enroll_secrets WHERE owner = $1 AND revoked_at IS NULL`, [actor]);
    if (n >= 10) throw new UserError("You have 10 enrollment keys already; revoke one you no longer use");
  }
  const value = secret();
  const [row] = await q<{ id: string }>(
    `INSERT INTO enroll_secrets (name, secret_hash, owner, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, sha256(value), v.personal ? actor : null, actor],
  );
  await audit(actor, "enroll.create", row.id, { name, personal: v.personal });
  return { id: row.id, secret: value, package: enrollPackage(value) };
}

/** Revoking stops new enrollments with the secret; devices already enrolled keep reporting. */
export async function revokeSecret(actor: string, id: string, admin: boolean): Promise<void> {
  const [row] = await q<{ id: string }>(
    `UPDATE enroll_secrets SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL AND ($2 OR owner = $3) RETURNING id`,
    [uuid(id, "enrollment key"), admin, actor],
  );
  if (!row) throw new UserError("No such enrollment key", 404);
  await audit(actor, "enroll.revoke", id);
}

/** Where osquery reaches Devices: devices.<SUITE_DOMAIN>, or DEVICES_PUBLIC_HOST (host[:port]). */
export function serverHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DEVICES_PUBLIC_HOST) return env.DEVICES_PUBLIC_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return new URL(appUrl("devices", env)).host;
}

export function flags(secretPath: string, certsPath: string | null, env: NodeJS.ProcessEnv = process.env): string {
  return [
    `--tls_hostname=${serverHost(env)}`,
    certsPath ? `--tls_server_certs=${certsPath}` : "# --tls_server_certs=<the CA bundle osquery should trust for this server>",
    "--host_identifier=uuid",
    `--enroll_secret_path=${secretPath}`,
    "--enroll_tls_endpoint=/api/osquery/enroll",
    "--config_plugin=tls",
    "--config_tls_endpoint=/api/osquery/config",
    "--config_refresh=300",
    "--logger_plugin=tls",
    "--logger_tls_endpoint=/api/osquery/log",
    "--logger_tls_period=60",
    "--logger_tls_compress=true",
    "--disable_distributed=false",
    "--distributed_plugin=tls",
    "--distributed_interval=30",
    "--distributed_tls_max_attempts=3",
    "--distributed_tls_read_endpoint=/api/osquery/distributed/read",
    "--distributed_tls_write_endpoint=/api/osquery/distributed/write",
  ].join("\n");
}

const PATHS: Record<Platform, { dir: string; flags: string; secret: string; certs: string[] }> = {
  linux: { dir: "/etc/osquery", flags: "/etc/osquery/osquery.flags", secret: "/etc/osquery/enroll_secret", certs: ["/opt/osquery/share/osquery/certs/certs.pem"] },
  darwin: {
    dir: "/var/osquery", flags: "/var/osquery/osquery.flags", secret: "/var/osquery/enroll_secret",
    certs: ["/opt/osquery/share/osquery/certs/certs.pem", "/opt/osquery/lib/osquery.app/Contents/Resources/osquery/certs/certs.pem"],
  },
  windows: {
    dir: "C:\\Program Files\\osquery", flags: "C:\\Program Files\\osquery\\osquery.flags", secret: "C:\\Program Files\\osquery\\enroll_secret.txt",
    certs: ["C:\\Program Files\\osquery\\certs\\certs.pem"],
  },
};

export type EnrollPackage = { host: string; scripts: Record<Platform, { file: string; text: string }>; flags: string };

/**
 * One script per platform that writes the secret and flag file and (re)starts osquery. If
 * DEVICES_TLS_CA holds a PEM certificate (a private CA in front of Devices), the scripts install it
 * as the bundle osquery trusts; otherwise they point osquery at the public CA bundle it ships with.
 */
export function enrollPackage(value: string, env: NodeJS.ProcessEnv = process.env): EnrollPackage {
  const ca = (env.DEVICES_TLS_CA ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("enroll secrets are base64url");
  const sh = (p: Platform) => {
    const P = PATHS[p];
    const certs = ca ? `${P.dir}/synergy-ca.pem` : null;
    return [
      "#!/bin/sh",
      `# Enrolls this computer in Synergy Devices (${serverHost(env)}).`,
      "# Install osquery first (https://osquery.io/downloads), then run this as root.",
      "set -e",
      "umask 077",
      `mkdir -p ${P.dir}`,
      `printf '%s' '${value}' > ${P.secret}`,
      ...(ca ? [`cat > ${certs} <<'PEM'`, ca, "PEM"] : []),
      `cat > ${P.flags} <<'FLAGS'`,
      flags(P.secret, certs, env),
      "FLAGS",
      ...(ca ? [] : [
        `for c in ${P.certs.join(" ")}; do`,
        `  if [ -f "$c" ]; then sed -i.bak "s|^# --tls_server_certs=.*|--tls_server_certs=$c|" ${P.flags} && rm -f ${P.flags}.bak; break; fi`,
        "done",
      ]),
      ...(p === "linux"
        ? ["systemctl enable osqueryd", "systemctl restart osqueryd"]
        : [
            "PLIST=/Library/LaunchDaemons/io.osquery.agent.plist",
            "[ -f \"$PLIST\" ] || cp /var/osquery/io.osquery.agent.plist \"$PLIST\"",
            "launchctl unload \"$PLIST\" 2>/dev/null || true",
            "launchctl load -w \"$PLIST\"",
          ]),
      'echo "Enrolled. The device appears in Synergy Devices within a minute."',
      "",
    ].join("\n");
  };
  const W = PATHS.windows;
  const winCerts = ca ? `${W.dir}\\synergy-ca.pem` : null;
  const ps = [
    `# Enrolls this computer in Synergy Devices (${serverHost(env)}).`,
    "# Install osquery first (https://osquery.io/downloads), then run this in PowerShell as Administrator.",
    "$ErrorActionPreference = 'Stop'",
    `$dir = '${W.dir}'`,
    `Set-Content -Path '${W.secret}' -Value '${value}' -NoNewline -Encoding ascii`,
    `icacls '${W.secret}' /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:F' | Out-Null`,
    ...(ca ? [`Set-Content -Path '${winCerts}' -Encoding ascii -Value @'`, ca, "'@"] : []),
    "$flags = @'",
    flags(W.secret, winCerts, env),
    "'@",
    ...(ca ? [] : [`if (Test-Path '${W.certs[0]}') { $flags = $flags -replace '# --tls_server_certs=.*', '--tls_server_certs=${W.certs[0]}' }`]),
    `Set-Content -Path '${W.flags}' -Value $flags -Encoding ascii`,
    "if (-not (Get-Service osqueryd -ErrorAction SilentlyContinue)) {",
    `  & "$dir\\osqueryd\\osqueryd.exe" --install --flagfile "${W.flags}"`,
    "}",
    "Restart-Service osqueryd",
    "Write-Host 'Enrolled. The device appears in Synergy Devices within a minute.'",
    "",
  ].join("\r\n");
  return {
    host: serverHost(env),
    flags: flags("<path to the enroll secret file>", null, env),
    scripts: {
      linux: { file: "enroll-linux.sh", text: sh("linux") },
      darwin: { file: "enroll-macos.sh", text: sh("darwin") },
      windows: { file: "enroll-windows.ps1", text: ps },
    },
  };
}
