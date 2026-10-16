import type { Me } from "./api";
import { q } from "./db";
import { holdChecker } from "./compliance";
import { UserError, cleanEmail, text } from "./util";
import * as access from "./access.mjs";
import * as ydoc from "./ydoc.mjs";
import type { Role } from "./access.mjs";

export type { Role };
export { ydoc };

export const { canEdit, isUuid } = access;
export const workspaceRole = (id: string, email: string) => access.workspaceRole(q, id, email);
export const pageRole = (id: string, email: string) => access.pageRole(q, id, email);
export const componentRole = (id: string, email: string) => access.componentRole(q, id, email);

export type Workspace = { id: string; name: string; emoji: string; owner: string; role: Role; pages: number; modified_at: string };
export type Member = { email: string; role: "editor" | "viewer" | "owner" };
export type PageMeta = {
  id: string; workspace_id: string; parent_id: string | null; title: string; emoji: string; position: number;
  created_by: string; modified_by: string | null; modified_at: string;
};
export type ComponentMeta = {
  id: string; kind: string; title: string; owner: string; workspace_id: string | null; workspace_name: string | null;
  link_access: "org-edit" | "org-view" | "people"; modified_by: string | null; modified_at: string;
};

const ROLES = ["editor", "viewer"] as const;
const LINK_ACCESS = ["org-edit", "org-view", "people"] as const;

function notFound(what = "That"): never {
  throw new UserError(`${what} isn't there, or you don't have access to it`, 404);
}

function role(v: unknown): "editor" | "viewer" {
  return ROLES.includes(v as "editor") ? (v as "editor" | "viewer") : "editor";
}

async function requireWorkspace(me: Me, id: string, edit = false): Promise<Role> {
  const r = await workspaceRole(id, me.email);
  if (!r) notFound("That workspace");
  if (edit && !canEdit(r)) throw new UserError("You can view this workspace but not change it", 403);
  return r;
}

async function visit(me: Me, kind: "page" | "component", id: string): Promise<void> {
  await q(
    `INSERT INTO visits (email, item_kind, item_id) VALUES ($1, $2, $3)
     ON CONFLICT (email, item_kind, item_id) DO UPDATE SET at = now()`,
    [me.email, kind, id],
  );
}

// ---------- workspaces ----------

export async function listWorkspaces(me: Me): Promise<Workspace[]> {
  return q<Workspace>(
    `SELECT w.id, w.name, w.emoji, w.owner, w.modified_at,
       CASE WHEN w.owner = $1 THEN 'owner' ELSE m.role END AS role,
       (SELECT count(*)::int FROM pages p WHERE p.workspace_id = w.id AND p.held_deleted_at IS NULL) AS pages
     FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.email = $1
     WHERE w.held_deleted_at IS NULL AND (w.owner = $1 OR m.email IS NOT NULL)
     ORDER BY w.modified_at DESC, w.name`,
    [me.email],
  );
}

export async function createWorkspace(me: Me, input: { name?: unknown; emoji?: unknown }): Promise<{ id: string; pageId: string }> {
  const name = text(input.name, 120);
  if (!name) throw new UserError("Give the workspace a name");
  const [w] = await q<{ id: string }>("INSERT INTO workspaces (owner, name, emoji) VALUES ($1, $2, $3) RETURNING id", [
    me.email, name, text(input.emoji, 8),
  ]);
  const page = await createPage(me, { workspaceId: w.id, title: "Untitled page" });
  return { id: w.id, pageId: page.id };
}

export async function getWorkspace(me: Me, id: string) {
  const r = await requireWorkspace(me, id);
  const [w] = await q<{ id: string; name: string; emoji: string; owner: string }>(
    "SELECT id, name, emoji, owner FROM workspaces WHERE id = $1",
    [id],
  );
  const members = await q<Member>(
    "SELECT email, role FROM workspace_members WHERE workspace_id = $1 ORDER BY added_at, email",
    [id],
  );
  const pages = await q<PageMeta>(
    `SELECT id, workspace_id, parent_id, title, emoji, position, created_by, modified_by, modified_at
     FROM pages WHERE workspace_id = $1 AND held_deleted_at IS NULL ORDER BY position, created_at`,
    [id],
  );
  return { ...w, role: r, members: [{ email: w.owner, role: "owner" as const }, ...members], pages };
}

export async function updateWorkspace(me: Me, id: string, input: { name?: unknown; emoji?: unknown }): Promise<void> {
  await requireWorkspace(me, id, true);
  const name = input.name === undefined ? null : text(input.name, 120);
  if (name === "") throw new UserError("Give the workspace a name");
  await q(
    `UPDATE workspaces SET name = COALESCE($2, name), emoji = COALESCE($3, emoji), modified_at = now() WHERE id = $1`,
    [id, name, input.emoji === undefined ? null : text(input.emoji, 8)],
  );
}

/** Everyone whose content a workspace holds: its owner, its members and whoever wrote its pages. */
async function workspacePeople(id: string): Promise<string[]> {
  const rows = await q<{ e: string }>(
    `SELECT owner AS e FROM workspaces WHERE id = $1
     UNION SELECT email FROM workspace_members WHERE workspace_id = $1
     UNION SELECT created_by FROM pages WHERE workspace_id = $1
     UNION SELECT modified_by FROM pages WHERE workspace_id = $1 AND modified_by IS NOT NULL`,
    [id],
  );
  return rows.map((r) => r.e);
}

async function anyOnHold(people: string[]): Promise<boolean> {
  const held = holdChecker();
  for (const p of people) if (await held(p)) return true;
  return false;
}

export async function deleteWorkspace(me: Me, id: string): Promise<{ kept: boolean }> {
  const r = await requireWorkspace(me, id);
  if (r !== "owner") throw new UserError("Only the owner can delete a workspace", 403);
  if (await anyOnHold(await workspacePeople(id))) {
    await q("UPDATE workspaces SET held_deleted_at = now() WHERE id = $1", [id]);
    await q("UPDATE pages SET held_deleted_at = now() WHERE workspace_id = $1 AND held_deleted_at IS NULL", [id]);
    return { kept: true };
  }
  // Its components stay with their owners; they just lose their home workspace.
  await q("DELETE FROM workspaces WHERE id = $1", [id]);
  return { kept: false };
}

export async function addWorkspaceMember(me: Me, id: string, input: { email?: unknown; role?: unknown }): Promise<void> {
  await requireWorkspace(me, id, true);
  const email = cleanEmail(input.email);
  const [w] = await q<{ owner: string }>("SELECT owner FROM workspaces WHERE id = $1", [id]);
  if (w.owner === email) throw new UserError("That person owns this workspace");
  await q(
    `INSERT INTO workspace_members (workspace_id, email, role, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, role(input.role), me.email],
  );
}

/** The owner removes anyone; everyone else can only leave. */
export async function removeWorkspaceMember(me: Me, id: string, emailIn: unknown): Promise<void> {
  const r = await requireWorkspace(me, id);
  const email = cleanEmail(emailIn);
  if (r !== "owner" && email !== me.email) throw new UserError("Only the owner can remove other people", 403);
  await q("DELETE FROM workspace_members WHERE workspace_id = $1 AND email = $2", [id, email]);
}

// ---------- pages ----------

export async function createPage(
  me: Me,
  input: { workspaceId?: unknown; parentId?: unknown; title?: unknown; emoji?: unknown },
): Promise<PageMeta> {
  const workspaceId = String(input.workspaceId ?? "");
  await requireWorkspace(me, workspaceId, true);
  const parentId = input.parentId ? String(input.parentId) : null;
  if (parentId) {
    const [p] = await q("SELECT 1 FROM pages WHERE id = $1 AND workspace_id = $2 AND held_deleted_at IS NULL", [
      isUuid(parentId) ? parentId : null, workspaceId,
    ]);
    if (!p) throw new UserError("The page to put it under isn't in this workspace");
  }
  const [page] = await q<PageMeta>(
    `INSERT INTO pages (workspace_id, parent_id, title, emoji, position, ydoc, created_by, modified_by)
     VALUES ($1, $2, $3, $4,
       COALESCE((SELECT max(position) + 1 FROM pages WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2), 0),
       $5, $6, $6)
     RETURNING id, workspace_id, parent_id, title, emoji, position, created_by, modified_by, modified_at`,
    [workspaceId, parentId, text(input.title, 200), text(input.emoji, 8), Buffer.from(ydoc.seededState("page")), me.email],
  );
  await q("UPDATE workspaces SET modified_at = now() WHERE id = $1", [workspaceId]);
  return page;
}

export async function getPage(me: Me, id: string) {
  const r = await pageRole(id, me.email);
  if (!r) notFound("That page");
  const [p] = await q<PageMeta & { workspace_name: string; workspace_emoji: string }>(
    `SELECT p.id, p.workspace_id, p.parent_id, p.title, p.emoji, p.position, p.created_by, p.modified_by, p.modified_at,
       w.name AS workspace_name, w.emoji AS workspace_emoji
     FROM pages p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = $1`,
    [id],
  );
  await visit(me, "page", id);
  return { ...p, role: r };
}

export async function updatePage(
  me: Me,
  id: string,
  input: { title?: unknown; emoji?: unknown; parentId?: unknown; position?: unknown },
): Promise<void> {
  const r = await pageRole(id, me.email);
  if (!r) notFound("That page");
  if (!canEdit(r)) throw new UserError("You can view this page but not change it", 403);
  const [page] = await q<{ workspace_id: string }>("SELECT workspace_id FROM pages WHERE id = $1", [id]);
  let parentSet = false;
  let parentId: string | null = null;
  if (input.parentId !== undefined) {
    parentSet = true;
    parentId = input.parentId ? String(input.parentId) : null;
    if (parentId) {
      if (!isUuid(parentId)) throw new UserError("The page to put it under isn't in this workspace");
      // The new parent must be in the same workspace and not this page or one under it.
      const [ok] = await q<{ bad: boolean }>(
        `WITH RECURSIVE under AS (
           SELECT id FROM pages WHERE id = $1
           UNION SELECT p.id FROM pages p JOIN under u ON p.parent_id = u.id
         )
         SELECT EXISTS (SELECT 1 FROM under WHERE id = $2) AS bad
         FROM pages WHERE id = $2 AND workspace_id = $3 AND held_deleted_at IS NULL`,
        [id, parentId, page.workspace_id],
      );
      if (!ok) throw new UserError("The page to put it under isn't in this workspace");
      if (ok.bad) throw new UserError("A page can't go under itself");
    }
  }
  const position = input.position === undefined ? null : Number(input.position);
  if (position !== null && !Number.isFinite(position)) throw new UserError("Bad position");
  await q(
    `UPDATE pages SET title = COALESCE($2, title), emoji = COALESCE($3, emoji),
       parent_id = CASE WHEN $4 THEN $5::uuid ELSE parent_id END, position = COALESCE($6, position),
       modified_at = now(), modified_by = $7
     WHERE id = $1`,
    [
      id,
      input.title === undefined ? null : text(input.title, 200),
      input.emoji === undefined ? null : text(input.emoji, 8),
      parentSet,
      parentId,
      position,
      me.email,
    ],
  );
}

/** Deletes a page and everything under it, or keeps them hidden when someone on them is on hold. */
export async function deletePage(me: Me, id: string): Promise<{ kept: boolean }> {
  const r = await pageRole(id, me.email);
  if (!r) notFound("That page");
  if (!canEdit(r)) throw new UserError("You can view this page but not change it", 403);
  const [p] = await q<{ workspace_id: string }>("SELECT workspace_id FROM pages WHERE id = $1", [id]);
  const tree = `WITH RECURSIVE under AS (
    SELECT id FROM pages WHERE id = $1 UNION SELECT p.id FROM pages p JOIN under u ON p.parent_id = u.id
  )`;
  const writers = await q<{ e: string }>(
    `${tree} SELECT created_by AS e FROM pages WHERE id IN (SELECT id FROM under)
     UNION SELECT modified_by FROM pages WHERE id IN (SELECT id FROM under) AND modified_by IS NOT NULL`,
    [id],
  );
  const people = [...new Set([...(await workspacePeople(p.workspace_id)), ...writers.map((w) => w.e)])];
  if (await anyOnHold(people)) {
    await q(`${tree} UPDATE pages SET held_deleted_at = now() WHERE id IN (SELECT id FROM under) AND held_deleted_at IS NULL`, [id]);
    return { kept: true };
  }
  await q("DELETE FROM pages WHERE id = $1", [id]);
  return { kept: false };
}

// ---------- components ----------

export async function createComponent(
  me: Me,
  input: { kind?: unknown; title?: unknown; workspaceId?: unknown; items?: unknown },
): Promise<ComponentMeta> {
  const kind = String(input.kind ?? "");
  const info = ydoc.kindInfo(kind);
  if (!info) throw new UserError("Pick a kind of component");
  const workspaceId = input.workspaceId ? String(input.workspaceId) : null;
  if (workspaceId) await requireWorkspace(me, workspaceId, true);
  const items = startingItems(kind, input.items);
  const [c] = await q<{ id: string }>(
    `INSERT INTO components (kind, title, owner, workspace_id, ydoc, modified_by) VALUES ($1, $2, $3, $4, $5, $3) RETURNING id`,
    [kind, text(input.title, 200) || info.name, me.email, workspaceId, Buffer.from(ydoc.seededState(kind, items))],
  );
  return (await componentMeta(c.id))!;
}

/** Rows a new task list, tracker, poll or Q&A starts with (such as tasks Copilot found on a page). */
function startingItems(kind: string, v: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(v) || !v.length) return undefined;
  const day = (d: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d ?? "")) ? String(d) : "");
  return v.slice(0, 200).flatMap((raw): Record<string, unknown>[] => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const title = text(r.title, 300);
    if (!title) return [];
    if (kind === "tasks") return [{ title, assignee: text(r.assignee, 200), due: day(r.due) }];
    if (kind === "progress") return [{ title, owner: text(r.owner, 200), notes: text(r.notes, 2000) }];
    if (kind === "voting") return [{ title, notes: text(r.notes, 2000) }];
    if (kind === "qa") return [{ title, by: "" }];
    return [];
  });
}

async function componentMeta(id: string): Promise<ComponentMeta | null> {
  const [c] = await q<ComponentMeta>(
    `SELECT c.id, c.kind, c.title, c.owner, c.workspace_id, w.name AS workspace_name, c.link_access, c.modified_by, c.modified_at
     FROM components c LEFT JOIN workspaces w ON w.id = c.workspace_id AND w.held_deleted_at IS NULL
     WHERE c.id = $1`,
    [id],
  );
  return c ?? null;
}

/** `quiet`: shown inside a page the person is already on, so it doesn't count as opening it. */
export async function getComponent(me: Me, id: string, quiet = false) {
  const r = await componentRole(id, me.email);
  if (!r) notFound("That component");
  const meta = (await componentMeta(id))!;
  const members = await q<Member>("SELECT email, role FROM component_members WHERE component_id = $1 ORDER BY added_at, email", [id]);
  if (!quiet) await visit(me, "component", id);
  return { ...meta, role: r, members: [{ email: meta.owner, role: "owner" as const }, ...members] };
}

export async function updateComponent(me: Me, id: string, input: { title?: unknown; linkAccess?: unknown }): Promise<void> {
  const r = await componentRole(id, me.email);
  if (!r) notFound("That component");
  if (!canEdit(r)) throw new UserError("You can view this component but not change it", 403);
  let linkAccess: string | null = null;
  if (input.linkAccess !== undefined) {
    if (r !== "owner") throw new UserError("Only the owner can change who the link works for", 403);
    if (!LINK_ACCESS.includes(input.linkAccess as "people")) throw new UserError("Pick who the link works for");
    linkAccess = String(input.linkAccess);
  }
  const title = input.title === undefined ? null : text(input.title, 200);
  if (title === "") throw new UserError("Give the component a name");
  await q(
    `UPDATE components SET title = COALESCE($2, title), link_access = COALESCE($3, link_access), modified_at = now(), modified_by = $4
     WHERE id = $1`,
    [id, title, linkAccess, me.email],
  );
}

export async function addComponentMember(me: Me, id: string, input: { email?: unknown; role?: unknown }): Promise<void> {
  const r = await componentRole(id, me.email);
  if (!r) notFound("That component");
  if (!canEdit(r)) throw new UserError("You can view this component but not share it", 403);
  const email = cleanEmail(input.email);
  const [c] = await q<{ owner: string }>("SELECT owner FROM components WHERE id = $1", [id]);
  if (c.owner === email) throw new UserError("That person owns this component");
  await q(
    `INSERT INTO component_members (component_id, email, role, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (component_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, role(input.role), me.email],
  );
}

export async function removeComponentMember(me: Me, id: string, emailIn: unknown): Promise<void> {
  const r = await componentRole(id, me.email);
  if (!r) notFound("That component");
  const email = cleanEmail(emailIn);
  if (r !== "owner" && email !== me.email) throw new UserError("Only the owner can remove other people", 403);
  await q("DELETE FROM component_members WHERE component_id = $1 AND email = $2", [id, email]);
}

export async function deleteComponent(me: Me, id: string): Promise<{ kept: boolean }> {
  const r = await componentRole(id, me.email);
  if (!r) notFound("That component");
  if (r !== "owner") throw new UserError("Only the owner can delete a component", 403);
  const people = await q<{ e: string }>(
    `SELECT owner AS e FROM components WHERE id = $1
     UNION SELECT modified_by FROM components WHERE id = $1 AND modified_by IS NOT NULL
     UNION SELECT email FROM component_members WHERE component_id = $1`,
    [id],
  );
  if (await anyOnHold(people.map((p) => p.e))) {
    await q("UPDATE components SET held_deleted_at = now() WHERE id = $1", [id]);
    return { kept: true };
  }
  await q("DELETE FROM components WHERE id = $1", [id]);
  return { kept: false };
}

// ---------- home ----------

export type RecentItem = {
  kind: "page" | "component"; id: string; title: string; emoji: string; detail: string; at: string; workspace_id: string | null;
};

/** What the person opened last that they can still open, newest first. */
export async function recent(me: Me, limit = 30): Promise<RecentItem[]> {
  const rows = await q<RecentItem>(
    `SELECT v.item_kind AS kind, v.item_id AS id, v.at,
       COALESCE(p.title, c.title, '') AS title, COALESCE(p.emoji, '') AS emoji,
       COALESCE(pw.name, c.kind, '') AS detail, COALESCE(p.workspace_id, c.workspace_id) AS workspace_id
     FROM visits v
     LEFT JOIN pages p ON v.item_kind = 'page' AND p.id = v.item_id AND p.held_deleted_at IS NULL
     LEFT JOIN workspaces pw ON pw.id = p.workspace_id
     LEFT JOIN components c ON v.item_kind = 'component' AND c.id = v.item_id AND c.held_deleted_at IS NULL
     WHERE v.email = $1 AND (p.id IS NOT NULL OR c.id IS NOT NULL)
     ORDER BY v.at DESC LIMIT $2`,
    [me.email, limit * 2],
  );
  const out: RecentItem[] = [];
  for (const r of rows) {
    const ok = r.kind === "page" ? await pageRole(r.id, me.email) : await componentRole(r.id, me.email);
    if (!ok) continue;
    if (r.kind === "component") r.detail = ydoc.kindInfo(r.detail)?.name ?? r.detail;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** Components the person owns or was added to, newest first. */
export async function myComponents(me: Me): Promise<ComponentMeta[]> {
  return q<ComponentMeta>(
    `SELECT c.id, c.kind, c.title, c.owner, c.workspace_id, w.name AS workspace_name, c.link_access, c.modified_by, c.modified_at
     FROM components c LEFT JOIN workspaces w ON w.id = c.workspace_id AND w.held_deleted_at IS NULL
     WHERE c.held_deleted_at IS NULL
       AND (c.owner = $1 OR EXISTS (SELECT 1 FROM component_members m WHERE m.component_id = c.id AND m.email = $1))
     ORDER BY c.modified_at DESC LIMIT 100`,
    [me.email],
  );
}
