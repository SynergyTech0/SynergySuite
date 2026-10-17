import { GraphError, TooLarge, type Graph } from "./graph";
import { isFatal, type JobContext } from "./context";
import { SuiteError, type MailPlace } from "./suite";

/**
 * Mail from Microsoft 365: every folder with its hierarchy, each message as raw MIME
 * (/messages/{id}/$value) appended into the person's suite mailbox with its read and flag state
 * and received date. Each folder is read through its delta query, so a re-run copies only new
 * messages and brings read, flag and folder changes across. Immutable IDs keep a message's id
 * when it moves between folders, so a move is a move here too, not a second copy.
 */

const WELL_KNOWN: [string, string][] = [
  ["inbox", "inbox"], ["sentitems", "sent"], ["drafts", "drafts"], ["deleteditems", "trash"], ["junkemail", "junk"], ["archive", "archive"],
];
/** Folders that hold no mail worth copying (Outlook's own bookkeeping). */
const SKIP_FOLDERS = new Set(["conversation history", "sync issues", "conflicts", "local failures", "server failures", "outbox"]);

type GFolder = { id: string; displayName: string; childFolderCount?: number; totalItemCount?: number };
type GMessage = {
  id: string; isRead?: boolean; flag?: { flagStatus?: string }; receivedDateTime?: string; createdDateTime?: string;
  subject?: string; "@removed"?: unknown;
};
type Folder = { id: string; name: string; place: MailPlace; total: number };

const PREFER = { Prefer: 'IdType="ImmutableId", odata.maxpagesize=50' };
const SELECT = "$select=id,isRead,flag,receivedDateTime,createdDateTime,subject";

export async function mailFolders(g: Graph, user: string): Promise<Folder[]> {
  const u = encodeURIComponent(user);
  const roles = new Map<string, string>();
  for (const [wk, role] of WELL_KNOWN) {
    try {
      const f = await g.json<{ id: string }>(`/users/${u}/mailFolders/${wk}?$select=id`, PREFER);
      roles.set(f.id, role);
    } catch (e) {
      if (!(e instanceof GraphError) || (e.status !== 404 && e.status !== 400)) throw e;
    }
  }
  const out: Folder[] = [];
  const walk = async (path: string, parent: MailPlace | null, depth: number) => {
    const list = await g.all<GFolder>(path, PREFER);
    for (const f of list) {
      if (!parent && SKIP_FOLDERS.has(f.displayName.toLowerCase()) && !roles.has(f.id)) continue;
      const role = roles.get(f.id);
      const place: MailPlace = parent ? { role: parent.role, path: [...parent.path, f.displayName] } : role ? { role, path: [] } : { role: null, path: [f.displayName] };
      out.push({ id: f.id, name: [...(place.role ? [place.role] : []), ...place.path].join("/"), place, total: f.totalItemCount ?? 0 });
      if ((f.childFolderCount ?? 0) > 0 && depth < 20) {
        await walk(`/users/${u}/mailFolders/${encodeURIComponent(f.id)}/childFolders?$top=100&$select=id,displayName,childFolderCount,totalItemCount`, place, depth + 1);
      }
    }
  };
  await walk(`/users/${u}/mailFolders?$top=100&$select=id,displayName,childFolderCount,totalItemCount`, null, 0);
  return out;
}

const stateOf = (m: GMessage) => ({ seen: m.isRead === true, flagged: m.flag?.flagStatus === "flagged" });
const versionOf = (m: GMessage, folderId: string) => `${m.isRead ? 1 : 0}${m.flag?.flagStatus === "flagged" ? 1 : 0}:${folderId}`;

async function copyOne(ctx: JobContext, g: Graph, user: string, m: GMessage, folder: Folder): Promise<void> {
  const label = m.subject || "(no subject)";
  const have = await ctx.items.get("mail", m.id);
  const version = versionOf(m, folder.id);
  if (have && have.target_id) {
    if (have.version === version) return;
    const info = have.info as { folder: string; uid: number | null; folderId: string };
    if (!info.uid) {
      await ctx.items.put("mail", m.id, have.target_id, version, { ...info, folderId: folder.id });
      return;
    }
    const moved = info.folderId !== folder.id;
    const now = await ctx.suite.mailUpdate(ctx.who, { folder: info.folder, uid: info.uid }, stateOf(m), moved ? folder.place : null);
    if (!now) {
      // Deleted in the suite mailbox since: leave it deleted.
      await ctx.items.put("mail", m.id, have.target_id, version, { ...info, folderId: folder.id, goneHere: true });
      return;
    }
    await ctx.items.put("mail", m.id, `${now.folder}:${now.uid ?? ""}`, version, { folder: now.folder, uid: now.uid, folderId: folder.id });
    await ctx.copied("mail", "updated");
    return;
  }
  if (have?.info?.skipped) return;
  const retry = have?.info?.failed === true;
  let raw: Buffer;
  try {
    raw = await g.bytes(`/users/${encodeURIComponent(user)}/messages/${encodeURIComponent(m.id)}/$value`, ctx.limits.maxMessageBytes);
  } catch (e) {
    if (e instanceof TooLarge) {
      await ctx.items.put("mail", m.id, "", version, { skipped: "too large", folderId: folder.id });
      return ctx.skipped("mail", label, `Larger than ${Math.round(ctx.limits.maxMessageBytes / 1048576)} MB`);
    }
    throw e;
  }
  try {
    const at = await ctx.suite.mailAppend(ctx.who, raw, folder.place, { ...stateOf(m), date: m.receivedDateTime || m.createdDateTime || null });
    await ctx.items.put("mail", m.id, `${at.folder}:${at.uid ?? ""}`, version, { folder: at.folder, uid: at.uid, folderId: folder.id });
  } catch (e) {
    if (e instanceof SuiteError && e.tooLarge) {
      await ctx.items.put("mail", m.id, "", version, { skipped: "too large", folderId: folder.id });
      return ctx.skipped("mail", label, "Too large for the suite mailbox");
    }
    throw e;
  }
  if (retry) ctx.recovered("mail");
  await ctx.copied("mail");
}

export async function importMail(ctx: JobContext): Promise<void> {
  const g = ctx.graph!;
  const user = ctx.job.subject_id;
  await ctx.step("mail", "Reading folders");
  await ctx.suite.provisionMailbox(ctx.who);
  const folders = await mailFolders(g, user);
  const byId = new Map(folders.map((f) => [f.id, f]));

  // Messages that failed last time, first.
  for (const f of await ctx.items.failed("mail")) {
    const folder = byId.get(String(f.info.folderId));
    if (!folder) continue;
    try {
      const m = await g.json<GMessage>(`/users/${encodeURIComponent(user)}/messages/${encodeURIComponent(f.item_id)}?${SELECT}`, PREFER);
      await copyOne(ctx, g, user, m, folder);
    } catch (e) {
      if (e instanceof GraphError && e.status === 404) {
        await ctx.items.del("mail", f.item_id);
        ctx.recovered("mail");
      }
    }
  }

  for (const folder of folders) {
    await ctx.step("mail", folder.name);
    const cur = await ctx.cursors.get<{ next: string; delta: string }>("mail", folder.id);
    let url = cur.next || cur.delta || `/users/${encodeURIComponent(user)}/mailFolders/${encodeURIComponent(folder.id)}/messages/delta?${SELECT}`;
    for (;;) {
      const page = await g.page<GMessage>(url, PREFER);
      for (const m of page.value) {
        if (m["@removed"]) continue; // deleted or moved out: a move shows up in the folder it went to
        try {
          await copyOne(ctx, g, user, m, folder);
        } catch (e) {
          if (isFatal(e)) throw e;
          await ctx.items.put("mail", m.id, "", "", { failed: true, folderId: folder.id, error: (e as Error).message.slice(0, 300) });
          await ctx.failed("mail", m.subject || m.id, e);
        }
      }
      if (page.nextLink) {
        await ctx.cursors.put("mail", folder.id, { next: page.nextLink, delta: cur.delta ?? "" });
        url = page.nextLink;
        continue;
      }
      await ctx.cursors.put("mail", folder.id, { next: "", delta: page.deltaLink ?? cur.delta ?? "" });
      break;
    }
  }
}
