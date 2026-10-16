import { q } from "../db";
import { GraphError, type Graph } from "./graph";

/**
 * Discovery: what a Microsoft 365 tenant holds, so the admin can map people and pick sites.
 * Users with their mailbox and OneDrive sizes, and SharePoint sites with their libraries' sizes
 * and, for sites that belong to a Microsoft 365 group, the group's owners and members.
 */

type GUser = { id: string; displayName?: string; userPrincipalName?: string; mail?: string; accountEnabled?: boolean; userType?: string };
type GSite = { id: string; displayName?: string; name?: string; webUrl?: string };

/** Runs `fn` over `items`, `n` at a time. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** A small CSV reader for Microsoft's usage reports (quoted fields, commas, a BOM). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const missing = (e: unknown) => e instanceof GraphError && (e.status === 404 || e.code === "MailboxNotEnabledForRESTAPI" || e.code === "ResourceNotFound");

export type Discovery = { users: number; sites: number; notes: string[] };

export async function discoverM365(g: Graph, sourceId: string): Promise<Discovery> {
  const notes: string[] = [];
  const all = await g.all<GUser>("/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,userType&$top=999");
  const people = all.filter((u) => u.userType !== "Guest" && (u.mail || u.userPrincipalName));

  // Mailbox sizes come from the usage report (Reports.Read.All); without it, item counts only.
  const sizes = new Map<string, { bytes: number; items: number }>();
  try {
    const res = await g.request("/reports/getMailboxUsageDetail(period='D7')", { headers: { Accept: "text/csv, application/octet-stream, */*" } });
    for (const r of parseCsv(await res.text())) {
      const upn = (r["User Principal Name"] ?? "").toLowerCase();
      if (upn) sizes.set(upn, { bytes: Number(r["Storage Used (Byte)"] || 0), items: Number(r["Item Count"] || 0) });
    }
    if (sizes.size && [...sizes.keys()].every((k) => !k.includes("@"))) {
      notes.push("Mailbox sizes are hidden: in the Microsoft 365 admin center, turn off \"Display concealed user, group, and site names in all reports\" (Settings, Org settings, Reports).");
      sizes.clear();
    }
  } catch (e) {
    if (e instanceof GraphError && (e.status === 403 || e.status === 401)) notes.push("Grant Reports.Read.All to see mailbox sizes; item counts are shown instead.");
    else if (!(e instanceof GraphError)) throw e;
  }

  await pool(people, 6, async (u) => {
    const id = encodeURIComponent(u.id);
    const email = (u.mail || u.userPrincipalName || "").toLowerCase();
    let hasMailbox: boolean | null = null;
    let mailItems: number | null = null;
    let driveBytes: number | null = null;
    let hasDrive: boolean | null = null;
    try {
      const folders = await g.all<{ totalItemCount?: number }>(`/users/${id}/mailFolders?$top=100&$select=totalItemCount`);
      hasMailbox = true;
      mailItems = folders.reduce((n, f) => n + (f.totalItemCount ?? 0), 0);
    } catch (e) {
      if (missing(e)) hasMailbox = false;
      else if (!(e instanceof GraphError)) throw e;
    }
    try {
      const d = await g.json<{ quota?: { used?: number } }>(`/users/${id}/drive?$select=id,quota`);
      hasDrive = true;
      driveBytes = d.quota?.used ?? null;
    } catch (e) {
      if (missing(e)) hasDrive = false;
      else if (!(e instanceof GraphError)) throw e;
    }
    const size = sizes.get((u.userPrincipalName ?? "").toLowerCase());
    await q(
      `INSERT INTO migration_users (source_id, ext_id, email, name, enabled, mail_bytes, mail_items, drive_bytes, has_mailbox, has_drive)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (source_id, ext_id) DO UPDATE SET email = $3, name = $4, enabled = $5, mail_bytes = $6, mail_items = $7,
         drive_bytes = $8, has_mailbox = $9, has_drive = $10, seen_at = now()`,
      [sourceId, u.id, email, (u.displayName ?? "").slice(0, 200), u.accountEnabled !== false, size?.bytes ?? null, size?.items ?? mailItems, driveBytes, hasMailbox, hasDrive],
    );
  });

  // SharePoint sites (not people's OneDrives, which come with each person).
  let sites: GSite[] = [];
  try {
    sites = (await g.all<GSite>("/sites?search=*&$select=id,displayName,name,webUrl")).filter((s) => !/-my\.sharepoint\.[a-z]+\/personal\//i.test(s.webUrl ?? ""));
  } catch (e) {
    if (e instanceof GraphError && e.status === 403) notes.push("Grant Sites.Read.All to see SharePoint sites.");
    else throw e;
  }
  // Group-connected sites: the group's owners and members become the library's.
  const members = new Map<string, { email: string; role: "owner" | "member" }[]>();
  try {
    const groups = await g.all<{ id: string }>("/groups?$filter=groupTypes/any(c:c+eq+'Unified')&$select=id,displayName");
    await pool(groups, 6, async (gr) => {
      const id = encodeURIComponent(gr.id);
      const root = await g.json<{ id: string }>(`/groups/${id}/sites/root?$select=id`).catch(() => null);
      if (!root) return;
      const addr = (p: { mail?: string; userPrincipalName?: string }) => (p.mail || p.userPrincipalName || "").toLowerCase();
      const owners = (await g.all<{ mail?: string; userPrincipalName?: string }>(`/groups/${id}/owners?$select=mail,userPrincipalName`)).map(addr).filter(Boolean);
      const mem = (await g.all<{ mail?: string; userPrincipalName?: string }>(`/groups/${id}/members?$select=mail,userPrincipalName`)).map(addr).filter(Boolean);
      members.set(root.id, [...owners.map((email) => ({ email, role: "owner" as const })), ...mem.filter((m) => !owners.includes(m)).map((email) => ({ email, role: "member" as const }))]);
    });
  } catch (e) {
    if (e instanceof GraphError && e.status === 403) notes.push("Grant GroupMember.Read.All to bring SharePoint site members across as library members.");
    else if (!(e instanceof GraphError)) throw e;
  }
  await pool(sites, 6, async (s) => {
    const drives = await g.all<{ quota?: { used?: number }; driveType?: string }>(`/sites/${encodeURIComponent(s.id)}/drives?$select=id,quota,driveType`).catch(() => null);
    const libs = drives?.filter((d) => !d.driveType || d.driveType === "documentLibrary") ?? null;
    await q(
      `INSERT INTO migration_sites (source_id, site_id, name, url, drive_bytes, libraries, members)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source_id, site_id) DO UPDATE SET name = $3, url = $4, drive_bytes = $5, libraries = $6, members = $7, seen_at = now()`,
      [sourceId, s.id, (s.displayName || s.name || s.webUrl || s.id).slice(0, 200), s.webUrl ?? "",
       libs ? libs.reduce((n, d) => n + (d.quota?.used ?? 0), 0) : null, libs?.length ?? null, JSON.stringify(members.get(s.id) ?? [])],
    );
  });
  return { users: people.length, sites: sites.length, notes };
}
