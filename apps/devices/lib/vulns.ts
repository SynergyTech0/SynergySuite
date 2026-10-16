import { type Q, q as defaultQ, tx } from "./db";
import type { Severity } from "./detections";

/**
 * Vulnerability management: installed Linux packages checked against OSV (https://osv.dev), the
 * open vulnerability database run by Google with advisories from Debian, Ubuntu, Rocky, AlmaLinux
 * and others. Only package names and versions are sent; nothing identifies the device. Set
 * DEVICES_OSV_URL to a mirror, or to "off" to turn this off. Windows and macOS applications have no
 * equivalent open, package-exact advisory feed, so they are inventoried but not matched.
 */

export type VulnSeverity = Severity | "unknown";

/** CVSS v3.x base score from a vector like "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H". */
export function cvss3(vector: string): number | null {
  const m = /^CVSS:3\.[01]\/(.*)$/.exec(vector.trim());
  if (!m) return null;
  const v: Record<string, string> = {};
  for (const part of m[1].split("/")) {
    const [k, val] = part.split(":");
    if (k && val) v[k] = val;
  }
  const W = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 },
  } as const;
  const changed = v.S === "C";
  const PR: Record<string, number> = changed ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 };
  const get = <T extends Record<string, number>>(t: T, k: string): number | undefined => (k in t ? t[k as keyof T] : undefined);
  const av = get(W.AV, v.AV), ac = get(W.AC, v.AC), pr = get(PR, v.PR), ui = get(W.UI, v.UI);
  const c = get(W.CIA, v.C), i = get(W.CIA, v.I), a = get(W.CIA, v.A);
  if ([av, ac, pr, ui, c, i, a].some((x) => x === undefined) || (v.S !== "U" && v.S !== "C")) return null;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  return roundUp(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
}

/** CVSS's own rounding: up to one decimal, done in integers so 4.0000001 stays 4.0. */
function roundUp(x: number): number {
  const n = Math.round(x * 100000);
  return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10;
}

export function severityOfScore(score: number): VulnSeverity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

function severityWord(w: unknown): VulnSeverity | null {
  const s = String(w ?? "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high" || s === "important") return "high";
  if (s === "medium" || s === "moderate") return "medium";
  if (s === "low" || s === "negligible" || s === "unimportant") return "low";
  return null;
}

type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { events?: Record<string, string>[] }[];
    ecosystem_specific?: { urgency?: string };
    database_specific?: { severity?: string };
  }[];
};

export type Advisory = { id: string; severity: VulnSeverity; score: number | null; summary: string; fixed: Record<string, string> };

/** What Devices keeps of an OSV record: worst-case severity, a summary, and the fixed version per package. */
export function advisoryOf(v: OsvVuln): Advisory {
  let score: number | null = null;
  for (const s of v.severity ?? []) {
    if (s.type === "CVSS_V3") {
      const n = cvss3(s.score);
      if (n !== null && (score === null || n > score)) score = n;
    }
  }
  let severity: VulnSeverity = score !== null ? severityOfScore(score) : "unknown";
  if (severity === "unknown") {
    const words = [v.database_specific?.severity, ...(v.affected ?? []).flatMap((a) => [a.ecosystem_specific?.urgency, a.database_specific?.severity])];
    const order: VulnSeverity[] = ["critical", "high", "medium", "low"];
    for (const level of order) if (words.some((w) => severityWord(w) === level)) { severity = level; break; }
  }
  const fixed: Record<string, string> = {};
  for (const a of v.affected ?? []) {
    const name = a.package?.name;
    if (!name) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixed[`${a.package?.ecosystem ?? ""}|${name}`] = e.fixed;
  }
  const summary = (v.summary || v.details || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return { id: v.id, severity, score, summary, fixed };
}

/** The OSV ecosystem for a Linux distribution, from osquery's os_version row. */
export function osvEcosystem(name: string, major: string | number, minor: string | number): string | null {
  const n = name.toLowerCase();
  const maj = String(major ?? "").trim();
  if (!maj) return null;
  if (n.includes("ubuntu")) {
    const mm = `${maj}.${String(minor ?? "0").padStart(2, "0")}`;
    return Number(maj) % 2 === 0 && Number(minor) === 4 ? `Ubuntu:${mm}:LTS` : `Ubuntu:${mm}`;
  }
  if (n.includes("debian")) return `Debian:${maj}`;
  if (n.includes("rocky")) return `Rocky Linux:${maj}`;
  if (n.includes("alma")) return `AlmaLinux:${maj}`;
  return null;
}

export function osvBase(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.DEVICES_OSV_URL ?? "https://api.osv.dev").trim();
  return v === "" || v.toLowerCase() === "off" ? null : v.replace(/\/+$/, "");
}

type Pkg = { name: string; version: string };

async function json(f: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OSV answered ${res.status} for ${url}`);
  return res.json();
}

/** Asks OSV which advisories affect each package. Returns advisory ids per package index. */
export async function queryOsv(pkgs: Pkg[], ecosystem: string, opts: { base: string; fetch?: typeof fetch }): Promise<string[][]> {
  const f = opts.fetch ?? fetch;
  const out: string[][] = [];
  for (let i = 0; i < pkgs.length; i += 500) {
    const chunk = pkgs.slice(i, i + 500);
    const body = { queries: chunk.map((p) => ({ package: { name: p.name, ecosystem }, version: p.version })) };
    const res = (await json(f, `${opts.base}/v1/querybatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })) as {
      results?: { vulns?: { id: string }[] }[];
    };
    for (let j = 0; j < chunk.length; j++) out.push((res.results?.[j]?.vulns ?? []).map((v) => v.id));
  }
  return out;
}

async function advisories(ids: string[], opts: { base: string; fetch?: typeof fetch; q: Q }): Promise<Map<string, Advisory>> {
  const f = opts.fetch ?? fetch;
  const map = new Map<string, Advisory>();
  const cached = await opts.q<Advisory & { fetched_at: Date }>(
    `SELECT id, severity, score, summary, fixed, fetched_at FROM advisories WHERE id = ANY($1) AND fetched_at > now() - interval '7 days'`,
    [ids],
  );
  for (const c of cached) map.set(c.id, c);
  const missing = ids.filter((id) => !map.has(id));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (id) => {
        try {
          const a = advisoryOf((await json(f, `${opts.base}/v1/vulns/${encodeURIComponent(id)}`)) as OsvVuln);
          map.set(id, a);
          await opts.q(
            `INSERT INTO advisories (id, severity, score, summary, fixed) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET severity = $2, score = $3, summary = $4, fixed = $5, fetched_at = now()`,
            [id, a.severity, a.score, a.summary, JSON.stringify(a.fixed)],
          );
        } catch (err) {
          // One advisory that won't load still counts, at unknown severity.
          console.error("[devices] osv", id, (err as Error).message);
          map.set(id, { id, severity: "unknown", score: null, summary: "", fixed: {} });
        }
      }),
    );
  }
  return map;
}

/**
 * Checks one device's packages and replaces its vulnerability list. Returns how many were found,
 * or null when there was nothing to check (OSV off, or not a distribution OSV covers).
 */
export async function scanDevice(deviceId: string, opts: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; q?: Q } = {}): Promise<number | null> {
  const q = opts.q ?? defaultQ;
  const base = osvBase(opts.env);
  if (!base) return null;
  const [d] = await q<{ facts: { osv_ecosystem?: string } }>(`SELECT facts FROM devices WHERE id = $1 AND retired_at IS NULL`, [deviceId]);
  const ecosystem = d?.facts?.osv_ecosystem;
  if (!ecosystem) return null;
  const rows = await q<{ name: string; version: string; package: string }>(
    `SELECT name, version, package FROM software WHERE device_id = $1 AND source IN ('deb', 'rpm') AND version <> ''`,
    [deviceId],
  );
  // Advisories are filed under the source package; several binary packages share one.
  const pkgs = [...new Map(rows.map((r) => [`${r.package || r.name}|${r.version}`, { name: r.package || r.name, version: r.version }])).values()];
  const ids = await queryOsv(pkgs, ecosystem, { base, fetch: opts.fetch });
  const all = [...new Set(ids.flat())];
  const adv = await advisories(all, { base, fetch: opts.fetch, q });
  const found: { vuln: string; pkg: Pkg; a: Advisory }[] = [];
  pkgs.forEach((p, i) => {
    for (const id of ids[i]) found.push({ vuln: id, pkg: p, a: adv.get(id)! });
  });
  const write = async (tq: Q) => {
    await tq(`DELETE FROM vulnerabilities WHERE device_id = $1`, [deviceId]);
    for (const f of found) {
      await tq(
        `INSERT INTO vulnerabilities (device_id, vuln_id, package, version, ecosystem, severity, score, summary, fixed_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [deviceId, f.vuln, f.pkg.name, f.pkg.version, ecosystem, f.a.severity, f.a.score, f.a.summary, f.a.fixed[`${ecosystem}|${f.pkg.name}`] ?? ""],
      );
    }
    await tq(`UPDATE devices SET vulns_checked_at = now() WHERE id = $1`, [deviceId]);
  };
  if (opts.q) await write(q);
  else await tx(write);
  return found.length;
}
