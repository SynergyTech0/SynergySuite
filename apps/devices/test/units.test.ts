import { describe, expect, it } from "vitest";
import { accessEnv, roleOf } from "../lib/access";
import { detect, matchIndicators } from "../lib/detections";
import { enrollPackage } from "../lib/enroll";
import { applySnapshot, postureChanges } from "../lib/facts";
import { normalizeResults } from "../lib/osquery";
import { QUERIES, osqueryConfig, platformOf, queriesFor } from "../lib/queries";
import { type DeviceState, BASELINE, compareVersions, evaluate, parseRules } from "../lib/rules";
import { advisoryOf, cvss3, osvEcosystem, queryOsv, severityOfScore } from "../lib/vulns";
import { checkSql } from "../lib/devices";

const state = (over: Partial<DeviceState> = {}): DeviceState => ({
  platform: "windows",
  osVersion: "10.0.22631",
  lastSeen: new Date("2026-10-16T12:00:00Z"),
  facts: { disk_encryption: true, firewall: true, screen_lock: true, antivirus: true, admins: ["shane"] },
  vulns: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
  alerts: { critical: 0, high: 0, medium: 0, low: 0 },
  vulnsChecked: true,
  ...over,
});
const now = new Date("2026-10-16T13:00:00Z");
const policy = (rules: unknown[], platforms: string[] = []) => ({ id: "p", name: "P", platforms, enabled: true, rules: parseRules(rules) });

describe("compliance rules", () => {
  it("passes a device that meets every rule", () => {
    expect(evaluate([policy(BASELINE.rules)], state(), now).state).toBe("compliant");
  });

  it("fails on any failing rule, and says which", () => {
    const r = evaluate([policy(BASELINE.rules)], state({ facts: { disk_encryption: false, firewall: true, screen_lock: true } }), now);
    expect(r.state).toBe("noncompliant");
    expect(r.results.find((x) => x.check === "disk_encryption")).toMatchObject({ outcome: "fail" });
  });

  it("never counts a setting the device hasn't reported as a pass", () => {
    const r = evaluate([policy([{ check: "firewall" }])], state({ facts: {} }), now);
    expect(r.state).toBe("unknown");
  });

  it("leaves out checks a platform can't report, so Linux isn't stuck on screen lock", () => {
    const r = evaluate([policy([{ check: "screen_lock" }, { check: "disk_encryption" }])], state({ platform: "linux", facts: { disk_encryption: true } }), now);
    expect(r.state).toBe("compliant");
    expect(r.results.map((x) => x.check)).toEqual(["disk_encryption"]);
  });

  it("applies a policy only to its platforms", () => {
    const r = evaluate([policy([{ check: "firewall" }], ["darwin"])], state({ facts: { firewall: false } }), now);
    expect(r.results).toEqual([]);
    expect(r.state).toBe("unknown");
  });

  it("checks OS versions, check-ins, admins, vulnerabilities and open alerts", () => {
    const p = policy([
      { check: "os_min_version", version: "10.0.22000" },
      { check: "checked_in", days: 7 },
      { check: "max_admins", count: 1 },
      { check: "max_vulnerabilities", severity: "high", count: 0 },
      { check: "no_open_alerts", severity: "high" },
    ]);
    expect(evaluate([p], state(), now).state).toBe("compliant");
    const bad = evaluate([p], state({
      osVersion: "10.0.19045",
      lastSeen: new Date("2026-09-01T00:00:00Z"),
      facts: { admins: ["a", "b"] },
      vulns: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
      alerts: { critical: 0, high: 1, medium: 0, low: 0 },
    }), now);
    expect(bad.results.every((x) => x.outcome === "fail")).toBe(true);
  });

  it("refuses rules it doesn't know or with bad values", () => {
    expect(() => parseRules([{ check: "nope" }])).toThrow(/Unknown rule/);
    expect(() => parseRules([{ check: "checked_in", days: 0 }])).toThrow(/days/);
    expect(() => parseRules([{ check: "os_min_version", version: "fourteen" }])).toThrow(/Minimum OS/);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("10.0.22631", "10.0.9999")).toBe(1);
    expect(compareVersions("14.5", "14.5.0")).toBe(0);
    expect(compareVersions("22.04.4 LTS", "24.04")).toBe(-1);
  });
});

describe("osquery reports", () => {
  it("reads posture from each platform's own words", () => {
    expect(applySnapshot("security_center", [{ firewall: "Good", antivirus: "Poor", autoupdate: "Not Monitored", user_account_control: "Good" }])?.facts)
      .toEqual({ firewall: true, antivirus: false, auto_update: null, system_protection: true });
    expect(applySnapshot("encryption_darwin", [{ encrypted: "1" }])?.facts).toEqual({ disk_encryption: true });
    expect(applySnapshot("protection_darwin", [{ sip: "1", gatekeeper: "0" }])?.facts).toEqual({ system_protection: false });
    expect(applySnapshot("screenlock_darwin", [{ enabled: "1", grace_period: "3600" }])?.facts).toEqual({ screen_lock: false });
    expect(applySnapshot("admins_linux", [{ username: "b" }, { username: "a" }, { username: "a" }])?.facts).toEqual({ admins: ["a", "b"] });
  });

  it("reads the OS and where its advisories are filed", () => {
    const a = applySnapshot("os", [{ name: "Ubuntu", version: "22.04.4 LTS (Jammy Jellyfish)", major: "22", minor: "4", patch: "0", platform: "ubuntu" }]);
    expect(a?.columns).toEqual({ os_name: "Ubuntu", os_version: "22.04.4 LTS" });
    expect(a?.facts).toEqual({ osv_ecosystem: "Ubuntu:22.04:LTS" });
    expect(osvEcosystem("Debian GNU/Linux", "12", "0")).toBe("Debian:12");
    expect(osvEcosystem("Ubuntu", "23", "10")).toBe("Ubuntu:23.10");
    expect(osvEcosystem("Microsoft Windows 11 Pro", "10", "0")).toBeNull();
  });

  it("keeps software with the source package advisories use", () => {
    const a = applySnapshot("software_deb", [
      { name: "libssl3", version: "3.0.2-0ubuntu1.15", package: "openssl (3.0.2-0ubuntu1.15)" },
      { name: "libssl3", version: "3.0.2-0ubuntu1.15", package: "openssl" },
      { name: "", version: "1" },
    ]);
    expect(a?.software).toEqual({ source: "deb", rows: [{ name: "libssl3", version: "3.0.2-0ubuntu1.15", source: "deb", package: "openssl" }] });
  });

  it("reads every result log format osquery sends", () => {
    const r = normalizeResults([
      { name: "synergy_os", action: "snapshot", snapshot: [{ name: "macOS" }], counter: 3 },
      { name: "synergy_listening", action: "added", columns: { port: "22" }, counter: 0 },
      { name: "synergy_listening", action: "added", columns: { port: "80" }, counter: 0 },
      { name: "synergy_listening", action: "added", columns: { port: "8080" }, counter: 4 },
      { name: "synergy_ssh_keys", diffResults: { added: [{ username: "x" }], removed: [] }, counter: 2 },
      { nonsense: true },
    ]);
    expect(r.map((x) => [x.name, x.baseline, x.added.length, !!x.snapshot])).toEqual([
      ["synergy_os", false, 0, true],
      ["synergy_listening", true, 2, false],
      ["synergy_listening", false, 1, false],
      ["synergy_ssh_keys", false, 1, false],
    ]);
  });

  it("serves each platform only its own queries", () => {
    const sched = osqueryConfig("darwin").schedule as Record<string, { platform?: string; snapshot?: boolean; removed?: boolean }>;
    expect(Object.keys(sched)).toContain("synergy_encryption_darwin");
    expect(Object.keys(sched)).not.toContain("synergy_encryption_windows");
    expect(sched.synergy_listening.removed).toBe(false);
    expect(sched.synergy_os.snapshot).toBe(true);
    expect(new Set(QUERIES.map((q) => q.id)).size).toBe(QUERIES.length);
    expect(queriesFor("linux").every((q) => q.platform === "all" || q.platform === "linux")).toBe(true);
    expect(platformOf("windows")).toBe("windows");
    expect(platformOf("darwin")).toBe("darwin");
    expect(platformOf("ubuntu", "debian")).toBe("linux");
  });
});

describe("detections", () => {
  it("ignores the baseline for changes, but not for states that are suspicious on sight", () => {
    const rows = [{ name: "nc", path: "/tmp/nc", port: "4444", protocol: "6" }];
    expect(detect("listening", rows, { baseline: true })).toEqual([]);
    expect(detect("listening", rows, { baseline: false })[0]).toMatchObject({ severity: "medium", title: "nc is listening on TCP port 4444" });
    expect(detect("temp_exec", [{ name: "x", path: "/tmp/x" }], { baseline: true })).toHaveLength(1);
  });

  it("stays quiet about the operating system's own listeners", () => {
    expect(detect("listening", [{ name: "mDNSResponder", port: "5353", protocol: "17" }], { baseline: false })).toEqual([]);
  });

  it("gives the same thing the same fingerprint", () => {
    const a = detect("startup_windows", [{ name: "Updater", path: "C:\\x.exe", source: "HKLM" }], { baseline: false });
    const b = detect("startup_windows", [{ name: "Updater", path: "C:\\x.exe", source: "HKLM" }], { baseline: false });
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
    expect(a[0].detection).toBe("startup");
  });

  it("matches running programs against indicators", () => {
    const bad = "a".repeat(64);
    const out = matchIndicators([{ name: "evil", path: "/x", sha256: bad.toUpperCase() }, { name: "ok", path: "/y", sha256: "b".repeat(64) }], new Map([[bad, "Test malware"]]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", detection: "indicator" });
  });

  it("raises posture changes only on the way from on to off", () => {
    expect(postureChanges({ disk_encryption: true }, { disk_encryption: false })[0]).toMatchObject({ detection: "posture_disk_encryption", severity: "high" });
    expect(postureChanges({}, { disk_encryption: false })).toEqual([]);
    expect(postureChanges({ admins: ["a"] }, { admins: ["a", "eve"] })[0].title).toMatch(/eve/);
    expect(postureChanges({}, { admins: ["a", "eve"] })).toEqual([]);
  });
});

describe("vulnerabilities", () => {
  it("scores CVSS v3 vectors like the specification", () => {
    expect(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N")).toBe(6.1);
    expect(cvss3("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N")).toBe(5.5);
    expect(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H")).toBe(10);
    expect(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
    expect(cvss3("CVSS:4.0/AV:N")).toBeNull();
    expect(severityOfScore(9.8)).toBe("critical");
    expect(severityOfScore(6.1)).toBe("medium");
  });

  it("takes severity from CVSS, else the distribution's own word, and the fixed version", () => {
    const a = advisoryOf({
      id: "UBUNTU-CVE-2024-1",
      details: "A  bug\nin openssl",
      database_specific: { severity: "high" },
      affected: [{ package: { name: "openssl", ecosystem: "Ubuntu:22.04:LTS" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "3.0.2-0ubuntu1.16" }] }] }],
    });
    expect(a).toMatchObject({ severity: "high", score: null, summary: "A bug in openssl", fixed: { "Ubuntu:22.04:LTS|openssl": "3.0.2-0ubuntu1.16" } });
    expect(advisoryOf({ id: "X", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }).severity).toBe("critical");
    expect(advisoryOf({ id: "Y", affected: [{ ecosystem_specific: { urgency: "unimportant" } }] }).severity).toBe("low");
  });

  it("asks OSV in batches and maps answers back to packages", async () => {
    const calls: unknown[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      return new Response(JSON.stringify({ results: body.queries.map((q: { package: { name: string } }) => (q.package.name === "openssl" ? { vulns: [{ id: "V1" }] } : {})) }));
    }) as typeof fetch;
    const out = await queryOsv([{ name: "bash", version: "1" }, { name: "openssl", version: "3" }], "Debian:12", { base: "http://osv", fetch: fake });
    expect(out).toEqual([[], ["V1"]]);
    expect(calls[0]).toMatchObject({ queries: [{ package: { name: "bash", ecosystem: "Debian:12" }, version: "1" }, expect.anything()] });
  });
});

describe("enrollment", () => {
  const env = { SUITE_DOMAIN: "example.com" } as unknown as NodeJS.ProcessEnv;

  it("writes scripts that point osquery at this server with the secret", () => {
    const p = enrollPackage("abc_DEF-123", env);
    expect(p.host).toBe("devices.example.com");
    for (const s of Object.values(p.scripts)) {
      expect(s.text).toContain("abc_DEF-123");
      expect(s.text).toContain("--tls_hostname=devices.example.com");
      expect(s.text).toContain("--distributed_tls_write_endpoint=/api/osquery/distributed/write");
    }
    expect(p.scripts.linux.text).toContain("systemctl restart osqueryd");
    expect(p.scripts.windows.text).toContain("Restart-Service osqueryd");
    expect(p.flags).not.toContain("abc_DEF");
  });

  it("installs a private CA when one is configured", () => {
    const p = enrollPackage("s", { ...env, DEVICES_TLS_CA: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----" });
    expect(p.scripts.linux.text).toContain("--tls_server_certs=/etc/osquery/synergy-ca.pem");
    expect(p.scripts.linux.text).toContain("BEGIN CERTIFICATE");
  });

  it("uses DEVICES_PUBLIC_HOST when set", () => {
    expect(enrollPackage("s", { ...env, DEVICES_PUBLIC_HOST: "https://mdm.example.org:8443/" }).host).toBe("mdm.example.org:8443");
  });
});

describe("access and live queries", () => {
  it("takes admins from DEVICES_ADMIN_EMAILS, else ADMIN_EMAILS", () => {
    expect(roleOf("A@x.com", accessEnv({ DEVICES_ADMIN_EMAILS: "a@x.com", ADMIN_EMAILS: "b@x.com" } as unknown as NodeJS.ProcessEnv))).toBe("admin");
    expect(roleOf("b@x.com", accessEnv({ DEVICES_ADMIN_EMAILS: "a@x.com", ADMIN_EMAILS: "b@x.com" } as unknown as NodeJS.ProcessEnv))).toBe("user");
    expect(roleOf("b@x.com", accessEnv({ ADMIN_EMAILS: "b@x.com" } as unknown as NodeJS.ProcessEnv))).toBe("admin");
    expect(roleOf("dev@x.com", accessEnv({ DEV_USER_EMAIL: "dev@x.com", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv))).toBe("user");
    expect(roleOf("dev@x.com", accessEnv({ DEV_USER_EMAIL: "dev@x.com" } as unknown as NodeJS.ProcessEnv))).toBe("admin");
  });

  it("accepts one read query at a time", () => {
    expect(checkSql("SELECT * FROM os_version;")).toBe("SELECT * FROM os_version");
    expect(checkSql("select ';' as x")).toBe("select ';' as x");
    expect(() => checkSql("SELECT 1; SELECT 2")).toThrow(/One statement/);
    expect(() => checkSql("DELETE FROM x")).toThrow(/SELECT/);
  });
});
