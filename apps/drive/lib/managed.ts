/**
 * The service API other suite apps use for libraries they keep the people of (`/api/svc/managed-libraries`,
 * Bearer DRIVE_SVC_TOKEN). Sites makes one library per site and sets its members whenever the
 * site's permissions change; Drive marks it `managed_by` so its owners change people in Sites, not here.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { q, tx } from "./db";
import { removeLibrary } from "./drive";
import { type Role, UserError, cleanEmail, cleanName, isRole } from "./names";

/** True when the request carries `Authorization: Bearer <DRIVE_SVC_TOKEN>`. */
export function svcAuthorized(header: string | null, token = process.env.DRIVE_SVC_TOKEN || ""): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Wraps a service route: checks the token and turns errors into JSON. */
export function svcRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    if (!svcAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "bad token" }, { status: 401 });
    try {
      return NextResponse.json((await fn(req, ...rest)) ?? { ok: true });
    } catch (err) {
      if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
      if ((err as { code?: string })?.code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
      console.error("[drive managed]", err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SvcMember = { email: string; role: Role };

function cleanMembers(raw: unknown): SvcMember[] {
  if (!Array.isArray(raw)) throw new UserError("members must be a list");
  const out = new Map<string, Role>();
  for (const m of raw.slice(0, 5000)) {
    const role = (m as { role?: unknown })?.role;
    if (!isRole(role)) throw new UserError("Each member needs a role: viewer, editor or owner");
    out.set(cleanEmail((m as { email?: unknown }).email), role);
  }
  const members = [...out].map(([email, role]) => ({ email, role }));
  if (!members.some((m) => m.role === "owner")) throw new UserError("A library needs at least one owner");
  return members;
}

async function managed(libraryId: string): Promise<{ id: string; managed_by: string }> {
  if (!UUID.test(libraryId)) throw new UserError("Not found", 404);
  const [l] = await q<{ id: string; managed_by: string | null }>("SELECT id, managed_by FROM libraries WHERE id = $1", [libraryId]);
  if (!l) throw new UserError("Not found", 404);
  if (!l.managed_by) throw new UserError("That library is managed in Drive", 409);
  return { id: l.id, managed_by: l.managed_by };
}

/** A new library kept by another app: { name, description?, managedBy, members }. */
export async function createManagedLibrary(b: { name?: unknown; description?: unknown; managedBy?: unknown; members?: unknown }): Promise<{ id: string }> {
  const name = cleanName(String(b.name ?? ""));
  const managedBy = String(b.managedBy ?? "").trim().slice(0, 100);
  if (!managedBy) throw new UserError("managedBy required");
  const members = cleanMembers(b.members);
  return tx(async (tq) => {
    const [l] = await tq<{ id: string }>(
      "INSERT INTO libraries (name, description, created_by, managed_by) VALUES ($1, $2, $3, $4) RETURNING id",
      [name, String(b.description ?? "").slice(0, 500), managedBy, managedBy],
    );
    for (const m of members) {
      await tq("INSERT INTO library_members (library_id, email, role) VALUES ($1, $2, $3)", [l.id, m.email, m.role]);
    }
    return { id: l.id };
  });
}

/** Renames a managed library and/or replaces its people with `members`. */
export async function updateManagedLibrary(libraryId: string, b: { name?: unknown; description?: unknown; members?: unknown }): Promise<void> {
  const lib = await managed(libraryId);
  const members = b.members !== undefined ? cleanMembers(b.members) : null;
  await tx(async (tq) => {
    if (b.name !== undefined) await tq("UPDATE libraries SET name = $2 WHERE id = $1", [lib.id, cleanName(String(b.name))]);
    if (b.description !== undefined) await tq("UPDATE libraries SET description = $2 WHERE id = $1", [lib.id, String(b.description).slice(0, 500)]);
    if (members) {
      await tq("DELETE FROM library_members WHERE library_id = $1 AND NOT (email = ANY($2::text[]))", [lib.id, members.map((m) => m.email)]);
      for (const m of members) {
        await tq(
          `INSERT INTO library_members (library_id, email, role) VALUES ($1, $2, $3)
           ON CONFLICT (library_id, email) DO UPDATE SET role = EXCLUDED.role`,
          [lib.id, m.email, m.role],
        );
      }
    }
  });
}

/** Deletes a managed library; 409 while it still holds files. */
export async function deleteManagedLibrary(libraryId: string): Promise<void> {
  await removeLibrary((await managed(libraryId)).id);
}

export type SvcItem = { id: string; name: string; kind: "file" | "folder"; mime: string; size: number; modifiedAt: string; modifiedBy: string };

/**
 * One folder of a managed library (its top when `folder` is empty), for the app showing it. That
 * app has already checked the person may see the library.
 */
export async function listManagedLibrary(libraryId: string, folder: string): Promise<{ items: SvcItem[]; crumbs: { id: string | null; name: string }[] }> {
  const lib = await managed(libraryId);
  const [l] = await q<{ name: string }>("SELECT name FROM libraries WHERE id = $1", [lib.id]);
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: l.name }];
  let parent: string | null = null;
  if (folder) {
    if (!UUID.test(folder)) throw new UserError("Not found", 404);
    const chain = await q<{ id: string; name: string; library_id: string | null; kind: string; trash_root: string | null }>(
      `WITH RECURSIVE up AS (
         SELECT i.id, i.name, i.parent_id, i.library_id, i.kind, i.trash_root, 0 AS depth FROM items i WHERE i.id = $1
         UNION ALL
         SELECT p.id, p.name, p.parent_id, p.library_id, p.kind, p.trash_root, up.depth + 1 FROM items p JOIN up ON p.id = up.parent_id
       ) SELECT * FROM up ORDER BY depth DESC`,
      [folder],
    );
    const f = chain[chain.length - 1];
    if (!f || f.library_id !== lib.id || f.kind !== "folder" || f.trash_root) throw new UserError("Not found", 404);
    crumbs.push(...chain.map((c) => ({ id: c.id, name: c.name })));
    parent = f.id;
  }
  const rows = await q<{ id: string; name: string; kind: "file" | "folder"; mime: string; size: string; modified_at: Date; modified_by: string }>(
    `SELECT id, name, kind, mime, size, modified_at, modified_by FROM items
      WHERE space = $1 AND parent_id IS NOT DISTINCT FROM $2 AND trash_root IS NULL
      ORDER BY (kind = 'folder') DESC, lower(name) LIMIT 500`,
    [`l:${lib.id}`, parent],
  );
  return {
    crumbs,
    items: rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, mime: r.mime, size: Number(r.size),
      modifiedAt: r.modified_at.toISOString(), modifiedBy: r.modified_by,
    })),
  };
}
