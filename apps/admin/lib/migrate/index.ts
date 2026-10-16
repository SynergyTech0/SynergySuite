import { record } from "../audit";
import { q } from "../db";
import { addPerson, people } from "../directory";
import type { Me } from "../types";
import { UserError, cleanEmail, text, uuid } from "../util";
import { discoverM365 } from "./discover";
import { Graph, GraphError, type GraphOptions } from "./graph";
import { countMessages } from "./imap";
import { startWorker } from "./runner";
import { keyConfigured, open, seal } from "./secret";
import * as store from "./store";
import { HttpSuite, type Suite } from "./suite";
import {
  USER_WORKLOADS, type JobSummary, type MigrationSite, type MigrationUser, type SourceDetail, type SourceSummary, type Workload,
} from "./types";

/**
 * "Move from Microsoft 365" in the Admin center: connect a tenant (or an IMAP server), discover
 * what's there, map people to suite accounts (creating the missing ones), and queue copies.
 * Every change is in the audit log; secrets are sealed and never shown again.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

export type Deps = { graph?: GraphOptions; suite?: Suite };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function graphFor(src: store.SourceRow, deps: Deps = {}): Graph {
  if (src.kind !== "m365") throw new UserError("That source isn't a Microsoft 365 tenant");
  const c = src.config as { tenantId: string; clientId: string };
  return new Graph({ tenantId: c.tenantId, clientId: c.clientId, clientSecret: open(src.secret) }, deps.graph);
}

/** Signs in to the tenant and reads one user: proves the ID, secret and User.Read.All permission. */
async function testTenant(g: Graph): Promise<void> {
  try {
    await g.json("/users?$top=1&$select=id");
  } catch (e) {
    if (e instanceof GraphError && e.status === 403) {
      throw new UserError("Signed in, but Microsoft refused to list users: grant the app User.Read.All (application) and admin consent", 400);
    }
    if (e instanceof GraphError) throw new UserError(e.message, e.status === 401 ? 400 : 502);
    throw e;
  }
}

async function getSourceRow(id: string): Promise<store.SourceRow> {
  const s = await store.source(uuid(id, "That source"));
  if (!s) throw new UserError("That source was not found", 404);
  return s;
}

function summary(r: store.SourceRow, counts: { userCount: number; mapped: number; siteCount: number }, jobCounts: SourceSummary["jobCounts"]): SourceSummary {
  return {
    id: r.id, kind: r.kind, name: r.name, createdBy: r.created_by, createdAt: r.created_at.toISOString(), config: r.config,
    discoveredAt: iso(r.discovered_at), discoveryError: r.discovery_error, notes: r.notes ?? [], ...counts, jobCounts,
  };
}

export async function listSources(): Promise<{ sources: SourceSummary[]; keyConfigured: boolean }> {
  startWorker();
  const rows = await q<store.SourceRow & { users: string; mapped: string; sites: string; queued: string; running: string; done: string; failed: string }>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM migration_users u WHERE u.source_id = s.id) AS users,
       (SELECT COUNT(*) FROM migration_users u WHERE u.source_id = s.id AND u.target IS NOT NULL AND u.target <> '') AS mapped,
       (SELECT COUNT(*) FROM migration_sites x WHERE x.source_id = s.id) AS sites,
       (SELECT COUNT(*) FROM migration_jobs j WHERE j.source_id = s.id AND j.status = 'queued') AS queued,
       (SELECT COUNT(*) FROM migration_jobs j WHERE j.source_id = s.id AND j.status = 'running') AS running,
       (SELECT COUNT(*) FROM migration_jobs j WHERE j.source_id = s.id AND j.status = 'done') AS done,
       (SELECT COUNT(*) FROM migration_jobs j WHERE j.source_id = s.id AND j.status = 'failed') AS failed
     FROM migration_sources s ORDER BY s.created_at`,
  );
  return {
    keyConfigured: keyConfigured(),
    sources: rows.map((r) => summary(r, { userCount: +r.users, mapped: +r.mapped, siteCount: +r.sites }, { queued: +r.queued, running: +r.running, done: +r.done, failed: +r.failed })),
  };
}

export async function createSource(me: Me, v: Record<string, unknown>, deps: Deps = {}): Promise<SourceSummary> {
  const kind = v.kind === "imap" ? "imap" : "m365";
  let config: Record<string, string | number | boolean>;
  let secret = "";
  if (kind === "m365") {
    const tenantId = text(v.tenantId, 253);
    const clientId = text(v.clientId, 36);
    const clientSecret = String(v.clientSecret ?? "").trim();
    if (!TENANT.test(tenantId)) throw new UserError("Enter the directory (tenant) ID, or the tenant's domain");
    if (!GUID.test(clientId)) throw new UserError("Enter the application (client) ID");
    if (!clientSecret || clientSecret.length > 500) throw new UserError("Enter the client secret's value");
    await testTenant(new Graph({ tenantId, clientId, clientSecret }, deps.graph));
    config = { tenantId, clientId };
    secret = seal(clientSecret);
  } else {
    const host = text(v.host, 253).toLowerCase();
    const port = Number(v.port || 993);
    if (!/^[a-z0-9.-]+$/.test(host)) throw new UserError("Enter the IMAP server's host name");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError("Enter the IMAP port");
    config = { host, port, secure: v.secure !== false };
  }
  const name = text(v.name, 120) || (kind === "m365" ? "Microsoft 365" : String(config.host));
  const [r] = await q<store.SourceRow>(
    `INSERT INTO migration_sources (kind, name, config, secret, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [kind, name, JSON.stringify(config), secret, me.email],
  );
  await record(me.email, "migration.source.create", r.id, { kind, name, ...config });
  return summary(r, { userCount: 0, mapped: 0, siteCount: 0 }, { queued: 0, running: 0, done: 0, failed: 0 });
}

export async function updateSource(me: Me, id: string, v: Record<string, unknown>, deps: Deps = {}): Promise<void> {
  const s = await getSourceRow(id);
  if (v.name !== undefined) await q(`UPDATE migration_sources SET name = $2 WHERE id = $1`, [s.id, text(v.name, 120) || s.name]);
  if (s.kind === "m365" && typeof v.clientSecret === "string" && v.clientSecret.trim()) {
    const c = s.config as { tenantId: string; clientId: string };
    await testTenant(new Graph({ ...c, clientSecret: v.clientSecret.trim() }, deps.graph));
    await q(`UPDATE migration_sources SET secret = $2 WHERE id = $1`, [s.id, seal(v.clientSecret.trim())]);
  }
  await record(me.email, "migration.source.update", s.id, { name: v.name, secretChanged: typeof v.clientSecret === "string" && !!v.clientSecret });
}

export async function deleteSource(me: Me, id: string): Promise<void> {
  const s = await getSourceRow(id);
  const [busy] = await q(`SELECT 1 FROM migration_jobs WHERE source_id = $1 AND status IN ('queued', 'running') LIMIT 1`, [s.id]);
  if (busy) throw new UserError("Cancel its queued and running copies first", 409);
  await q(`DELETE FROM migration_sources WHERE id = $1`, [s.id]);
  await record(me.email, "migration.source.delete", s.id, { name: s.name, kind: s.kind });
}

export async function discover(me: Me, id: string, deps: Deps = {}): Promise<SourceDetail> {
  const s = await getSourceRow(id);
  if (s.kind === "imap") {
    // An IMAP source has no directory: count each added mailbox's messages instead.
    const cfg = s.config as { host: string; port: number; secure: boolean };
    const notes: string[] = [];
    for (const u of await store.users(s.id)) {
      try {
        const n = await countMessages({ host: cfg.host, port: Number(cfg.port), secure: cfg.secure !== false }, u.ext_id, open(u.secret));
        await q(`UPDATE migration_users SET mail_items = $3, has_mailbox = true, seen_at = now() WHERE source_id = $1 AND ext_id = $2`, [s.id, u.ext_id, n.items]);
      } catch (e) {
        await q(`UPDATE migration_users SET has_mailbox = false WHERE source_id = $1 AND ext_id = $2`, [s.id, u.ext_id]);
        notes.push(`${u.ext_id}: ${(e as Error).message}`);
      }
    }
    await q(`UPDATE migration_sources SET discovered_at = now(), discovery_error = NULL, notes = $2 WHERE id = $1`, [s.id, JSON.stringify(notes)]);
    return detail(id);
  }
  try {
    const out = await discoverM365(graphFor(s, deps), s.id);
    await q(`UPDATE migration_sources SET discovered_at = now(), discovery_error = NULL, notes = $2 WHERE id = $1`, [s.id, JSON.stringify(out.notes)]);
    await suggestTargets(s.id);
    await record(me.email, "migration.discover", s.id, { users: out.users, sites: out.sites });
  } catch (e) {
    const msg = e instanceof GraphError || e instanceof UserError ? e.message : "Discovery failed";
    if (!(e instanceof GraphError || e instanceof UserError)) console.error("[admin] discovery", (e as Error).message);
    await q(`UPDATE migration_sources SET discovery_error = $2 WHERE id = $1`, [s.id, msg]);
    throw new UserError(msg, 502);
  }
  return detail(id);
}

/** People not mapped yet whose address already has a suite account are mapped to it. */
async function suggestTargets(sourceId: string): Promise<void> {
  const dir = await people().catch(() => null);
  if (!dir?.configured || dir.error) return;
  const known = new Set(dir.people.map((p) => p.email));
  for (const u of await store.users(sourceId)) {
    if (!u.target && known.has(u.email)) await q(`UPDATE migration_users SET target = $3 WHERE source_id = $1 AND ext_id = $2`, [sourceId, u.ext_id, u.email]);
  }
}

export async function detail(id: string): Promise<SourceDetail> {
  startWorker();
  const s = await getSourceRow(id);
  const [users, sites, latest, dir, jobs] = await Promise.all([
    store.users(s.id), store.sites(s.id), store.latestJobs(s.id), people().catch(() => null),
    q<store.JobRow>(`SELECT * FROM migration_jobs WHERE source_id = $1 ORDER BY created_at DESC LIMIT 200`, [s.id]),
  ]);
  const known = dir?.configured && !dir.error ? new Set(dir.people.map((p) => p.email)) : null;
  const job = (k: string) => {
    const j = latest.get(k);
    return j ? store.toJob(j) : null;
  };
  const u: MigrationUser[] = users.map((r) => ({
    extId: r.ext_id, email: r.email, name: r.name, enabled: r.enabled,
    mailBytes: r.mail_bytes === null ? null : Number(r.mail_bytes), mailItems: r.mail_items, driveBytes: r.drive_bytes === null ? null : Number(r.drive_bytes),
    hasMailbox: r.has_mailbox, hasDrive: r.has_drive, target: r.target, hasPassword: !!r.secret,
    targetExists: r.target && known ? known.has(r.target) : null, lastJob: job(`user:${r.ext_id}`),
  }));
  const st: MigrationSite[] = sites.map((r) => ({
    siteId: r.site_id, name: r.name, url: r.url, driveBytes: r.drive_bytes === null ? null : Number(r.drive_bytes), libraries: r.libraries,
    members: r.members, include: r.include, library: r.library, lastJob: job(`site:${r.site_id}`),
  }));
  const count = (st2: string) => jobs.filter((j) => j.status === st2).length;
  return {
    ...summary(s, { userCount: u.length, mapped: u.filter((x) => x.target).length, siteCount: st.length }, { queued: count("queued"), running: count("running"), done: count("done"), failed: count("failed") }),
    users: u, sites: st, jobs: jobs.map(store.toJob), directory: !!known,
  };
}

/** Sets or clears where each person goes: [{ extId, target }]. */
export async function map(me: Me, id: string, list: unknown): Promise<SourceDetail> {
  const s = await getSourceRow(id);
  if (!Array.isArray(list) || list.length > 5000) throw new UserError("Send a list of people to map");
  const changes: { extId: string; target: string | null }[] = [];
  for (const m of list as { extId?: unknown; target?: unknown }[]) {
    const extId = text(m?.extId, 300);
    if (!extId) continue;
    const target = m.target === null || m.target === "" ? null : cleanEmail(m.target);
    changes.push({ extId, target });
  }
  const targets = changes.map((c) => c.target).filter(Boolean);
  if (new Set(targets).size !== targets.length) throw new UserError("Two people can't move into the same suite account");
  for (const c of changes) {
    const [taken] = c.target
      ? await q<{ email: string }>(`SELECT email FROM migration_users WHERE source_id = $1 AND target = $2 AND ext_id <> $3 AND NOT (ext_id = ANY($4))`, [s.id, c.target, c.extId, changes.map((x) => x.extId)])
      : [];
    if (taken) throw new UserError(`${c.target} is already where ${taken.email} goes`);
    await q(`UPDATE migration_users SET target = $3 WHERE source_id = $1 AND ext_id = $2`, [s.id, c.extId, c.target]);
  }
  await record(me.email, "migration.map", s.id, { changes: changes.slice(0, 200) });
  return detail(id);
}

/** IMAP sources: add a mailbox to copy (its login and password, sealed). */
export async function addMailbox(me: Me, id: string, v: Record<string, unknown>): Promise<SourceDetail> {
  const s = await getSourceRow(id);
  if (s.kind !== "imap") throw new UserError("Microsoft 365 users come from discovery");
  const login = text(v.login, 254);
  const password = String(v.password ?? "");
  if (!login) throw new UserError("Enter the mailbox's login");
  if (!password || password.length > 500) throw new UserError("Enter the mailbox's password or app password");
  const email = login.includes("@") ? login.toLowerCase() : text(v.email, 254).toLowerCase() || login;
  const target = v.target ? cleanEmail(v.target) : null;
  await q(
    `INSERT INTO migration_users (source_id, ext_id, email, name, secret, target) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_id, ext_id) DO UPDATE SET secret = $5, target = COALESCE($6, migration_users.target), email = $3`,
    [s.id, login, email, text(v.name, 200), seal(password), target],
  );
  await record(me.email, "migration.mailbox.add", s.id, { login, target });
  return detail(id);
}

export async function removeMailbox(me: Me, id: string, extId: string): Promise<SourceDetail> {
  const s = await getSourceRow(id);
  await q(`DELETE FROM migration_users WHERE source_id = $1 AND ext_id = $2`, [s.id, extId]);
  await record(me.email, "migration.mailbox.remove", s.id, { login: extId });
  return detail(id);
}

export async function setSite(me: Me, id: string, v: Record<string, unknown>): Promise<SourceDetail> {
  const s = await getSourceRow(id);
  const siteId = text(v.siteId, 400);
  if (!(await store.site(s.id, siteId))) throw new UserError("That site was not found", 404);
  await q(`UPDATE migration_sites SET include = $3 WHERE source_id = $1 AND site_id = $2`, [s.id, siteId, v.include === true]);
  return detail(id);
}

/**
 * Creates suite accounts for mapped people who don't have one yet (through the sign-in
 * service's SCIM API, as People does), then their mailboxes (through Mail, as their first
 * visit would). They set a password with "Forgot password" on the sign-in page.
 */
export async function createAccounts(me: Me, id: string, extIds: unknown, deps: Deps = {}): Promise<{ created: string[]; existed: string[]; failed: { email: string; error: string }[] }> {
  const s = await getSourceRow(id);
  const dir = await people();
  if (!dir.configured) throw new UserError("Set ADMIN_SCIM_TOKEN so the Admin center can create accounts", 409);
  if (dir.error) throw new UserError(dir.error, 502);
  const known = new Set(dir.people.map((p) => p.email));
  const want = new Set(Array.isArray(extIds) ? extIds.map(String) : []);
  const suite = deps.suite ?? new HttpSuite();
  const out = { created: [] as string[], existed: [] as string[], failed: [] as { email: string; error: string }[] };
  for (const u of await store.users(s.id)) {
    if (!u.target || (want.size && !want.has(u.ext_id))) continue;
    try {
      if (known.has(u.target)) out.existed.push(u.target);
      else {
        await addPerson(me, { email: u.target, name: u.name, active: true });
        out.created.push(u.target);
      }
      await suite.provisionMailbox({ email: u.target, name: u.name }).catch((e) => {
        throw new UserError(`Account ready, but its mailbox: ${(e as Error).message}`);
      });
    } catch (e) {
      out.failed.push({ email: u.target, error: (e as Error).message });
    }
  }
  await record(me.email, "migration.accounts", s.id, { created: out.created, failed: out.failed.length });
  return out;
}

/** Queues a copy for each chosen person (and site). One already queued or running is left alone. */
export async function start(me: Me, id: string, v: { extIds?: unknown; siteIds?: unknown; workloads?: unknown }): Promise<{ queued: JobSummary[]; skipped: string[] }> {
  const s = await getSourceRow(id);
  const ws = (Array.isArray(v.workloads) ? v.workloads : USER_WORKLOADS).filter((w): w is Workload => USER_WORKLOADS.includes(w as Workload));
  const workloads: Workload[] = s.kind === "imap" ? ["mail"] : ws;
  if (!workloads.length) throw new UserError("Pick what to copy");
  const extIds = Array.isArray(v.extIds) ? v.extIds.map(String) : [];
  const siteIds = Array.isArray(v.siteIds) ? v.siteIds.map(String) : [];
  const queued: JobSummary[] = [];
  const skipped: string[] = [];
  const busy = new Set((await q<{ k: string }>(
    `SELECT subject_kind || ':' || subject_id AS k FROM migration_jobs WHERE source_id = $1 AND status IN ('queued', 'running')`, [s.id],
  )).map((r) => r.k));
  for (const extId of extIds) {
    const u = await store.user(s.id, extId);
    if (!u) continue;
    if (!u.target) {
      skipped.push(`${u.email}: not mapped to a suite account`);
      continue;
    }
    if (busy.has(`user:${extId}`)) {
      skipped.push(`${u.email}: already queued or running`);
      continue;
    }
    const [r] = await q<store.JobRow>(
      `INSERT INTO migration_jobs (source_id, subject_kind, subject_id, label, target, workloads, created_by) VALUES ($1, 'user', $2, $3, $4, $5, $6) RETURNING *`,
      [s.id, extId, u.name || u.email, u.target, workloads, me.email],
    );
    queued.push(store.toJob(r));
  }
  for (const siteId of siteIds) {
    const site = await store.site(s.id, siteId);
    if (!site) continue;
    if (busy.has(`site:${siteId}`)) {
      skipped.push(`${site.name}: already queued or running`);
      continue;
    }
    // A site's libraries are created by, and owned at first by, the admin who starts the copy.
    const [r] = await q<store.JobRow>(
      `INSERT INTO migration_jobs (source_id, subject_kind, subject_id, label, target, workloads, created_by) VALUES ($1, 'site', $2, $3, $4, $5, $4) RETURNING *`,
      [s.id, siteId, site.name, me.email, ["library"]],
    );
    queued.push(store.toJob(r));
  }
  if (queued.length) await record(me.email, "migration.start", s.id, { jobs: queued.map((j) => ({ id: j.id, subject: j.label, target: j.target, workloads: j.workloads })) });
  startWorker();
  return { queued, skipped };
}

export async function getJob(id: string): Promise<JobSummary> {
  const j = await store.job(uuid(id, "That copy"));
  if (!j) throw new UserError("That copy was not found", 404);
  return store.toJob(j);
}

export async function cancelJob(me: Me, id: string): Promise<JobSummary> {
  const j = await getJob(id);
  if (j.status !== "queued" && j.status !== "running") throw new UserError("Only a queued or running copy can be cancelled", 409);
  await q(`UPDATE migration_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')`, [j.id]);
  await record(me.email, "migration.cancel", j.id, { subject: j.label });
  return getJob(id);
}

/** Runs a finished, failed or cancelled copy again. It continues from its delta links: only what changed is copied. */
export async function rerunJob(me: Me, id: string): Promise<JobSummary> {
  const j = await getJob(id);
  if (j.status === "queued" || j.status === "running") throw new UserError("It is already queued or running", 409);
  const r = await start(me, j.sourceId, j.subjectKind === "site" ? { siteIds: [j.subjectId] } : { extIds: [j.subjectId], workloads: j.workloads });
  if (!r.queued.length) throw new UserError(r.skipped[0] ?? "Nothing to run", 409);
  return r.queued[0];
}

/** For the report download: one copy's report as CSV rows. */
export function reportCsv(j: JobSummary): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["section", "workload", "item", "detail"].join(",")];
  for (const [w, c] of Object.entries(j.report.counts)) {
    for (const k of ["copied", "updated", "deleted", "skipped", "failed"] as const) lines.push([esc("count"), esc(w), esc(k), esc(c?.[k] ?? 0)].join(","));
  }
  for (const s of j.report.skipped) lines.push([esc("skipped"), esc(s.workload), esc(s.item), esc(s.reason)].join(","));
  for (const e of j.report.errors) lines.push([esc("error"), esc(e.workload), esc(e.item), esc(e.error)].join(","));
  for (const n of j.report.notMigrated) lines.push([esc("not migrated yet"), "", esc(n), ""].join(","));
  return lines.join("\r\n") + "\r\n";
}
