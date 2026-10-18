import { apps } from "@synergy/config";
import { q } from "./db";
import { ProbeRefused, checkUrlShape, probe } from "./safe-fetch";
import { UserError, text } from "./util";

export type Monitor = {
  id: string;
  name: string;
  url: string;
  expect_status: number;
  interval_sec: number;
  active: boolean;
  public: boolean;
  sort: number;
  created_at: Date;
  last_checked_at: Date | null;
};

export type MonitorRow = Monitor & {
  up: boolean | null;
  last_status: number | null;
  last_error: string | null;
  uptime_24h: number | null;
  uptime_30d: number | null;
  latency_24h: number | null;
};

export type Check = { id: string; ok: boolean; status_code: number | null; latency_ms: number | null; error: string | null; checked_at: Date };

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 86_400;

/** A check passes on the expected status, or on any 2xx/3xx answer (a sign-in page counts as up). */
export function isUp(status: number | null, expect: number): boolean {
  if (status === null) return false;
  return status === expect || (status >= 200 && status < 400);
}

type MonitorInput = { name?: unknown; url?: unknown; expectStatus?: unknown; intervalSec?: unknown; active?: unknown; isPublic?: unknown; public?: unknown; sort?: unknown };

function cleanUrl(v: unknown): string {
  const raw = text(v, 2000);
  try {
    return checkUrlShape(raw).toString();
  } catch (err) {
    if (err instanceof ProbeRefused) throw new UserError(err.message);
    throw err;
  }
}

function int(v: unknown, what: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError(`${what} must be a whole number`);
  return Math.min(max, Math.max(min, n));
}

export async function listMonitors(): Promise<MonitorRow[]> {
  return q<MonitorRow>(
    `SELECT m.id::text, m.name, m.url, m.expect_status, m.interval_sec, m.active, m.public, m.sort, m.created_at, COALESCE(m.last_checked_at, l.checked_at) AS last_checked_at,
       l.ok AS up, l.status_code AS last_status, l.error AS last_error,
       (SELECT round(avg(CASE WHEN ok THEN 100.0 ELSE 0 END), 2)::float FROM checks c
         WHERE c.monitor_id = m.id AND c.checked_at > now() - interval '24 hours') AS uptime_24h,
       (SELECT round(avg(CASE WHEN ok THEN 100.0 ELSE 0 END), 2)::float FROM checks c
         WHERE c.monitor_id = m.id AND c.checked_at > now() - interval '30 days') AS uptime_30d,
       (SELECT round(avg(latency_ms))::int FROM checks c
         WHERE c.monitor_id = m.id AND c.ok AND c.checked_at > now() - interval '24 hours') AS latency_24h
     FROM monitors m
     LEFT JOIN LATERAL (SELECT ok, status_code, error, checked_at FROM checks c WHERE c.monitor_id = m.id ORDER BY checked_at DESC LIMIT 1) l ON true
     ORDER BY m.sort, m.id`,
  );
}

export async function getMonitor(id: string): Promise<Monitor> {
  const [m] = await q<Monitor>(`SELECT id::text, name, url, expect_status, interval_sec, active, public, sort, created_at, last_checked_at FROM monitors WHERE id = $1`, [monitorId(id)]);
  if (!m) throw new UserError("Not found", 404);
  return m;
}

function monitorId(id: unknown): string {
  const s = String(id ?? "");
  if (!/^\d{1,18}$/.test(s)) throw new UserError("Not found", 404);
  return s;
}

export async function createMonitor(b: MonitorInput): Promise<Monitor> {
  const name = text(b.name, 120);
  if (!name) throw new UserError("Give the monitor a name");
  const url = cleanUrl(b.url);
  const expect = b.expectStatus == null || b.expectStatus === "" ? 200 : int(b.expectStatus, "Expected status", 100, 599);
  const interval = b.intervalSec == null || b.intervalSec === "" ? 300 : int(b.intervalSec, "Interval", MIN_INTERVAL, MAX_INTERVAL);
  const pub = b.isPublic ?? b.public;
  const [m] = await q<Monitor>(
    `INSERT INTO monitors (name, url, expect_status, interval_sec, public, sort)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id::text, name, url, expect_status, interval_sec, active, public, sort, created_at, last_checked_at`,
    [name, url, expect, interval, pub == null ? true : Boolean(pub), b.sort == null || b.sort === "" ? 0 : int(b.sort, "Order", -100000, 100000)],
  );
  return m;
}

export async function updateMonitor(id: string, b: MonitorInput): Promise<Monitor> {
  const cur = await getMonitor(id);
  const pub = b.isPublic ?? b.public;
  const name = b.name === undefined ? cur.name : text(b.name, 120);
  if (!name) throw new UserError("Give the monitor a name");
  const [m] = await q<Monitor>(
    `UPDATE monitors SET name = $2, url = $3, expect_status = $4, interval_sec = $5, active = $6, public = $7, sort = $8
     WHERE id = $1
     RETURNING id::text, name, url, expect_status, interval_sec, active, public, sort, created_at, last_checked_at`,
    [
      cur.id,
      name,
      b.url === undefined ? cur.url : cleanUrl(b.url),
      b.expectStatus === undefined ? cur.expect_status : int(b.expectStatus, "Expected status", 100, 599),
      b.intervalSec === undefined ? cur.interval_sec : int(b.intervalSec, "Interval", MIN_INTERVAL, MAX_INTERVAL),
      b.active === undefined ? cur.active : Boolean(b.active),
      pub === undefined ? cur.public : Boolean(pub),
      b.sort === undefined ? cur.sort : int(b.sort, "Order", -100000, 100000),
    ],
  );
  return m;
}

export async function deleteMonitor(id: string): Promise<void> {
  await q(`DELETE FROM monitors WHERE id = $1`, [monitorId(id)]);
}

export async function recentChecks(id: string, limit = 50): Promise<Check[]> {
  return q<Check>(
    `SELECT id::text, ok, status_code, latency_ms, error, checked_at FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT $2`,
    [monitorId(id), Math.min(500, Math.max(1, limit))],
  );
}

/** Checks one monitor now and records the result. */
export async function runCheck(m: Pick<Monitor, "id" | "url" | "expect_status">): Promise<Check> {
  const r = await probe(m.url);
  const ok = isUp(r.status, m.expect_status);
  const [c] = await q<Check>(
    `INSERT INTO checks (monitor_id, ok, status_code, latency_ms, error) VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text, ok, status_code, latency_ms, error, checked_at`,
    [m.id, ok, r.status, r.latencyMs, r.error],
  );
  await q(`UPDATE monitors SET last_checked_at = $2 WHERE id = $1`, [m.id, c.checked_at]);
  return c;
}

/** Checks every active monitor whose interval has passed, a few at a time. */
export async function pollDue(concurrency = 8): Promise<number> {
  const due = await q<Monitor>(
    `SELECT id::text, url, expect_status FROM monitors
     WHERE active AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(secs => interval_sec))
     ORDER BY last_checked_at NULLS FIRST LIMIT 200`,
  );
  let i = 0;
  const worker = async () => {
    while (i < due.length) {
      const m = due[i++];
      await runCheck(m).catch((e) => console.error("[status] check", m.id, (e as Error).message));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
  return due.length;
}

/** Drops checks older than STATUS_RETENTION_DAYS (default 90). */
export async function prune(days = Number(process.env.STATUS_RETENTION_DAYS) || 90): Promise<void> {
  await q(`DELETE FROM checks WHERE checked_at < now() - make_interval(days => $1)`, [Math.max(1, Math.floor(days))]);
}

/**
 * Adds a monitor for each suite app at https://<id>.<SUITE_DOMAIN>, skipping addresses already
 * monitored. Nothing is added without SUITE_DOMAIN.
 */
export async function addSuiteApps(): Promise<number> {
  const domain = process.env.SUITE_DOMAIN;
  if (!domain) throw new UserError("SUITE_DOMAIN is not set, so the suite's addresses aren't known");
  const have = new Set((await q<{ url: string }>(`SELECT url FROM monitors`)).map((r) => r.url.replace(/\/$/, "")));
  let added = 0;
  let sort = 100;
  for (const a of apps) {
    if (a.planned) continue;
    const url = `https://${a.id}.${domain}`;
    sort += 10;
    if (have.has(url)) continue;
    await q(`INSERT INTO monitors (name, url, sort) VALUES ($1, $2, $3)`, [a.name, `${url}/`, sort]);
    added++;
  }
  return added;
}
