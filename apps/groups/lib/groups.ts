import { randomUUID } from "node:crypto";
import type { Me } from "./api";
import { type Tq, q, tx } from "./db";
import { type Channel, type GroupDetail, type GroupSummary, type Kind, KINDS_ALL, type Member, type Resource, type Role, type Standing } from "./types";
import { UserError, cleanEmail, text, uuidish } from "./util";

/**
 * Groups, their members and who may do what. Owners run a group (settings, members, channels,
 * delete); members see it and use what it brings; anyone may join a public team, and asks to join
 * a private one. GROUPS_ADMIN_EMAILS may manage every group. GROUPS_CREATE=admins keeps creating
 * groups to them (Microsoft 365's "only some people create groups"); by default everyone can.
 */

export const GROUP_PREFIX = "group:";
const ALIAS = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const RESTORE_DAYS = 30;

function list(v: string | undefined): string[] {
  return (v ?? "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return list(env.GROUPS_ADMIN_EMAILS).includes(email.toLowerCase());
}

export function mayCreate(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GROUPS_CREATE !== "admins" || isAdmin(email, env);
}

/** The domain group addresses live on: GROUPS_MAIL_DOMAIN, else MAIL_DOMAIN, else SUITE_DOMAIN. */
export function mailDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GROUPS_MAIL_DOMAIN || env.MAIL_DOMAIN || env.SUITE_DOMAIN || "example.test").toLowerCase();
}

/** "Sales Team EU" -> "sales-team-eu" */
export function aliasFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "group";
}

function cleanAlias(v: unknown): string {
  const a = String(v ?? "").trim().toLowerCase().replace(/@.*$/, "");
  if (!ALIAS.test(a)) throw new UserError("An address can use letters, numbers, dots, dashes and underscores");
  return a;
}

/** A member as typed: an email, or "group:<id>". */
export function cleanMember(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith(GROUP_PREFIX)) {
    const id = s.slice(GROUP_PREFIX.length);
    if (!uuidish(id)) throw new UserError("That isn't a group");
    return GROUP_PREFIX + id;
  }
  return cleanEmail(s);
}

function kindOf(v: unknown): Kind {
  if (!KINDS_ALL.includes(v as Kind)) throw new UserError("Pick a kind of group");
  return v as Kind;
}

/** Kinds that have an address. A team's is optional (its shared mailbox). */
export function needsAddress(kind: Kind): boolean {
  return kind === "distribution" || kind === "shared_mailbox";
}

export async function audit(tq: Tq, groupId: string, actor: string, action: string, detail = ""): Promise<void> {
  await tq(`INSERT INTO audit (group_id, actor, action, detail) VALUES ($1::uuid, $2, $3, $4)`, [groupId, actor, action, detail.slice(0, 1000)]);
}

// ---- membership -------------------------------------------------------------------------------

/** Every person in a group, nested groups flattened (deleted groups don't count). Members include owners. */
export async function flatMembers(groupId: string): Promise<string[]> {
  const rows = await q<{ member: string }>(
    `WITH RECURSIVE m(member) AS (
       SELECT member FROM members WHERE group_id = $1::uuid
       UNION
       SELECT x.member FROM members x JOIN m ON m.member = 'group:' || x.group_id::text
         JOIN groups g ON g.id = x.group_id AND g.deleted_at IS NULL
     )
     SELECT member FROM m WHERE member NOT LIKE 'group:%' ORDER BY member`,
    [groupId],
  );
  return rows.map((r) => r.member);
}

export async function owners(groupId: string): Promise<string[]> {
  const rows = await q<{ member: string }>(
    `SELECT member FROM members WHERE group_id = $1::uuid AND role = 'owner' AND member NOT LIKE 'group:%' ORDER BY member`,
    [groupId],
  );
  return rows.map((r) => r.member);
}

export type Membership = { id: string; kind: Kind; name: string; email: string; role: Role };

/** Every live group a person is in, directly or through nested groups; "owner" only for direct ownership. */
export async function membershipsOf(email: string): Promise<Membership[]> {
  const rows = await q<{ id: string; kind: Kind; name: string; email: string | null; role: Role }>(
    `WITH RECURSIVE c(gid, role) AS (
       SELECT m.group_id, m.role FROM members m JOIN groups g ON g.id = m.group_id AND g.deleted_at IS NULL WHERE m.member = $1
       UNION
       SELECT x.group_id, 'member' FROM members x JOIN c ON x.member = 'group:' || c.gid::text
         JOIN groups g ON g.id = x.group_id AND g.deleted_at IS NULL
     )
     SELECT DISTINCT ON (g.id) g.id, g.kind, g.name, g.email, c.role
     FROM c JOIN groups g ON g.id = c.gid
     ORDER BY g.id, (c.role = 'owner') DESC`,
    [email.toLowerCase()],
  );
  return rows
    .map((r) => ({ id: r.id, kind: r.kind, name: r.name, email: r.email ?? "", role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What `email` is to a group. Null when the group doesn't exist (or is deleted) or they aren't in it. */
export async function standing(email: string, groupId: string): Promise<Standing> {
  if (!uuidish(groupId)) return null;
  const [direct] = await q<{ role: Role }>(`SELECT role FROM members WHERE group_id = $1::uuid AND member = $2`, [groupId, email]);
  if (direct?.role === "owner") return "owner";
  if (isAdmin(email)) return "admin";
  if (direct) return "member";
  return (await membershipsOf(email)).some((m) => m.id === groupId) ? "member" : null;
}

type GroupRow = {
  id: string; kind: Kind; name: string; description: string; email: string | null; privacy: "private" | "public";
  allow_external: boolean; created_by: string; created_at: Date; deleted_at: Date | null; synced_at: Date | null; members: string;
};

const COLS = `g.id, g.kind, g.name, g.description, g.email, g.privacy, g.allow_external, g.created_by, g.created_at, g.deleted_at, g.synced_at,
  (SELECT COUNT(*) FROM members x WHERE x.group_id = g.id) AS members`;

async function row(groupId: string, includeDeleted = false): Promise<GroupRow> {
  if (!uuidish(groupId)) throw new UserError("Not found", 404);
  const [g] = await q<GroupRow>(`SELECT ${COLS} FROM groups g WHERE g.id = $1::uuid ${includeDeleted ? "" : "AND g.deleted_at IS NULL"}`, [groupId]);
  if (!g) throw new UserError("Not found", 404);
  return g;
}

function summary(g: GroupRow, role: Standing): GroupSummary {
  return {
    id: g.id, kind: g.kind, name: g.name, description: g.description, email: g.email, privacy: g.privacy,
    members: Number(g.members), role, deletedAt: g.deleted_at?.toISOString() ?? null,
  };
}

/** Owners (and admins) only. */
export async function requireOwner(email: string, groupId: string): Promise<GroupRow> {
  const g = await row(groupId);
  const s = await standing(email, groupId);
  if (s !== "owner" && s !== "admin") throw new UserError(s ? "Only the group's owners can do that" : "Not found", s ? 403 : 404);
  return g;
}

/** Anyone in the group (or an admin). A public team can also be seen by anyone, to join it. */
export async function requireMember(email: string, groupId: string): Promise<{ g: GroupRow; role: Standing }> {
  const g = await row(groupId);
  const role = await standing(email, groupId);
  if (!role) throw new UserError("Not found", 404);
  return { g, role };
}

// ---- reading ----------------------------------------------------------------------------------

export type View = "mine" | "discover" | "deleted";

export async function listGroups(me: Me, view: View = "mine"): Promise<GroupSummary[]> {
  if (view === "mine") {
    const mine = await membershipsOf(me.email);
    if (!mine.length) return [];
    const rows = await q<GroupRow>(`SELECT ${COLS} FROM groups g WHERE g.id = ANY($1::uuid[]) ORDER BY lower(g.name)`, [mine.map((m) => m.id)]);
    const role = new Map(mine.map((m) => [m.id, m.role]));
    return rows.map((r) => summary(r, role.get(r.id) ?? "member"));
  }
  if (view === "discover") {
    // Public teams and groups the person isn't in yet, plus every group for an admin.
    const mine = new Set((await membershipsOf(me.email)).map((m) => m.id));
    const rows = await q<GroupRow & { requested: boolean }>(
      `SELECT ${COLS}, EXISTS (SELECT 1 FROM join_requests r WHERE r.group_id = g.id AND r.email = $1) AS requested
       FROM groups g WHERE g.deleted_at IS NULL AND (g.privacy = 'public' OR $2) ORDER BY lower(g.name) LIMIT 500`,
      [me.email, isAdmin(me.email)],
    );
    return rows.filter((r) => !mine.has(r.id)).map((r) => ({ ...summary(r, isAdmin(me.email) ? "admin" : null), requested: r.requested }));
  }
  const rows = await q<GroupRow>(
    `SELECT ${COLS} FROM groups g
     WHERE g.deleted_at IS NOT NULL AND g.deleted_at > now() - make_interval(days => $3)
       AND ($2 OR EXISTS (SELECT 1 FROM members m WHERE m.group_id = g.id AND m.member = $1 AND m.role = 'owner'))
     ORDER BY g.deleted_at DESC`,
    [me.email, isAdmin(me.email), RESTORE_DAYS],
  );
  return rows.map((r) => summary(r, "owner"));
}

export async function getGroup(me: Me, groupId: string): Promise<GroupDetail> {
  const g = await row(groupId);
  let role = await standing(me.email, groupId);
  if (!role && g.privacy !== "public") throw new UserError("Not found", 404);
  const owner = role === "owner" || role === "admin";
  const memberRows = await q<{ member: string; role: Role; added_by: string; added_at: Date; gname: string | null; gkind: Kind | null; gid: string | null }>(
    `SELECT m.member, m.role, m.added_by, m.added_at, n.name AS gname, n.kind AS gkind, n.id AS gid
     FROM members m LEFT JOIN groups n ON m.member = 'group:' || n.id::text
     WHERE m.group_id = $1::uuid ORDER BY m.role = 'owner' DESC, m.member`,
    [groupId],
  );
  const directMembers: Member[] = memberRows.map((m) => ({
    member: m.member, role: m.role, addedBy: m.added_by, addedAt: m.added_at.toISOString(),
    group: m.gid ? { id: m.gid, name: m.gname ?? "", kind: m.gkind! } : null,
  }));
  const channels = await q<{ key: string; name: string; topic: string }>(
    `SELECT key, name, topic FROM channels WHERE group_id = $1::uuid ORDER BY position, created_at`,
    [groupId],
  );
  const resources = await q<{ app: string; ref: string; name: string; url: string; status: Resource["status"]; error: string; synced_at: Date }>(
    `SELECT app, ref, name, url, status, error, synced_at FROM resources WHERE group_id = $1::uuid ORDER BY app`,
    [groupId],
  );
  const requests = owner
    ? await q<{ email: string; message: string; created_at: Date }>(`SELECT email, message, created_at FROM join_requests WHERE group_id = $1::uuid ORDER BY created_at`, [groupId])
    : [];
  const [req] = role ? [] : await q(`SELECT 1 FROM join_requests WHERE group_id = $1::uuid AND email = $2`, [groupId, me.email]);
  const chatChannels = channelUrls(resources.find((r) => r.app === "chat"));
  role = role ?? null;
  return {
    ...summary(g, role),
    requested: !!req,
    allowExternal: g.allow_external,
    createdBy: g.created_by,
    createdAt: g.created_at.toISOString(),
    owners: directMembers.filter((m) => m.role === "owner").map((m) => m.member),
    // People outside a public team see who owns it, not the whole membership.
    directMembers: role ? directMembers : directMembers.filter((m) => m.role === "owner"),
    channels: channels.map((c): Channel => ({ ...c, url: chatChannels[c.key] })),
    resources: role
      ? resources.map((r) => ({ app: r.app, ref: r.ref, name: r.name, url: r.url, status: r.status, error: owner ? r.error : "", syncedAt: r.synced_at.toISOString() }))
      : [],
    requests: requests.map((r) => ({ email: r.email, message: r.message, createdAt: r.created_at.toISOString() })),
    syncedAt: g.synced_at?.toISOString() ?? null,
  };
}

/** Chat keeps each channel's link in the chat resource's ref as JSON: { "<key>": "<url>" }. */
function channelUrls(r: { ref: string } | undefined): Record<string, string> {
  if (!r?.ref) return {};
  try {
    const v = JSON.parse(r.ref);
    return v && typeof v === "object" && v.channels && typeof v.channels === "object" ? v.channels : {};
  } catch {
    return {};
  }
}

// ---- changing ---------------------------------------------------------------------------------

export type GroupInput = {
  kind?: unknown; name?: unknown; description?: unknown; privacy?: unknown; alias?: unknown;
  allowExternal?: unknown; members?: unknown; owners?: unknown;
};

function members(v: unknown): string[] {
  if (v === undefined || v === null || v === "") return [];
  const items = Array.isArray(v) ? v : String(v).split(/[,;\s]+/);
  return [...new Set(items.map((s) => String(s).trim()).filter(Boolean).map(cleanMember))];
}

/** A free address for `alias`: alias, alias-2, alias-3... */
async function freeAddress(tq: Tq, alias: string, exceptId?: string): Promise<string> {
  const domain = mailDomain();
  for (let n = 1; n < 50; n++) {
    const email = `${n === 1 ? alias : `${alias.slice(0, 60)}-${n}`}@${domain}`;
    const [taken] = await tq(`SELECT 1 FROM groups WHERE lower(email) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`, [email, exceptId ?? null]);
    if (!taken) return email;
  }
  throw new UserError("Pick another address");
}

export async function createGroup(me: Me, input: GroupInput): Promise<string> {
  if (!mayCreate(me.email)) throw new UserError("Ask an administrator to create groups", 403);
  const kind = kindOf(input.kind);
  const name = text(input.name, 80);
  if (!name) throw new UserError("Give the group a name");
  const privacy = input.privacy === "public" ? "public" : "private";
  const memberList = members(input.members).filter((m) => m !== me.email);
  const ownerList = members(input.owners).filter((m) => !m.startsWith(GROUP_PREFIX) && m !== me.email);
  const typedAlias = String(input.alias ?? "").trim();
  for (const m of memberList) await mayNest(me, null, m);
  return tx(async (tq) => {
    let email: string | null = null;
    if (kind !== "security") {
      const alias = typedAlias ? cleanAlias(typedAlias) : aliasFrom(name);
      email = typedAlias ? `${alias}@${mailDomain()}` : await freeAddress(tq, alias);
      if (typedAlias) {
        const [taken] = await tq(`SELECT 1 FROM groups WHERE lower(email) = $1`, [email]);
        if (taken) throw new UserError(`${email} is already a group's address`, 409);
      }
    }
    const id = randomUUID();
    await tq(
      `INSERT INTO groups (id, kind, name, description, email, privacy, allow_external, created_by) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
      [id, kind, name, text(input.description, 1000), email, privacy, kind === "distribution" && input.allowExternal === true, me.email],
    );
    await tq(`INSERT INTO members (group_id, member, role, added_by) VALUES ($1::uuid, $2, 'owner', $2)`, [id, me.email]);
    for (const o of ownerList) {
      await tq(`INSERT INTO members (group_id, member, role, added_by) VALUES ($1::uuid, $2, 'owner', $3) ON CONFLICT DO NOTHING`, [id, o, me.email]);
    }
    for (const m of memberList) {
      await tq(`INSERT INTO members (group_id, member, role, added_by) VALUES ($1::uuid, $2, 'member', $3) ON CONFLICT DO NOTHING`, [id, m, me.email]);
    }
    if (kind === "team") {
      await tq(`INSERT INTO channels (group_id, key, name, topic, created_by) VALUES ($1::uuid, 'general', 'General', '', $2)`, [id, me.email]);
    }
    await audit(tq, id, me.email, "created", `${kind} ${name}`);
    return id;
  });
}

export async function updateGroup(me: Me, groupId: string, input: GroupInput): Promise<void> {
  const g = await requireOwner(me.email, groupId);
  const sets: string[] = [];
  const params: unknown[] = [groupId];
  const changed: string[] = [];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
    changed.push(col);
  };
  if (input.name !== undefined) {
    const name = text(input.name, 80);
    if (!name) throw new UserError("Give the group a name");
    set("name", name);
  }
  if (input.description !== undefined) set("description", text(input.description, 1000));
  if (input.privacy !== undefined) set("privacy", input.privacy === "public" ? "public" : "private");
  if (input.allowExternal !== undefined && g.kind === "distribution") set("allow_external", input.allowExternal === true);
  if (input.alias !== undefined && g.kind !== "security") {
    const typed = String(input.alias ?? "").trim();
    if (!typed && needsAddress(g.kind)) throw new UserError("This kind of group needs an address");
    const email = typed ? `${cleanAlias(typed)}@${mailDomain()}` : null;
    if (email && email !== g.email) {
      const [taken] = await q(`SELECT 1 FROM groups WHERE lower(email) = $1 AND id <> $2::uuid`, [email, groupId]);
      if (taken) throw new UserError(`${email} is already a group's address`, 409);
    }
    set("email", email);
  }
  if (!sets.length) return;
  await tx(async (tq) => {
    await tq(`UPDATE groups SET ${sets.join(", ")}, modified_at = now() WHERE id = $1::uuid`, params);
    await audit(tq, groupId, me.email, "changed", changed.join(", "));
  });
}

/**
 * A group may hold another group only if the person can see that group and it wouldn't make a
 * loop (a group inside itself, however deep).
 */
async function mayNest(me: Me, groupId: string | null, member: string): Promise<void> {
  if (!member.startsWith(GROUP_PREFIX)) return;
  const inner = member.slice(GROUP_PREFIX.length);
  const [g] = await q<{ privacy: string }>(`SELECT privacy FROM groups WHERE id = $1::uuid AND deleted_at IS NULL`, [inner]);
  if (!g) throw new UserError("That group isn't there");
  if (!(await standing(me.email, inner)) && g.privacy !== "public") throw new UserError("That group isn't there");
  if (!groupId) return;
  if (inner === groupId) throw new UserError("A group can't be a member of itself");
  const [loop] = await q(
    `WITH RECURSIVE d(gid) AS (
       SELECT $1::uuid
       UNION
       SELECT substr(m.member, 7)::uuid FROM members m JOIN d ON m.group_id = d.gid WHERE m.member LIKE 'group:%'
     ) SELECT 1 FROM d WHERE gid = $2::uuid`,
    [inner, groupId],
  );
  if (loop) throw new UserError("That group already includes this one");
}

export async function addMembers(me: Me, groupId: string, raw: unknown, role: Role = "member"): Promise<string[]> {
  await requireOwner(me.email, groupId);
  const list = members(raw);
  if (!list.length) throw new UserError("Add at least one person");
  if (role === "owner" && list.some((m) => m.startsWith(GROUP_PREFIX))) throw new UserError("Owners are people, not groups");
  for (const m of list) await mayNest(me, groupId, m);
  await tx(async (tq) => {
    for (const m of list) {
      await tq(
        `INSERT INTO members (group_id, member, role, added_by) VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (group_id, member) DO UPDATE SET role = CASE WHEN $3 = 'owner' THEN 'owner' ELSE members.role END`,
        [groupId, m, role, me.email],
      );
      await tq(`DELETE FROM join_requests WHERE group_id = $1::uuid AND email = $2`, [groupId, m]);
    }
    await audit(tq, groupId, me.email, role === "owner" ? "added owners" : "added members", list.join(", "));
  });
  return list;
}

async function ownerCount(tq: Tq, groupId: string): Promise<number> {
  const [c] = await tq<{ n: string }>(`SELECT COUNT(*) AS n FROM members WHERE group_id = $1::uuid AND role = 'owner'`, [groupId]);
  return Number(c.n);
}

export async function setRole(me: Me, groupId: string, member: string, role: Role): Promise<void> {
  await requireOwner(me.email, groupId);
  const m = cleanMember(member);
  if (role === "owner" && m.startsWith(GROUP_PREFIX)) throw new UserError("Owners are people, not groups");
  await tx(async (tq) => {
    const [cur] = await tq<{ role: Role }>(`SELECT role FROM members WHERE group_id = $1::uuid AND member = $2 FOR UPDATE`, [groupId, m]);
    if (!cur) throw new UserError("They aren't in this group", 404);
    if (cur.role === "owner" && role !== "owner" && (await ownerCount(tq, groupId)) <= 1) throw new UserError("A group needs at least one owner");
    await tq(`UPDATE members SET role = $3 WHERE group_id = $1::uuid AND member = $2`, [groupId, m, role]);
    await audit(tq, groupId, me.email, role === "owner" ? "made owner" : "made member", m);
  });
}

export async function removeMember(me: Me, groupId: string, member: string): Promise<void> {
  const m = cleanMember(member);
  if (m !== me.email) await requireOwner(me.email, groupId);
  else await row(groupId);
  await tx(async (tq) => {
    const [cur] = await tq<{ role: Role }>(`SELECT role FROM members WHERE group_id = $1::uuid AND member = $2 FOR UPDATE`, [groupId, m]);
    if (!cur) throw new UserError(m === me.email ? "You're in this group through another group" : "They aren't in this group", 404);
    if (cur.role === "owner" && (await ownerCount(tq, groupId)) <= 1) throw new UserError("A group needs at least one owner. Add another owner first.");
    await tq(`DELETE FROM members WHERE group_id = $1::uuid AND member = $2`, [groupId, m]);
    await audit(tq, groupId, me.email, m === me.email ? "left" : "removed", m);
  });
}

/** Joins a public group, or asks the owners of a private one. Returns whether they are in now. */
export async function join(me: Me, groupId: string, message = ""): Promise<{ joined: boolean }> {
  const g = await row(groupId);
  if (await standing(me.email, groupId).then((s) => s === "owner" || s === "member")) return { joined: true };
  if (g.privacy === "public" || isAdmin(me.email)) {
    await tx(async (tq) => {
      await tq(`INSERT INTO members (group_id, member, role, added_by) VALUES ($1::uuid, $2, 'member', $2) ON CONFLICT DO NOTHING`, [groupId, me.email]);
      await audit(tq, groupId, me.email, "joined");
    });
    return { joined: true };
  }
  await q(
    `INSERT INTO join_requests (group_id, email, message) VALUES ($1::uuid, $2, $3) ON CONFLICT (group_id, email) DO UPDATE SET message = $3`,
    [groupId, me.email, text(message, 500)],
  );
  return { joined: false };
}

export async function decideRequest(me: Me, groupId: string, email: string, approve: boolean): Promise<void> {
  await requireOwner(me.email, groupId);
  const who = cleanEmail(email);
  await tx(async (tq) => {
    const gone = await tq(`DELETE FROM join_requests WHERE group_id = $1::uuid AND email = $2 RETURNING email`, [groupId, who]);
    if (!gone.length) throw new UserError("That request isn't there any more", 404);
    if (approve) {
      await tq(`INSERT INTO members (group_id, member, role, added_by) VALUES ($1::uuid, $2, 'member', $3) ON CONFLICT DO NOTHING`, [groupId, who, me.email]);
    }
    await audit(tq, groupId, me.email, approve ? "approved request" : "declined request", who);
  });
}

/** A new channel in a team. Like Teams, members (not only owners) may add channels. */
export async function addChannel(me: Me, groupId: string, rawName: unknown, topic: unknown): Promise<Channel> {
  const { g } = await requireMember(me.email, groupId);
  if (g.kind !== "team") throw new UserError("Only teams have channels");
  const name = text(rawName, 50);
  if (!name) throw new UserError("Name the channel");
  const key = aliasFrom(name).slice(0, 40);
  return tx(async (tq) => {
    const [dup] = await tq(`SELECT 1 FROM channels WHERE group_id = $1::uuid AND (key = $2 OR lower(name) = lower($3))`, [groupId, key, name]);
    if (dup) throw new UserError("There is already a channel with that name", 409);
    const [n] = await tq<{ n: number | null }>(`SELECT max(position) AS n FROM channels WHERE group_id = $1::uuid`, [groupId]);
    await tq(
      `INSERT INTO channels (group_id, key, name, topic, position, created_by) VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [groupId, key, name, text(topic, 250), (n.n ?? 0) + 1, me.email],
    );
    await audit(tq, groupId, me.email, "added channel", name);
    return { key, name, topic: text(topic, 250) };
  });
}

export async function deleteGroup(me: Me, groupId: string): Promise<void> {
  await requireOwner(me.email, groupId);
  await tx(async (tq) => {
    await tq(`UPDATE groups SET deleted_at = now(), deleted_by = $2 WHERE id = $1::uuid`, [groupId, me.email]);
    await audit(tq, groupId, me.email, "deleted");
  });
}

export async function restoreGroup(me: Me, groupId: string): Promise<void> {
  const g = await row(groupId, true);
  if (!g.deleted_at) return;
  const [own] = await q(`SELECT 1 FROM members WHERE group_id = $1::uuid AND member = $2 AND role = 'owner'`, [groupId, me.email]);
  if (!own && !isAdmin(me.email)) throw new UserError("Not found", 404);
  if (g.deleted_at.getTime() < Date.now() - RESTORE_DAYS * 86_400_000) throw new UserError(`Groups can be restored for ${RESTORE_DAYS} days`);
  if (g.email) {
    const [taken] = await q(`SELECT 1 FROM groups WHERE lower(email) = lower($1) AND id <> $2::uuid AND deleted_at IS NULL`, [g.email, groupId]);
    if (taken) throw new UserError(`Another group now uses ${g.email}`, 409);
  }
  await tx(async (tq) => {
    await tq(`UPDATE groups SET deleted_at = NULL, deleted_by = NULL WHERE id = $1::uuid`, [groupId]);
    await audit(tq, groupId, me.email, "restored");
  });
}

/** Groups that hold `groupId`, however deep: they change when it does. */
export async function parentsOf(groupId: string): Promise<string[]> {
  const rows = await q<{ gid: string }>(
    `WITH RECURSIVE p(gid) AS (
       SELECT group_id FROM members WHERE member = 'group:' || $1
       UNION
       SELECT m.group_id FROM members m JOIN p ON m.member = 'group:' || p.gid::text
     ) SELECT gid FROM p`,
    [groupId],
  );
  return rows.map((r) => r.gid);
}

export type AuditEntry = { actor: string; action: string; detail: string; at: string };

export async function auditLog(me: Me, groupId: string): Promise<AuditEntry[]> {
  await requireOwner(me.email, groupId);
  const rows = await q<{ actor: string; action: string; detail: string; at: Date }>(
    `SELECT actor, action, detail, at FROM audit WHERE group_id = $1::uuid ORDER BY at DESC, id DESC LIMIT 200`,
    [groupId],
  );
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}
