import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { record } from "./audit";
import { appName } from "./apps";
import { q } from "./db";
import { collectAll, exportItems, type Caller } from "./fanout";
import { get as getMatter } from "./matters";
import { caller, targets, toRequest } from "./search";
import { getSearch, inputOf } from "./searches";
import type { ExportRecord, Me, SavedSearch } from "./types";
import { UserError, uuid } from "./util";
import { ExportZip, type AppCount } from "./zip";

/**
 * Exports of a saved search: run in the background (pending → running → done or failed), each
 * app's hits collected page by page (at most MAX_ITEMS_PER_APP, reported when cut short), fetched
 * in batches and written to a zip under ADMIN_EXPORT_DIR.
 */

export const MAX_ITEMS_PER_APP = 5000;

export function exportDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.ADMIN_EXPORT_DIR || (env.NODE_ENV === "production" ? "/data/admin" : path.join(process.cwd(), "exports")));
}

type Row = {
  id: string; matter_id: string; search_id: string | null; search: SavedSearch; status: ExportRecord["status"]; requested_by: string;
  created_at: Date; started_at: Date | null; finished_at: Date | null; file_name: string | null; size: string | null;
  sha256: string | null; counts: ExportRecord["counts"]; error: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toExport(r: Row): ExportRecord {
  return {
    id: r.id, matterId: r.matter_id, searchId: r.search_id, searchName: r.search?.name ?? "", status: r.status, requestedBy: r.requested_by,
    createdAt: r.created_at.toISOString(), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), fileName: r.file_name,
    size: r.size === null ? null : Number(r.size), sha256: r.sha256, counts: r.counts, error: r.error,
  };
}

const g = globalThis as unknown as { __adminExportsRecovered?: Promise<void> };

/** Jobs that were running when this process last stopped will never finish; say so. */
function recover(): Promise<void> {
  g.__adminExportsRecovered ??= q(
    `UPDATE exports SET status = 'failed', error = 'Interrupted when the Admin center restarted; run it again', finished_at = now()
     WHERE status IN ('pending', 'running')`,
  ).then(() => {}, (e) => {
    g.__adminExportsRecovered = undefined;
    throw e;
  });
  return g.__adminExportsRecovered;
}

export async function listExports(matterId: string): Promise<ExportRecord[]> {
  await recover();
  return (await q<Row>(`SELECT * FROM exports WHERE matter_id = $1 ORDER BY created_at DESC`, [matterId])).map(toExport);
}

export async function getExport(me: Me, id: string): Promise<ExportRecord> {
  const [r] = await q<Row>(`SELECT * FROM exports WHERE id = $1`, [uuid(id, "That export")]);
  if (!r) throw new UserError("That export was not found", 404);
  await getMatter(me, r.matter_id);
  return toExport(r);
}

/** Starts an export of a saved search and returns at once; the job runs on in the background. */
export async function startExport(me: Me, searchId: string, c?: Caller): Promise<ExportRecord> {
  if (!process.env.COMPLIANCE_TOKEN) throw new UserError("Set COMPLIANCE_TOKEN so the Admin center can export from the apps", 409);
  await recover();
  const s = await getSearch(me, searchId);
  const m = await getMatter(me, s.matterId);
  const [r] = await q<Row>(`INSERT INTO exports (matter_id, search_id, search, requested_by) VALUES ($1, $2, $3, $4) RETURNING *`, [
    m.id, s.id, JSON.stringify(s), me.email,
  ]);
  await record(me.email, "export.create", r.id, { matter: m.id, matterName: m.name, search: s.id, searchName: s.name });
  const job = runExport(r.id, me, m.name, c ?? caller(30_000));
  // Tests wait for the job; the API doesn't.
  (globalThis as unknown as { __adminLastExport?: Promise<void> }).__adminLastExport = job;
  return toExport(r);
}

export async function runExport(id: string, me: Me, matterName: string, c: Caller): Promise<void> {
  const [r] = await q<Row>(`UPDATE exports SET status = 'running', started_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`, [id]);
  if (!r) return;
  const s = r.search;
  const dir = exportDir();
  const fileName = `${id}.zip`;
  const part = path.join(dir, `${fileName}.part`);
  let fd: number | null = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(part, "w", 0o600);
    const whole = createHash("sha256");
    let size = 0;
    const out = fd;
    const zip = new ExportZip((chunk) => {
      fs.writeSync(out, chunk);
      whole.update(chunk);
      size += chunk.length;
    });
    const input = inputOf(s);
    const apps = targets(input);
    const counts: Record<string, AppCount> = {};
    for (const app of apps) {
      const found = await collectAll(app, toRequest(input), c, MAX_ITEMS_PER_APP);
      const cnt = zip.count(app);
      const want = new Set(found.hits.map((h) => h.id));
      const deletedIds = new Set(found.hits.filter((h) => h.deleted).map((h) => h.id));
      try {
        await exportItems(app, [...want], c, (items) => {
          for (const item of items) {
            if (!want.has(item.id)) continue;
            want.delete(item.id);
            zip.addItem({ ...item, app, deleted: item.deleted || deletedIds.has(item.id) || undefined });
          }
        });
      } catch (e) {
        cnt.error = (e as Error).message;
      }
      cnt.missing = want.size;
      if (found.truncated) cnt.truncated = true;
      if (found.error) cnt.error = cnt.error ? `${found.error}; ${cnt.error}` : found.error;
      counts[app] = cnt;
    }
    zip.finish({
      matter: { id: r.matter_id, name: matterName },
      search: { id: s.id, name: s.name, query: s.query, custodians: s.custodians, apps: s.apps.length ? s.apps : "all", from: s.from, to: s.to },
      apps: apps.map((a) => ({ id: a, name: appName(a) })),
      exportedBy: me.email,
      exportedAt: new Date().toISOString(),
      exportId: id,
      limits: { maxItemsPerApp: MAX_ITEMS_PER_APP },
    });
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(part, path.join(dir, fileName));
    const failedAll = apps.length > 0 && apps.every((a) => counts[a].error && !counts[a].items);
    const shown = Object.fromEntries(
      Object.entries(counts).map(([a, n]) => [a, { items: n.items, ...(n.truncated ? { truncated: true } : {}), ...(n.error ? { error: n.error } : {}) }]),
    );
    await q(
      `UPDATE exports SET status = $2, finished_at = now(), file_name = $3, size = $4, sha256 = $5, counts = $6, error = $7 WHERE id = $1`,
      [id, failedAll ? "failed" : "done", fileName, size, whole.digest("hex"), JSON.stringify(shown), failedAll ? "No app could be exported; see the counts" : null],
    );
    await record(me.email, failedAll ? "export.fail" : "export.finish", id, { counts: shown, size });
  } catch (e) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(part, { force: true });
    console.error("[admin] export failed:", e);
    await q(`UPDATE exports SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 500)]).catch(() => {});
    await record(me.email, "export.fail", id, { error: (e as Error).message.slice(0, 500) }).catch(() => {});
  }
}

/** The finished zip, for download. */
export async function exportFile(me: Me, id: string): Promise<{ path: string; name: string; size: number; record: ExportRecord }> {
  const e = await getExport(me, id);
  if (e.status !== "done" || !e.fileName) throw new UserError("That export isn't ready", 409);
  const p = path.join(exportDir(), path.basename(e.fileName));
  if (!fs.existsSync(p)) throw new UserError("The export file is gone from the server", 410);
  const [m] = await q<{ name: string }>(`SELECT name FROM matters WHERE id = $1`, [e.matterId]);
  const stamp = (e.finishedAt ?? e.createdAt).slice(0, 10);
  const name = `${(m?.name ?? "matter").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "matter"}-${stamp}-${e.id.slice(0, 8)}.zip`;
  return { path: p, name, size: fs.statSync(p).size, record: e };
}
