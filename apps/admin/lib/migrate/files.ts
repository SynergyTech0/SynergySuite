import { GraphError } from "./graph";
import { isFatal, type JobContext } from "./context";
import { SuiteError, type DriveTarget, type Who } from "./suite";
import type { Workload } from "./types";

/**
 * Files from a OneDrive or a SharePoint document library into Drive: folders first, then each
 * file streamed straight from Microsoft into Drive with its original date, through the drive's
 * delta query. A re-run brings across what changed: new and edited files (a new version in
 * Drive), renames, moves and deletions (to Drive's recycle bin).
 */

type DriveItem = {
  id: string; name?: string; size?: number; lastModifiedDateTime?: string; cTag?: string; eTag?: string;
  parentReference?: { id?: string; driveId?: string };
  file?: { mimeType?: string }; folder?: { childCount?: number }; root?: unknown; deleted?: unknown;
  package?: { type?: string }; remoteItem?: unknown; "@removed"?: unknown;
};

type Info = { name: string; parent: string; kind: "file" | "folder" | "root" };

const SELECT = "$select=id,name,size,lastModifiedDateTime,cTag,eTag,parentReference,file,folder,root,deleted,package,remoteItem";

export type DriveJob = { driveId: string; root: DriveTarget; workload: Workload; as: Who; label: string };

function targetOf(root: DriveTarget, parentTarget: string): DriveTarget {
  return parentTarget === "root" ? root : { parent: parentTarget };
}

async function one(ctx: JobContext, d: DriveJob, it: DriveItem): Promise<"done" | "later"> {
  const w = d.workload;
  const key = `${d.driveId}:${it.id}`;
  const have = await ctx.items.get(w, key);
  const label = it.name || it.id;

  if (it.deleted || it["@removed"]) {
    if (have?.target_id && have.target_id !== "root") {
      try {
        await ctx.suite.driveTrash(d.as, have.target_id);
      } catch (e) {
        if (!(e instanceof SuiteError && e.notFound)) throw e;
      }
      await ctx.items.del(w, key);
      await ctx.copied(w, "deleted");
    }
    return "done";
  }
  if (it.root) {
    await ctx.items.put(w, key, "root", "", { name: "", parent: "", kind: "root" } satisfies Info);
    return "done";
  }
  if (it.package) {
    if (!have) {
      await ctx.items.put(w, key, "", "", { skipped: it.package.type ?? "package" });
      await ctx.skipped(w, label, it.package.type === "oneNote" ? "OneNote notebook (not migrated yet)" : "Package item (not migrated yet)");
    }
    return "done";
  }
  if (it.remoteItem) {
    if (!have) {
      await ctx.items.put(w, key, "", "", { skipped: "remote" });
      await ctx.skipped(w, label, "Shared from someone else's drive; it is copied with the owner's files");
    }
    return "done";
  }
  if (have?.info?.skipped && !have.info.failed) return "done";

  const parentKey = `${d.driveId}:${it.parentReference?.id ?? ""}`;
  const parent = it.parentReference?.id ? await ctx.items.get(w, parentKey) : null;
  if (!parent || !parent.target_id) {
    if (parent?.info?.skipped) {
      await ctx.items.put(w, key, "", "", { skipped: "inside a skipped item" });
      return "done";
    }
    return "later";
  }
  const name = (it.name ?? "").slice(0, 255);
  const at = targetOf(d.root, parent.target_id);
  const info: Info = { name, parent: parent.target_id, kind: it.folder ? "folder" : "file" };
  const version = it.cTag || it.eTag || it.lastModifiedDateTime || "";

  if (have?.target_id) {
    const old = have.info as Info;
    let changed = false;
    if (old.parent !== info.parent) {
      await ctx.suite.driveMove(d.as, have.target_id, at);
      changed = true;
    }
    if (old.name !== name) {
      await ctx.suite.driveRename(d.as, have.target_id, name);
      changed = true;
    }
    if (it.file && have.version !== version) {
      await upload(ctx, d, it, at, name);
      changed = true;
    }
    await ctx.items.put(w, key, have.target_id, it.folder ? "" : version, info);
    if (changed) await ctx.copied(w, "updated");
    return "done";
  }

  const retry = have?.info?.failed === true;
  if (it.folder) {
    const id = await ctx.suite.driveFolder(d.as, at, name);
    await ctx.items.put(w, key, id, "", info);
  } else {
    if ((it.size ?? 0) > ctx.limits.maxFileBytes) {
      await ctx.items.put(w, key, "", "", { skipped: "too large" });
      await ctx.skipped(w, label, `Larger than ${Math.round(ctx.limits.maxFileBytes / 1048576)} MB`);
      return "done";
    }
    let id: string;
    try {
      id = await upload(ctx, d, it, at, name);
    } catch (e) {
      if (e instanceof SuiteError && e.tooLarge) {
        await ctx.items.put(w, key, "", "", { skipped: "too large" });
        await ctx.skipped(w, label, "Too large for Drive (its file size limit or the person's storage)");
        return "done";
      }
      throw e;
    }
    await ctx.items.put(w, key, id, version, info);
  }
  if (retry) ctx.recovered(w);
  await ctx.copied(w);
  return "done";
}

async function upload(ctx: JobContext, d: DriveJob, it: DriveItem, at: DriveTarget, name: string): Promise<string> {
  const { body, size } = await ctx.graph!.stream(`/drives/${encodeURIComponent(d.driveId)}/items/${encodeURIComponent(it.id)}/content`);
  try {
    return await ctx.suite.driveUpload(d.as, at, name, body, size ?? it.size ?? null, it.lastModifiedDateTime ?? null);
  } catch (e) {
    await body?.cancel().catch(() => {});
    throw e;
  }
}

async function safely(ctx: JobContext, d: DriveJob, it: DriveItem): Promise<"done" | "later"> {
  try {
    return await one(ctx, d, it);
  } catch (e) {
    if (isFatal(e)) throw e;
    await ctx.items.put(d.workload, `${d.driveId}:${it.id}`, "", "", { failed: true, error: (e as Error).message.slice(0, 300) });
    await ctx.failed(d.workload, it.name || it.id, e);
    return "done";
  }
}

export async function importDrive(ctx: JobContext, d: DriveJob): Promise<void> {
  const g = ctx.graph!;
  const drive = encodeURIComponent(d.driveId);

  // Files that failed last time, first (their folder is known by now).
  for (const f of await ctx.items.failed(d.workload)) {
    const id = f.item_id.slice(d.driveId.length + 1);
    if (!f.item_id.startsWith(`${d.driveId}:`)) continue;
    try {
      const it = await g.json<DriveItem>(`/drives/${drive}/items/${encodeURIComponent(id)}?${SELECT}`);
      await safely(ctx, d, it);
    } catch (e) {
      if (e instanceof GraphError && e.status === 404) {
        await ctx.items.del(d.workload, f.item_id);
        ctx.recovered(d.workload);
      } else if (isFatal(e)) throw e;
    }
  }

  await ctx.step(d.workload, d.label);
  const cur = await ctx.cursors.get<{ next: string; delta: string }>(d.workload, d.driveId);
  let url = cur.next || cur.delta || `/drives/${drive}/root/delta?${SELECT}`;
  let orphans: DriveItem[] = [];
  for (;;) {
    const page = await g.page<DriveItem>(url, { Prefer: "odata.maxpagesize=200" });
    let pending = [...orphans, ...page.value];
    // A folder's children can come before it within a page: go round until nothing moves.
    for (let pass = 0; pending.length && pass < 50; pass++) {
      const later: DriveItem[] = [];
      for (const it of pending) if ((await safely(ctx, d, it)) === "later") later.push(it);
      if (later.length === pending.length) break;
      pending = later;
    }
    orphans = pending;
    if (page.nextLink) {
      await ctx.cursors.put(d.workload, d.driveId, { next: page.nextLink, delta: cur.delta ?? "" });
      url = page.nextLink;
      continue;
    }
    for (const it of orphans) {
      await ctx.items.put(d.workload, `${d.driveId}:${it.id}`, "", "", { failed: true, error: "its folder was not found" });
      await ctx.failed(d.workload, it.name || it.id, new Error("Its folder was not found"));
    }
    await ctx.cursors.put(d.workload, d.driveId, { next: "", delta: page.deltaLink ?? cur.delta ?? "" });
    break;
  }
}

/** The person's OneDrive, if they have one. */
export async function importOneDrive(ctx: JobContext): Promise<void> {
  await ctx.step("files", "OneDrive");
  let driveId: string;
  try {
    driveId = (await ctx.graph!.json<{ id: string }>(`/users/${encodeURIComponent(ctx.job.subject_id)}/drive?$select=id`)).id;
  } catch (e) {
    if (e instanceof GraphError && (e.status === 404 || e.status === 403)) {
      await ctx.skipped("files", "OneDrive", e.status === 404 ? "This person has no OneDrive" : "Microsoft refused access to this OneDrive");
      return;
    }
    throw e;
  }
  await importDrive(ctx, { driveId, root: {}, workload: "files", as: ctx.who, label: "OneDrive" });
}

/**
 * A SharePoint site: each document library becomes a Drive shared library (named after the
 * site, plus the library's name when there are several), with the site's owners and members
 * that have suite accounts as its owners and editors. The admin running it creates them.
 */
export async function importSite(ctx: JobContext, site: { name: string; members: { email: string; role: "owner" | "member" }[] }): Promise<void> {
  const g = ctx.graph!;
  await ctx.step("library", site.name);
  const drives = await g.all<{ id: string; name: string; driveType?: string }>(`/sites/${encodeURIComponent(ctx.job.subject_id)}/drives?$select=id,name,driveType`);
  const libs = drives.filter((d) => !d.driveType || d.driveType === "documentLibrary");
  for (const lib of libs) {
    const name = libs.length > 1 && !/^(documents|shared documents)$/i.test(lib.name) ? `${site.name} - ${lib.name}` : site.name;
    let target = (await ctx.items.get("library", `lib:${lib.id}`))?.target_id;
    if (!target) {
      target = await ctx.suite.driveLibrary(ctx.who, name.slice(0, 200), `Copied from SharePoint (${lib.name})`);
      await ctx.items.put("library", `lib:${lib.id}`, target, "", { name });
    }
    for (const m of site.members) {
      const email = ctx.mapping.get(m.email.toLowerCase());
      if (!email || email === ctx.who.email) continue;
      try {
        await ctx.suite.driveMember(ctx.who, target, email, m.role === "owner" ? "owner" : "editor");
      } catch (e) {
        if (isFatal(e)) throw e;
        await ctx.failed("library", `${name}: member ${email}`, e);
      }
    }
    await importDrive(ctx, { driveId: lib.id, root: { library: target }, workload: "library", as: ctx.who, label: name });
  }
}
