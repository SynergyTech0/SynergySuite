import { randomBytes } from "node:crypto";
import { q, tx } from "./db";
import * as blobs from "./blobs";
import type { Me } from "./api";
import { holdChecker, policy } from "./compliance";
import { type Role, UserError, atLeast, cleanEmail, cleanName, isRole, isTextMime, maxRole, mimeFor, splitPath, uniqueName } from "./names";

/** Rows as the API returns them. */
export type Item = {
  id: string;
  name: string;
  kind: "file" | "folder";
  mime: string;
  size: number;
  version: number;
  owner: string;
  libraryId: string | null;
  parentId: string | null;
  modifiedAt: string;
  modifiedBy: string;
  createdAt: string;
  trashedAt: string | null;
  trashedBy: string | null;
  starred: boolean;
  shared: boolean;
  /** Where it lives, for search, recent and starred results ("My files", a library, a person). */
  location?: string;
};

type Row = {
  id: string;
  space: string;
  library_id: string | null;
  owner: string;
  parent_id: string | null;
  kind: "file" | "folder";
  name: string;
  mime: string;
  size: string;
  sha256: string | null;
  version: number;
  text: string | null;
  summary: string | null;
  summary_sha: string | null;
  created_by: string;
  modified_by: string;
  created_at: Date;
  modified_at: Date;
  trashed_at: Date | null;
  trashed_by: string | null;
  trash_root: string | null;
  held_deleted_at: Date | null;
};

/** Where new items go: a folder, or the top of someone's files or of a library. */
export type Target = { parent?: string | null; library?: string | null };

type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

const NIL = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function personalSpace(email: string): string {
  return `u:${email}`;
}

function librarySpace(id: string): string {
  return `l:${id}`;
}

function id(v: unknown): string {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new UserError("Not found", 404);
  return s;
}

const ZIP_CAP = 4000 * 1024 * 1024;

const mb = (name: string, fallback = 0) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n * 1024 * 1024 : fallback;
};

export const limits = () => ({
  /** Storage per person, across all their files and versions. 0 = no limit. */
  quota: mb("DRIVE_QUOTA_MB"),
  /** Largest single upload. 0 = no limit. */
  maxFile: mb("DRIVE_MAX_FILE_MB"),
  versions: Math.max(1, Number(process.env.DRIVE_VERSIONS) || 100),
  trashDays: Math.max(1, Number(process.env.DRIVE_TRASH_DAYS) || 93),
  /** Zip downloads of folders stop here; plain zip files cannot go past 4 GB. */
  zipMax: Math.min(mb("DRIVE_ZIP_MAX_MB", ZIP_CAP), ZIP_CAP),
});

/* ------------------------------------------------------------------ access */

export async function libraryRole(email: string, libraryId: string): Promise<Role | null> {
  const [m] = await q<{ role: Role }>("SELECT role FROM library_members WHERE library_id = $1 AND email = $2", [libraryId, email]);
  return m?.role ?? null;
}

/** Root first, the item itself last. */
async function ancestors(itemId: string, tq: Tq = q): Promise<Row[]> {
  return tq<Row>(
    `WITH RECURSIVE up AS (
       SELECT i.*, 0 AS depth FROM items i WHERE i.id = $1
       UNION ALL
       SELECT p.*, up.depth + 1 FROM items p JOIN up ON p.id = up.parent_id
     )
     SELECT * FROM up ORDER BY depth DESC`,
    [itemId],
  );
}

/** What `email` may do with `row`: the library role, ownership, or the best share on it or a folder above it. */
async function roleOn(email: string, row: Row): Promise<Role | null> {
  const base = row.library_id ? await libraryRole(email, row.library_id) : row.owner === email ? "owner" : null;
  if (base === "owner") return base;
  const [r] = await q<{ roles: Role[] | null }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM items WHERE id = $1
       UNION ALL
       SELECT p.id, p.parent_id FROM items p JOIN up ON p.id = up.parent_id
     )
     SELECT array_agg(s.role) AS roles FROM shares s JOIN up ON s.item_id = up.id WHERE s.email = $2`,
    [row.id, email],
  );
  return maxRole(base, ...(r?.roles ?? []));
}

async function getRow(itemId: string, tq: Tq = q): Promise<Row | null> {
  const [row] = await tq<Row>("SELECT * FROM items WHERE id = $1", [id(itemId)]);
  return row ?? null;
}

/**
 * The item, if `me` has at least `need` on it. Something they can't see is "Not found", so
 * nobody learns what exists, and anything in the recycle bin is out of reach until restored.
 */
export async function access(me: Me, itemId: string, need: Role): Promise<{ row: Row; role: Role }> {
  const row = await getRow(itemId);
  if (!row || row.trash_root) throw new UserError("Not found", 404);
  const role = await roleOn(me.email, row);
  if (!role) throw new UserError("Not found", 404);
  if (!atLeast(role, need)) throw new UserError(need === "owner" ? "Only the owner can do that" : "You can only view this", 403);
  return { row, role };
}

type Place = { space: string; libraryId: string | null; owner: string; parentId: string | null; role: Role };

/** Resolves where new items go and checks `me` may add there. */
async function place(me: Me, target: Target, need: Role = "editor"): Promise<Place> {
  if (target.parent) {
    const { row, role } = await access(me, target.parent, need);
    if (row.kind !== "folder") throw new UserError("That is not a folder");
    return { space: row.space, libraryId: row.library_id, owner: row.owner, parentId: row.id, role };
  }
  if (target.library) {
    const lib = id(target.library);
    const role = await libraryRole(me.email, lib);
    if (!role) throw new UserError("Not found", 404);
    if (!atLeast(role, need)) throw new UserError("You can only view this library", 403);
    return { space: librarySpace(lib), libraryId: lib, owner: "", parentId: null, role };
  }
  return { space: personalSpace(me.email), libraryId: null, owner: me.email, parentId: null, role: "owner" };
}

/* ----------------------------------------------------------------- listing */

const COLS = `i.id, i.name, i.kind, i.mime, i.size, i.version, i.owner, i.library_id, i.parent_id, i.modified_at,
  i.modified_by, i.created_at, i.trashed_at, i.trashed_by,
  EXISTS (SELECT 1 FROM stars st WHERE st.item_id = i.id AND st.email = $1) AS starred,
  (EXISTS (SELECT 1 FROM shares sh WHERE sh.item_id = i.id) OR EXISTS (SELECT 1 FROM links ln WHERE ln.item_id = i.id)) AS shared`;

type ListRow = Pick<Row, "id" | "name" | "kind" | "mime" | "size" | "version" | "owner" | "library_id" | "parent_id" | "modified_at" | "modified_by" | "created_at" | "trashed_at" | "trashed_by"> & {
  starred: boolean;
  shared: boolean;
  location?: string;
};

function toItem(r: ListRow): Item {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    mime: r.mime,
    size: Number(r.size),
    version: r.version,
    owner: r.owner,
    libraryId: r.library_id,
    parentId: r.parent_id,
    modifiedAt: r.modified_at.toISOString(),
    modifiedBy: r.modified_by,
    createdAt: r.created_at.toISOString(),
    trashedAt: r.trashed_at?.toISOString() ?? null,
    trashedBy: r.trashed_by,
    starred: r.starred,
    shared: r.shared,
    ...(r.location !== undefined ? { location: r.location } : {}),
  };
}

const ORDER = "ORDER BY (i.kind = 'folder') DESC, lower(i.name)";

export type Crumb = { label: string; parent?: string; library?: string; view?: string };

/** `inShared`: this folder, or one above it, is shared with people or by link, so what's in it is too. */
export type Listing = { items: Item[]; crumbs: Crumb[]; role: Role; folder: Item | null; inShared: boolean };

export async function listFolder(me: Me, target: Target): Promise<Listing> {
  const at = await place(me, target, "viewer");
  const items = (
    await q<ListRow>(
      `SELECT ${COLS} FROM items i WHERE i.space = $2 AND i.parent_id IS NOT DISTINCT FROM $3 AND i.trash_root IS NULL ${ORDER}`,
      [me.email, at.space, at.parentId],
    )
  ).map(toItem);
  let folder: Item | null = null;
  let inShared = false;
  if (at.parentId) {
    const [f] = await q<ListRow>(`SELECT ${COLS} FROM items i WHERE i.id = $2`, [me.email, at.parentId]);
    folder = toItem(f);
    const ids = (await ancestors(at.parentId)).map((r) => r.id);
    const [hit] = await q(
      "SELECT 1 FROM shares WHERE item_id = ANY($1) UNION ALL SELECT 1 FROM links WHERE item_id = ANY($1) LIMIT 1",
      [ids],
    );
    inShared = !!hit;
  }
  return { items, crumbs: await crumbs(me, at), role: at.role, folder, inShared };
}

async function crumbs(me: Me, at: Place): Promise<Crumb[]> {
  const chain = at.parentId ? await ancestors(at.parentId) : [];
  const folders = (rows: Row[]) => rows.map((r) => ({ label: r.name, parent: r.id }));
  if (at.libraryId && (await libraryRole(me.email, at.libraryId))) {
    const [lib] = await q<{ name: string }>("SELECT name FROM libraries WHERE id = $1", [at.libraryId]);
    return [{ label: lib?.name ?? "Library", library: at.libraryId }, ...folders(chain)];
  }
  if (at.space === personalSpace(me.email)) return [{ label: "My files", view: "files" }, ...folders(chain)];
  // Someone else's files: start at the highest folder that was shared with me.
  const shared = new Set(
    (await q<{ item_id: string }>("SELECT item_id FROM shares WHERE email = $1 AND item_id = ANY($2)", [me.email, chain.map((r) => r.id)])).map((r) => r.item_id),
  );
  const from = Math.max(0, chain.findIndex((r) => shared.has(r.id)));
  return [{ label: "Shared with me", view: "shared" }, ...folders(chain.slice(from))];
}

/** Everything `me` can open: their files, their libraries, and whatever is inside things shared with them. */
export const VISIBLE = `
  WITH RECURSIVE shared_tree AS (
    SELECT s.item_id AS id FROM shares s WHERE s.email = $1
    UNION
    SELECT c.id FROM items c JOIN shared_tree t ON c.parent_id = t.id
  )`;
export const VISIBLE_WHERE = `i.trash_root IS NULL AND (
    i.space = 'u:' || $1
    OR i.library_id IN (SELECT library_id FROM library_members WHERE email = $1)
    OR i.id IN (SELECT id FROM shared_tree))`;
export const LOCATION = `CASE WHEN i.library_id IS NOT NULL THEN (SELECT name FROM libraries WHERE id = i.library_id)
  WHEN i.owner = $1 THEN 'My files' ELSE i.owner END AS location`;

export async function recent(me: Me): Promise<Item[]> {
  return (
    await q<ListRow>(
      `${VISIBLE} SELECT ${COLS}, ${LOCATION} FROM items i WHERE ${VISIBLE_WHERE} AND i.kind = 'file' ORDER BY i.modified_at DESC LIMIT 60`,
      [me.email],
    )
  ).map(toItem);
}

export async function starred(me: Me): Promise<Item[]> {
  return (
    await q<ListRow>(
      `${VISIBLE} SELECT ${COLS}, ${LOCATION} FROM items i JOIN stars s ON s.item_id = i.id AND s.email = $1
       WHERE ${VISIBLE_WHERE} ${ORDER}`,
      [me.email],
    )
  ).map(toItem);
}

/** Items shared directly with me (what's inside them is reached by opening them). */
export async function sharedWithMe(me: Me): Promise<Item[]> {
  return (
    await q<ListRow>(
      `SELECT ${COLS}, i.owner AS location FROM items i JOIN shares s ON s.item_id = i.id AND s.email = $1
       WHERE i.trash_root IS NULL ORDER BY s.shared_at DESC`,
      [me.email],
    )
  ).map(toItem);
}

/** Things I shared with people or by link. */
export async function sharedByMe(me: Me): Promise<Item[]> {
  return (
    await q<ListRow>(
      `SELECT ${COLS}, ${LOCATION} FROM items i
       WHERE i.trash_root IS NULL AND i.space = 'u:' || $1
         AND (EXISTS (SELECT 1 FROM shares sh WHERE sh.item_id = i.id) OR EXISTS (SELECT 1 FROM links ln WHERE ln.item_id = i.id))
       ${ORDER}`,
      [me.email],
    )
  ).map(toItem);
}

/** Names first, then words inside text files. */
export async function search(me: Me, text: string): Promise<Item[]> {
  const term = text.trim().slice(0, 200);
  if (!term) return [];
  return (
    await q<ListRow>(
      `${VISIBLE} SELECT ${COLS}, ${LOCATION} FROM items i
       WHERE ${VISIBLE_WHERE}
         AND (i.name ILIKE '%' || $2 || '%'
              OR to_tsvector('simple', i.name || ' ' || COALESCE(i.text, '')) @@ plainto_tsquery('simple', $3))
       ORDER BY (i.name ILIKE '%' || $2 || '%') DESC, i.modified_at DESC LIMIT 100`,
      [me.email, term.replace(/[\\%_]/g, (c) => `\\${c}`), term],
    )
  ).map(toItem);
}

/** Folders in one place, for the move and copy picker. */
export async function folders(me: Me, target: Target): Promise<{ items: Item[]; crumbs: Crumb[]; role: Role }> {
  const list = await listFolder(me, target);
  return { items: list.items.filter((i) => i.kind === "folder"), crumbs: list.crumbs, role: list.role };
}

export async function details(me: Me, itemId: string): Promise<Item & { role: Role; summary: string | null; hasText: boolean }> {
  const { row, role } = await access(me, itemId, "viewer");
  const [r] = await q<ListRow>(`SELECT ${COLS}, ${LOCATION} FROM items i WHERE i.id = $2`, [me.email, row.id]);
  return {
    ...toItem(r),
    role,
    summary: row.summary && row.summary_sha === row.sha256 ? row.summary : null,
    hasText: !!row.text,
  };
}

/* -------------------------------------------------------------- recycle bin */

/** Items deleted from my files, and from libraries I can edit. Old ones are purged on the way. */
export async function trash(me: Me): Promise<Item[]> {
  await purgeExpired();
  return (
    await q<ListRow>(
      `SELECT ${COLS}, ${LOCATION} FROM items i
       WHERE i.trash_root = i.id AND i.held_deleted_at IS NULL
         AND (i.space = 'u:' || $1
              OR i.library_id IN (SELECT library_id FROM library_members WHERE email = $1 AND role IN ('editor', 'owner')))
       ORDER BY i.trashed_at DESC`,
      [me.email],
    )
  ).map(toItem);
}

/** Whose an item is for legal holds: its owner, or whoever added it to a library. */
const WHO = "COALESCE(NULLIF(owner, ''), created_by)";

const sweep = globalThis as unknown as { __driveSweptAt?: number };

/**
 * Empties what has sat in the recycle bin past DRIVE_TRASH_DAYS. Runs on the way into the bin
 * and hourly (instrumentation.ts), and at most hourly also applies the Admin center's retention.
 */
export async function purgeExpired(): Promise<void> {
  const old = await q<{ id: string }>(
    `SELECT id FROM items WHERE trash_root = id AND held_deleted_at IS NULL AND trashed_at < now() - make_interval(days => $1) LIMIT 200`,
    [limits().trashDays],
  );
  if (old.length) await destroy(old.map((r) => r.id));
  if (Date.now() - (sweep.__driveSweptAt ?? 0) >= 3_600_000) {
    sweep.__driveSweptAt = Date.now();
    await retentionSweep();
  }
}

/** People among `emails` on legal hold. */
async function heldAmong(emails: string[]): Promise<string[]> {
  const held = holdChecker();
  const out: string[] = [];
  for (const e of emails) if (await held(e)) out.push(e);
  return out;
}

/**
 * Deletes files not changed for longer than the Admin center's retention for "file", unless
 * their owner is on hold, and lets go of what a hold kept once it is lifted.
 */
export async function retentionSweep(): Promise<void> {
  const days = await policy().retentionDays("file");
  if (days !== null) {
    const old = `kind = 'file' AND held_deleted_at IS NULL AND modified_at < now() - make_interval(days => $1)`;
    const who = await q<{ who: string }>(`SELECT DISTINCT ${WHO} AS who FROM items WHERE ${old}`, [days]);
    const held = await heldAmong(who.map((r) => r.who));
    const gone = await q<{ id: string }>(`SELECT id FROM items WHERE ${old} AND ${WHO} <> ALL($2) LIMIT 500`, [days, held]);
    if (gone.length) await destroy(gone.map((r) => r.id));
  }
  const kept = await q<{ who: string }>(
    `SELECT ${WHO} AS who FROM items WHERE held_deleted_at IS NOT NULL
     UNION SELECT ${WHO} FROM items WHERE id IN (SELECT item_id FROM versions WHERE held_deleted_at IS NOT NULL)`,
  );
  if (!kept.length) return;
  const held = await heldAmong(kept.map((r) => r.who));
  const free = await q<{ id: string }>(
    `SELECT id FROM items WHERE trash_root = id AND held_deleted_at IS NOT NULL AND ${WHO} <> ALL($1) LIMIT 500`,
    [held],
  );
  if (free.length) await destroy(free.map((r) => r.id));
  const versions = await q<{ sha256: string }>(
    `DELETE FROM versions v USING items i WHERE v.item_id = i.id AND v.held_deleted_at IS NOT NULL
       AND COALESCE(NULLIF(i.owner, ''), i.created_by) <> ALL($1) RETURNING v.sha256`,
    [held],
  );
  await blobs.collect(versions.map((v) => v.sha256), shaInUse);
  // A library deleted under a hold kept its files and lost its members; drop it once they are gone.
  await q(
    `DELETE FROM libraries l WHERE NOT EXISTS (SELECT 1 FROM library_members m WHERE m.library_id = l.id)
       AND NOT EXISTS (SELECT 1 FROM items i WHERE i.library_id = l.id)`,
  );
}

/**
 * Deletes items and everything inside them for good, then their unused file contents. What
 * belongs to someone on legal hold is kept instead, with the folders above it, marked
 * held_deleted_at: out of everyone's sight in Drive (recycle bin included), still found by
 * eDiscovery.
 */
async function destroy(ids: string[]): Promise<void> {
  const tree = await q<{ id: string; parent_id: string | null; who: string }>(
    `WITH RECURSIVE down AS (
       SELECT id, parent_id, ${WHO} AS who FROM items WHERE id = ANY($1)
       UNION
       SELECT c.id, c.parent_id, COALESCE(NULLIF(c.owner, ''), c.created_by) FROM items c JOIN down d ON c.parent_id = d.id
     )
     SELECT * FROM down`,
    [ids],
  );
  const held = holdChecker();
  const byId = new Map(tree.map((r) => [r.id, r]));
  const keep = new Set<string>();
  for (const r of tree) {
    if (!(await held(r.who))) continue;
    for (let at: (typeof tree)[number] | undefined = r; at && !keep.has(at.id); at = at.parent_id ? byId.get(at.parent_id) : undefined) keep.add(at.id);
  }
  if (keep.size) {
    await q(
      `UPDATE items SET held_deleted_at = COALESCE(held_deleted_at, now()), trashed_at = COALESCE(trashed_at, now()),
         trash_root = COALESCE(trash_root, id) WHERE id = ANY($1)`,
      [[...keep]],
    );
  }
  const gone = tree.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (!gone.length) return;
  const shas = await q<{ sha256: string }>("SELECT DISTINCT sha256 FROM versions WHERE item_id = ANY($1)", [gone]);
  await q("DELETE FROM items WHERE id = ANY($1)", [gone]);
  await blobs.collect(shas.map((s) => s.sha256), shaInUse);
}

async function shaInUse(sha: string): Promise<boolean> {
  return (await q("SELECT 1 FROM versions WHERE sha256 = $1 LIMIT 1", [sha])).length > 0;
}

export async function moveToTrash(me: Me, ids: string[]): Promise<void> {
  for (const itemId of ids) {
    const { row } = await access(me, itemId, "editor");
    await q(
      `WITH RECURSIVE down AS (
         SELECT id FROM items WHERE id = $1
         UNION ALL
         SELECT c.id FROM items c JOIN down d ON c.parent_id = d.id WHERE c.trash_root IS NULL
       )
       UPDATE items SET trashed_at = now(), trashed_by = $2, trash_root = $1 WHERE id IN (SELECT id FROM down)`,
      [row.id, me.email],
    );
    await log(row.id, me, "deleted");
  }
}

/**
 * Deleted items sit in their owner's recycle bin (or their library's). Only the owner, or a
 * library member who can edit, restores them or deletes them for good: someone a folder was
 * shared with can delete from it, but can't make that permanent.
 */
async function trashAccess(me: Me, itemId: string): Promise<Row> {
  const row = await getRow(itemId);
  const allowed =
    row && row.trash_root === row.id && !row.held_deleted_at && (row.library_id ? atLeast(await libraryRole(me.email, row.library_id), "editor") : row.owner === me.email);
  if (!row || !allowed) throw new UserError("Not found", 404);
  return row;
}

export async function restore(me: Me, ids: string[]): Promise<void> {
  for (const itemId of ids) {
    const row = await trashAccess(me, itemId);
    await tx(async (tq) => {
      // Back where it was, or to the top if that folder is gone or deleted too.
      let parent = row.parent_id;
      if (parent) {
        const [p] = await tq<{ trash_root: string | null }>("SELECT trash_root FROM items WHERE id = $1", [parent]);
        if (!p || p.trash_root) parent = null;
      }
      const name = uniqueName(row.name, await siblingNames(tq, row.space, parent), row.kind === "folder");
      // Rename while it is still in the bin, where names don't clash.
      await tq("UPDATE items SET parent_id = $2, name = $3 WHERE id = $1", [row.id, parent, name]);
      await tq("UPDATE items SET trashed_at = NULL, trashed_by = NULL, trash_root = NULL WHERE trash_root = $1", [row.id]);
    });
    await log(row.id, me, "restored");
  }
}

export async function deleteForever(me: Me, ids: string[]): Promise<void> {
  const rows = [];
  for (const itemId of ids) rows.push(await trashAccess(me, itemId));
  await destroy(rows.map((r) => r.id));
}

export async function emptyTrash(me: Me): Promise<void> {
  const ids = (await trash(me)).map((i) => i.id);
  if (ids.length) await destroy(ids);
}

/* ---------------------------------------------------------------- changes */

async function siblingNames(tq: Tq, space: string, parent: string | null, except?: string): Promise<string[]> {
  return (
    await tq<{ name: string }>(
      "SELECT name FROM items WHERE space = $1 AND parent_id IS NOT DISTINCT FROM $2 AND trash_root IS NULL AND id IS DISTINCT FROM $3",
      [space, parent, except ?? null],
    )
  ).map((r) => r.name);
}

async function log(itemId: string, me: Me, action: string, detail = "", tq: Tq = q): Promise<void> {
  await tq("INSERT INTO activity (item_id, actor, action, detail) VALUES ($1, $2, $3, $4)", [itemId, me.email, action, detail]);
}

export async function createFolder(me: Me, target: Target, rawName: string): Promise<Item> {
  const at = await place(me, target);
  const name = cleanName(rawName);
  const [row] = await q<{ id: string }>(
    `INSERT INTO items (space, library_id, owner, parent_id, kind, name, created_by, modified_by)
     VALUES ($1, $2, $3, $4, 'folder', $5, $6, $6) RETURNING id`,
    [at.space, at.libraryId, at.owner, at.parentId, name, me.email],
  );
  await log(row.id, me, "created");
  return (await listOne(me, row.id))!;
}

async function listOne(me: Me, itemId: string): Promise<Item | null> {
  const [r] = await q<ListRow>(`SELECT ${COLS} FROM items i WHERE i.id = $2`, [me.email, itemId]);
  return r ? toItem(r) : null;
}

/** Finds or creates the folder at `parts` under `at`, for folder uploads. */
async function ensureFolders(me: Me, at: Place, parts: string[]): Promise<Place> {
  let parentId = at.parentId;
  for (const name of parts) {
    const [made] = await q<{ id: string }>(
      `INSERT INTO items (space, library_id, owner, parent_id, kind, name, created_by, modified_by)
       VALUES ($1, $2, $3, $4, 'folder', $5, $6, $6)
       ON CONFLICT (space, COALESCE(parent_id, '${NIL}'::uuid), lower(name)) WHERE trash_root IS NULL DO NOTHING
       RETURNING id`,
      [at.space, at.libraryId, at.owner, parentId, name, me.email],
    );
    if (made) {
      await log(made.id, me, "created");
      parentId = made.id;
      continue;
    }
    const [found] = await q<{ id: string; kind: string }>(
      "SELECT id, kind FROM items WHERE space = $1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name) = lower($3) AND trash_root IS NULL",
      [at.space, parentId, name],
    );
    if (!found) throw new UserError("That folder was just changed; try again", 409);
    if (found.kind !== "folder") throw new UserError(`"${name}" is a file, not a folder`, 409);
    parentId = found.id;
  }
  return { ...at, parentId };
}

/** Bytes used by everything someone owns, every version counted. */
export async function usage(email: string): Promise<number> {
  const [r] = await q<{ used: string | null }>(
    "SELECT SUM(v.size) AS used FROM versions v JOIN items i ON i.id = v.item_id WHERE i.space = $1 AND i.held_deleted_at IS NULL AND v.held_deleted_at IS NULL",
    [personalSpace(email)],
  );
  return Number(r?.used ?? 0);
}

async function roomFor(at: Pick<Place, "libraryId" | "owner">): Promise<number> {
  const { quota, maxFile } = limits();
  let room = maxFile || Number.MAX_SAFE_INTEGER;
  if (quota && !at.libraryId && at.owner) room = Math.min(room, Math.max(0, quota - (await usage(at.owner))));
  return room;
}

/**
 * Stores an upload at `path` (a name, or "folder/sub/name" for folder uploads) under `target`.
 * A file that is already there gets a new version, like saving over it.
 */
export async function upload(me: Me, target: Target, path: string, body: ReadableStream<Uint8Array> | null, declaredSize?: number): Promise<Item> {
  const parts = splitPath(path);
  const name = parts.pop()!;
  let at = await place(me, target);
  const room = await roomFor(at);
  if (declaredSize !== undefined && declaredSize > room) throw new UserError("This file is bigger than your remaining storage", 413);
  if (parts.length) at = await ensureFolders(me, at, parts);
  const stored = await blobs.put(body, room);
  const mime = mimeFor(name);
  const text = isTextMime(mime) ? stored.head.toString("utf8").replace(/\u0000/g, "").slice(0, 200_000) : null;

  const out = await tx(async (tq) => {
    const [made] = await tq<{ id: string }>(
      `INSERT INTO items (space, library_id, owner, parent_id, kind, name, mime, size, sha256, version, text, created_by, modified_by)
       VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8, 1, $9, $10, $10)
       ON CONFLICT (space, COALESCE(parent_id, '${NIL}'::uuid), lower(name)) WHERE trash_root IS NULL DO NOTHING
       RETURNING id`,
      [at.space, at.libraryId, at.owner, at.parentId, name, mime, stored.size, stored.sha256, text, me.email],
    );
    if (made) {
      await tq("INSERT INTO versions (item_id, n, size, sha256, created_by) VALUES ($1, 1, $2, $3, $4)", [made.id, stored.size, stored.sha256, me.email]);
      await log(made.id, me, "uploaded", "", tq);
      return { id: made.id, pruned: [] as string[] };
    }
    const [cur] = await tq<Row>(
      "SELECT * FROM items WHERE space = $1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name) = lower($3) AND trash_root IS NULL FOR UPDATE",
      [at.space, at.parentId, name],
    );
    if (!cur) throw new UserError("That folder was just changed; try again", 409);
    if (cur.kind === "folder") throw new UserError(`A folder named "${cur.name}" is already here`, 409);
    if (cur.sha256 === stored.sha256) return { id: cur.id, pruned: [] }; // same bytes: nothing new to keep
    const n = cur.version + 1;
    await tq("INSERT INTO versions (item_id, n, size, sha256, created_by) VALUES ($1, $2, $3, $4, $5)", [cur.id, n, stored.size, stored.sha256, me.email]);
    await tq(
      "UPDATE items SET size = $2, sha256 = $3, version = $4, mime = $5, text = $6, modified_by = $7, modified_at = now() WHERE id = $1",
      [cur.id, stored.size, stored.sha256, n, mime, text, me.email],
    );
    await log(cur.id, me, "uploaded", `version ${n}`, tq);
    return { id: cur.id, pruned: await pruneVersions(tq, cur) };
  });
  await blobs.collect([stored.sha256, ...out.pruned], shaInUse);
  return (await listOne(me, out.id))!;
}

/**
 * Keeps the newest DRIVE_VERSIONS versions; returns the contents of the ones dropped. While the
 * owner is on legal hold the older ones are only hidden.
 */
async function pruneVersions(tq: Tq, row: Pick<Row, "id" | "owner" | "created_by">): Promise<string[]> {
  const old = "item_id = $1 AND n <= (SELECT MAX(n) FROM versions WHERE item_id = $1) - $2";
  if (await policy().onHold(row.owner || row.created_by)) {
    await tq(`UPDATE versions SET held_deleted_at = now() WHERE ${old} AND held_deleted_at IS NULL`, [row.id, limits().versions]);
    return [];
  }
  const gone = await tq<{ sha256: string }>(`DELETE FROM versions WHERE ${old} RETURNING sha256`, [row.id, limits().versions]);
  return gone.map((g) => g.sha256);
}

export async function rename(me: Me, itemId: string, rawName: string): Promise<Item> {
  const { row } = await access(me, itemId, "editor");
  const name = cleanName(rawName);
  if (name === row.name) return (await listOne(me, row.id))!;
  const taken = await siblingNames(q, row.space, row.parent_id, row.id);
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) throw new UserError("Something with that name is already here", 409);
  const mime = row.kind === "file" ? mimeFor(name) : "";
  await q("UPDATE items SET name = $2, mime = $3, modified_by = $4, modified_at = now() WHERE id = $1", [row.id, name, mime, me.email]);
  await log(row.id, me, "renamed", `from ${row.name}`);
  return (await listOne(me, row.id))!;
}

async function subtreeIds(tq: Tq, rootId: string): Promise<string[]> {
  return (
    await tq<{ id: string }>(
      `WITH RECURSIVE down AS (
         SELECT id FROM items WHERE id = $1
         UNION ALL
         SELECT c.id FROM items c JOIN down d ON c.parent_id = d.id
       ) SELECT id FROM down`,
      [rootId],
    )
  ).map((r) => r.id);
}

export async function move(me: Me, ids: string[], target: Target): Promise<void> {
  const at = await place(me, target);
  for (const itemId of ids) {
    const { row } = await access(me, itemId, "editor");
    if (row.parent_id === at.parentId && row.space === at.space) continue;
    // Taking something out of someone's files (or a library) changes who owns it, so only they can.
    if (row.space !== at.space) {
      const mayTake = row.library_id ? atLeast(await libraryRole(me.email, row.library_id), "editor") : row.owner === me.email;
      if (!mayTake) throw new UserError("Only the owner can move this somewhere else; copy it instead", 403);
    }
    await tx(async (tq) => {
      const subtree = await subtreeIds(tq, row.id);
      if (at.parentId && subtree.includes(at.parentId)) throw new UserError("A folder can't go inside itself");
      if (at.space !== row.space && at.owner && !at.libraryId) {
        const [s] = await tq<{ used: string | null }>(
          "SELECT SUM(v.size) AS used FROM versions v WHERE v.item_id = ANY($1)",
          [subtree],
        );
        if (Number(s?.used ?? 0) > (await roomFor(at))) throw new UserError("There isn't enough storage there", 413);
      }
      const name = uniqueName(row.name, await siblingNames(tq, at.space, at.parentId), row.kind === "folder");
      if (at.space !== row.space) {
        // What a legal hold kept stays with the person it was kept for.
        await tq("UPDATE items SET space = $2, library_id = $3, owner = $4 WHERE id = ANY($1) AND held_deleted_at IS NULL", [
          subtree,
          at.space,
          at.libraryId,
          at.owner,
        ]);
      }
      await tq("UPDATE items SET parent_id = $2, name = $3, modified_by = $4, modified_at = now() WHERE id = $1", [row.id, at.parentId, name, me.email]);
    });
    await log(row.id, me, "moved");
  }
}

export async function copy(me: Me, ids: string[], target: Target): Promise<void> {
  const at = await place(me, target);
  for (const itemId of ids) {
    const { row } = await access(me, itemId, "viewer");
    await tx(async (tq) => {
      const subtree = await subtreeIds(tq, row.id);
      if (at.parentId && subtree.includes(at.parentId)) throw new UserError("A folder can't be copied inside itself");
      const rows = await tq<Row>("SELECT * FROM items WHERE id = ANY($1) AND trash_root IS NULL", [subtree]);
      const bytes = rows.reduce((n, r) => n + Number(r.size), 0);
      if (bytes > (await roomFor(at))) throw new UserError("There isn't enough storage there", 413);
      const fresh = new Map<string, string>();
      // Parents before children: walk from the copied item down.
      const byParent = new Map<string | null, Row[]>();
      for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
      const queue: Row[] = [rows.find((r) => r.id === row.id)!];
      while (queue.length) {
        const r = queue.shift()!;
        const parent = r.id === row.id ? at.parentId : fresh.get(r.parent_id!)!;
        const name = r.id === row.id ? uniqueName(r.name, await siblingNames(tq, at.space, at.parentId), r.kind === "folder") : r.name;
        const [made] = await tq<{ id: string }>(
          `INSERT INTO items (space, library_id, owner, parent_id, kind, name, mime, size, sha256, version, text, created_by, modified_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
          [at.space, at.libraryId, at.owner, parent, r.kind, name, r.mime, r.size, r.sha256, r.kind === "file" ? 1 : 0, r.text, me.email],
        );
        fresh.set(r.id, made.id);
        if (r.kind === "file") {
          await tq("INSERT INTO versions (item_id, n, size, sha256, created_by) VALUES ($1, 1, $2, $3, $4)", [made.id, r.size, r.sha256, me.email]);
        }
        queue.push(...(byParent.get(r.id) ?? []));
      }
      await log(fresh.get(row.id)!, me, "created", `copy of ${row.name}`, tq);
    });
  }
}

export async function setStar(me: Me, itemId: string, on: boolean): Promise<void> {
  const { row } = await access(me, itemId, "viewer");
  if (on) await q("INSERT INTO stars (email, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me.email, row.id]);
  else await q("DELETE FROM stars WHERE email = $1 AND item_id = $2", [me.email, row.id]);
}

/* ---------------------------------------------------------------- versions */

export type Version = { n: number; size: number; createdBy: string; createdAt: string; current: boolean };

export async function versions(me: Me, itemId: string): Promise<Version[]> {
  const { row } = await access(me, itemId, "viewer");
  const list = await q<{ n: number; size: string; created_by: string; created_at: Date }>(
    "SELECT n, size, created_by, created_at FROM versions WHERE item_id = $1 AND held_deleted_at IS NULL ORDER BY n DESC",
    [row.id],
  );
  return list.map((v) => ({ n: v.n, size: Number(v.size), createdBy: v.created_by, createdAt: v.created_at.toISOString(), current: v.n === row.version }));
}

/** Makes an old version current again by saving it as the newest one, so nothing is lost. */
export async function restoreVersion(me: Me, itemId: string, n: number): Promise<void> {
  const { row } = await access(me, itemId, "editor");
  const pruned = await tx(async (tq) => {
    const [v] = await tq<{ size: string; sha256: string }>(
      "SELECT size, sha256 FROM versions WHERE item_id = $1 AND n = $2 AND held_deleted_at IS NULL",
      [row.id, n],
    );
    if (!v) throw new UserError("That version is gone", 404);
    const [cur] = await tq<{ version: number }>("SELECT version FROM items WHERE id = $1 FOR UPDATE", [row.id]);
    const next = cur.version + 1;
    await tq("INSERT INTO versions (item_id, n, size, sha256, created_by) VALUES ($1, $2, $3, $4, $5)", [row.id, next, v.size, v.sha256, me.email]);
    await tq(
      "UPDATE items SET size = $2, sha256 = $3, version = $4, text = $5, modified_by = $6, modified_at = now() WHERE id = $1",
      [row.id, v.size, v.sha256, next, isTextMime(row.mime) ? await textOf(v.sha256) : null, me.email],
    );
    await log(row.id, me, "restored version", `version ${n}`, tq);
    return pruneVersions(tq, row);
  });
  await blobs.collect(pruned, shaInUse);
}

async function textOf(sha: string): Promise<string> {
  const chunks: Buffer[] = [];
  let len = 0;
  for await (const c of blobs.read(sha, { start: 0, end: 1024 * 1024 - 1 })) {
    chunks.push(c as Buffer);
    len += (c as Buffer).length;
  }
  return Buffer.concat(chunks, len).toString("utf8").replace(/\u0000/g, "").slice(0, 200_000);
}

/** The bytes of a file (or of one of its versions) that `me` may view. */
export async function content(me: Me, itemId: string, n?: number): Promise<{ row: Row; sha: string; size: number }> {
  const { row } = await access(me, itemId, "viewer");
  return pick(row, n);
}

async function pick(row: Row, n?: number): Promise<{ row: Row; sha: string; size: number }> {
  if (row.kind !== "file" || !row.sha256) throw new UserError("That is a folder", 400);
  if (n === undefined || n === row.version) return { row, sha: row.sha256, size: Number(row.size) };
  const [v] = await q<{ sha256: string; size: string }>(
    "SELECT sha256, size FROM versions WHERE item_id = $1 AND n = $2 AND held_deleted_at IS NULL",
    [row.id, n],
  );
  if (!v) throw new UserError("That version is gone", 404);
  return { row, sha: v.sha256, size: Number(v.size) };
}

/** Every live file under a folder with its path inside it, for zip downloads. */
export async function tree(rootId: string): Promise<{ path: string; sha: string | null; kind: string; size: number; modified: Date }[]> {
  const rows = await q<{ id: string; parent_id: string | null; name: string; kind: string; sha256: string | null; size: string; modified_at: Date }>(
    `WITH RECURSIVE down AS (
       SELECT id, parent_id, name, kind, sha256, size, modified_at FROM items WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id, c.name, c.kind, c.sha256, c.size, c.modified_at FROM items c JOIN down d ON c.parent_id = d.id
       WHERE c.trash_root IS NULL
     ) SELECT * FROM down`,
    [rootId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (r: (typeof rows)[number]): string => (r.id === rootId ? r.name : `${pathOf(byId.get(r.parent_id!)!)}/${r.name}`);
  return rows.map((r) => ({ path: pathOf(r), sha: r.sha256, kind: r.kind, size: Number(r.size), modified: r.modified_at }));
}

export async function folderForZip(me: Me, itemId: string): Promise<Row> {
  const { row } = await access(me, itemId, "viewer");
  if (row.kind !== "folder") throw new UserError("That is not a folder");
  return row;
}

/* ----------------------------------------------------------------- sharing */

export type Sharing = {
  owner: string;
  people: { email: string; role: Role; sharedBy: string; inherited: boolean; from?: string }[];
  links: { token: string; createdBy: string; createdAt: string; expiresAt: string | null }[];
  canShare: boolean;
  library: string | null;
};

export async function sharing(me: Me, itemId: string): Promise<Sharing> {
  const { row, role } = await access(me, itemId, "viewer");
  const chain = await ancestors(row.id);
  const people = await q<{ item_id: string; email: string; role: Role; shared_by: string }>(
    "SELECT item_id, email, role, shared_by FROM shares WHERE item_id = ANY($1) ORDER BY shared_at",
    [chain.map((r) => r.id)],
  );
  const names = new Map(chain.map((r) => [r.id, r.name]));
  const links = atLeast(role, "editor")
    ? await q<{ token: string; created_by: string; created_at: Date; expires_at: Date | null }>(
        "SELECT token, created_by, created_at, expires_at FROM links WHERE item_id = $1 ORDER BY created_at",
        [row.id],
      )
    : [];
  let library: string | null = null;
  if (row.library_id) [{ name: library }] = await q<{ name: string }>("SELECT name FROM libraries WHERE id = $1", [row.library_id]);
  return {
    owner: row.owner,
    people: people.map((p) => ({
      email: p.email,
      role: p.role,
      sharedBy: p.shared_by,
      inherited: p.item_id !== row.id,
      ...(p.item_id !== row.id ? { from: names.get(p.item_id) } : {}),
    })),
    links: links.map((l) => ({ token: l.token, createdBy: l.created_by, createdAt: l.created_at.toISOString(), expiresAt: l.expires_at?.toISOString() ?? null })),
    canShare: atLeast(role, "editor"),
    library,
  };
}

export async function share(me: Me, itemId: string, rawEmail: unknown, rawRole: unknown): Promise<void> {
  const { row } = await access(me, itemId, "editor");
  const email = cleanEmail(rawEmail);
  const role = rawRole === "editor" ? "editor" : "viewer";
  if (email === row.owner) throw new UserError("They already own it");
  await q(
    `INSERT INTO shares (item_id, email, role, shared_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [row.id, email, role, me.email],
  );
  await log(row.id, me, "shared", `with ${email} (${role === "editor" ? "can edit" : "can view"})`);
}

export async function unshare(me: Me, itemId: string, rawEmail: unknown): Promise<void> {
  const email = String(rawEmail ?? "").toLowerCase();
  // Anyone may take themselves off something shared with them.
  const { row } = await access(me, itemId, email === me.email ? "viewer" : "editor");
  await q("DELETE FROM shares WHERE item_id = $1 AND email = $2", [row.id, email]);
  await log(row.id, me, "stopped sharing", `with ${email}`);
}

export async function createLink(me: Me, itemId: string, expiresDays?: number): Promise<string> {
  const { row } = await access(me, itemId, "editor");
  const token = randomBytes(18).toString("base64url");
  const days = Number(expiresDays);
  await q("INSERT INTO links (token, item_id, created_by, expires_at) VALUES ($1, $2, $3, $4)", [
    token,
    row.id,
    me.email,
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + Math.min(days, 3650) * 86_400_000) : null,
  ]);
  await log(row.id, me, "created a view link");
  return token;
}

export async function deleteLink(me: Me, itemId: string, token: string): Promise<void> {
  const { row } = await access(me, itemId, "editor");
  await q("DELETE FROM links WHERE item_id = $1 AND token = $2", [row.id, token]);
  await log(row.id, me, "removed a view link");
}

/** A link's item, if the link is live and the item isn't in the recycle bin. */
async function linkRoot(token: string): Promise<Row> {
  const [l] = await q<{ item_id: string }>("SELECT item_id FROM links WHERE token = $1 AND (expires_at IS NULL OR expires_at > now())", [String(token)]);
  const row = l ? await getRow(l.item_id) : null;
  if (!row || row.trash_root) throw new UserError("This link has expired or was removed", 404);
  return row;
}

/** An item under a link: the linked item itself or something inside the linked folder. */
async function underLink(token: string, itemId?: string | null): Promise<{ root: Row; row: Row; path: Row[] }> {
  const root = await linkRoot(token);
  if (!itemId || itemId === root.id) return { root, row: root, path: [root] };
  const chain = await ancestors(id(itemId));
  const at = chain.findIndex((r) => r.id === root.id);
  const row = chain[chain.length - 1];
  if (at < 0 || !row || row.trash_root) throw new UserError("Not found", 404);
  return { root, row, path: chain.slice(at) };
}

export type PublicItem = { id: string; name: string; kind: "file" | "folder"; mime: string; size: number; modifiedAt: string };

const pub = (r: Pick<Row, "id" | "name" | "kind" | "mime" | "size" | "modified_at">): PublicItem => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  mime: r.mime,
  size: Number(r.size),
  modifiedAt: r.modified_at.toISOString(),
});

export async function linkView(token: string, itemId?: string | null): Promise<{ item: PublicItem; path: PublicItem[]; children: PublicItem[]; owner: string }> {
  const { root, row, path } = await underLink(token, itemId);
  const children =
    row.kind === "folder"
      ? await q<Row>(`SELECT * FROM items i WHERE i.parent_id = $1 AND i.trash_root IS NULL ${ORDER}`, [row.id])
      : [];
  const [lib] = root.library_id ? await q<{ name: string }>("SELECT name FROM libraries WHERE id = $1", [root.library_id]) : [];
  return { item: pub(row), path: path.map(pub), children: children.map(pub), owner: lib?.name ?? root.owner };
}

export async function linkContent(token: string, itemId?: string | null): Promise<{ row: Row; sha: string; size: number }> {
  const { row } = await underLink(token, itemId);
  return pick(row);
}

export async function linkFolder(token: string, itemId?: string | null): Promise<Row> {
  const { row } = await underLink(token, itemId);
  if (row.kind !== "folder") throw new UserError("That is not a folder");
  return row;
}

/* --------------------------------------------------------------- libraries */

/** `managedBy`: the app that decides who is in it (e.g. "sites:12"), or null when its owners do. */
export type Library = { id: string; name: string; description: string; role: Role; members: number; managedBy: string | null };

export async function libraries(me: Me): Promise<Library[]> {
  const rows = await q<{ id: string; name: string; description: string; role: Role; members: string; managed_by: string | null }>(
    `SELECT l.id, l.name, l.description, m.role, l.managed_by,
            (SELECT COUNT(*) FROM library_members x WHERE x.library_id = l.id) AS members
     FROM libraries l JOIN library_members m ON m.library_id = l.id AND m.email = $1 ORDER BY lower(l.name)`,
    [me.email],
  );
  return rows.map(({ managed_by, ...r }) => ({ ...r, members: Number(r.members), managedBy: managed_by }));
}

export async function createLibrary(me: Me, rawName: string, description = ""): Promise<Library> {
  const name = cleanName(rawName);
  const lib = await tx(async (tq) => {
    const [l] = await tq<{ id: string }>("INSERT INTO libraries (name, description, created_by) VALUES ($1, $2, $3) RETURNING id", [
      name,
      String(description).slice(0, 500),
      me.email,
    ]);
    await tq("INSERT INTO library_members (library_id, email, role) VALUES ($1, $2, 'owner')", [l.id, me.email]);
    return l;
  });
  return { id: lib.id, name, description, role: "owner", members: 1, managedBy: null };
}

async function libraryOwner(me: Me, libraryId: string): Promise<string> {
  const lib = id(libraryId);
  const role = await libraryRole(me.email, lib);
  if (!role) throw new UserError("Not found", 404);
  if (role !== "owner") throw new UserError("Only the library's owners can do that", 403);
  return lib;
}

/** Refuses changes to a library's name or people when another app keeps them. */
async function refuseManaged(lib: string): Promise<void> {
  const [l] = await q<{ managed_by: string | null }>("SELECT managed_by FROM libraries WHERE id = $1", [lib]);
  if (l?.managed_by?.startsWith("sites:")) throw new UserError("This is a site's document library: change its name and people in Sites", 409);
  if (l?.managed_by) throw new UserError("This library's people are managed in another app", 409);
}

async function unmanagedLibrary(me: Me, libraryId: string): Promise<string> {
  const lib = await libraryOwner(me, libraryId);
  await refuseManaged(lib);
  return lib;
}

export async function updateLibrary(me: Me, libraryId: string, patch: { name?: string; description?: string }): Promise<void> {
  const lib = await unmanagedLibrary(me, libraryId);
  if (patch.name !== undefined) await q("UPDATE libraries SET name = $2 WHERE id = $1", [lib, cleanName(patch.name)]);
  if (patch.description !== undefined) await q("UPDATE libraries SET description = $2 WHERE id = $1", [lib, String(patch.description).slice(0, 500)]);
}

/** Only an empty library can be deleted, so nobody loses files by accident. */
export async function deleteLibrary(me: Me, libraryId: string): Promise<void> {
  await removeLibrary(await unmanagedLibrary(me, libraryId));
}

/** Deletes an empty library (409 while it holds files); one with held files loses its members and stays. */
export async function removeLibrary(lib: string): Promise<void> {
  const [live] = await q("SELECT 1 FROM items WHERE library_id = $1 AND trash_root IS NULL LIMIT 1", [lib]);
  if (live) throw new UserError("Move or delete everything in the library first", 409);
  const ids = (await q<{ id: string }>("SELECT id FROM items WHERE library_id = $1 AND parent_id IS NULL", [lib])).map((r) => r.id);
  if (ids.length) await destroy(ids);
  const [kept] = await q("SELECT 1 FROM items WHERE library_id = $1 LIMIT 1", [lib]);
  // A legal hold kept some of its files: the library goes out of sight, emptied of members, and stays.
  if (kept) await q("DELETE FROM library_members WHERE library_id = $1", [lib]);
  else await q("DELETE FROM libraries WHERE id = $1", [lib]);
}

export async function members(me: Me, libraryId: string): Promise<{ email: string; role: Role }[]> {
  const lib = id(libraryId);
  if (!(await libraryRole(me.email, lib))) throw new UserError("Not found", 404);
  return q<{ email: string; role: Role }>(
    "SELECT email, role FROM library_members WHERE library_id = $1 ORDER BY (role = 'owner') DESC, email",
    [lib],
  );
}

export async function setMember(me: Me, libraryId: string, rawEmail: unknown, rawRole: unknown): Promise<void> {
  const lib = await unmanagedLibrary(me, libraryId);
  const email = cleanEmail(rawEmail);
  if (!isRole(rawRole)) throw new UserError("Pick a role");
  await tx(async (tq) => {
    await tq(
      `INSERT INTO library_members (library_id, email, role) VALUES ($1, $2, $3)
       ON CONFLICT (library_id, email) DO UPDATE SET role = EXCLUDED.role`,
      [lib, email, rawRole],
    );
    await keepAnOwner(tq, lib);
  });
}

export async function removeMember(me: Me, libraryId: string, rawEmail: unknown): Promise<void> {
  const email = String(rawEmail ?? "").toLowerCase();
  const lib = email === me.email ? id(libraryId) : await libraryOwner(me, libraryId);
  await refuseManaged(lib);
  await tx(async (tq) => {
    await tq("DELETE FROM library_members WHERE library_id = $1 AND email = $2", [lib, email]);
    await keepAnOwner(tq, lib);
  });
}

async function keepAnOwner(tq: Tq, lib: string): Promise<void> {
  const [o] = await tq("SELECT 1 FROM library_members WHERE library_id = $1 AND role = 'owner' LIMIT 1", [lib]);
  if (!o) throw new UserError("A library needs at least one owner");
}

/* --------------------------------------------------------- activity and AI */

export async function activity(me: Me, itemId: string): Promise<{ actor: string; action: string; detail: string; at: string }[]> {
  const { row } = await access(me, itemId, "viewer");
  const rows = await q<{ actor: string; action: string; detail: string; at: Date }>(
    "SELECT actor, action, detail, at FROM activity WHERE item_id = $1 ORDER BY at DESC, id DESC LIMIT 100",
    [row.id],
  );
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

export async function textFor(me: Me, itemId: string): Promise<{ row: Row; text: string }> {
  const { row } = await access(me, itemId, "viewer");
  if (!row.text) throw new UserError("Only text files can be summarized for now");
  return { row, text: row.text };
}

export async function saveSummary(itemId: string, sha: string | null, summary: string): Promise<void> {
  await q("UPDATE items SET summary = $2, summary_sha = $3 WHERE id = $1", [itemId, summary, sha]);
}
