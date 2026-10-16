import { ACCESS_SQL, RANK, UUID, roleFrom, type AccessRow, type LinkAccess, type Role } from "./access.mjs";
import type { Me } from "./api";
import { policy } from "./compliance";
import { q, tx } from "./db";
import { TEMPLATE_IDS } from "./templates";
import { UserError, cleanEmail, text } from "./util";
import { encodeScene, type Scene } from "./ydoc";

export type { Role, LinkAccess };

export type Board = {
  id: string;
  title: string;
  owner: string;
  role: Role;
  linkAccess: LinkAccess;
  /** Shared with anyone besides the owner (people or a link). */
  shared: boolean;
  elementCount: number;
  hasThumbnail: boolean;
  createdAt: string;
  modifiedAt: string;
  modifiedBy: string | null;
  /** The meeting or chat it belongs to, if any. */
  source: string | null;
  /** A template is waiting to be laid out by the first editor to open the board. */
  pendingTemplate: boolean;
};

export type Member = { email: string; role: "viewer" | "editor"; addedBy: string };

type Row = {
  id: string; title: string; owner: string; link_access: LinkAccess; member_role: "viewer" | "editor" | null;
  element_count: number; has_thumb: boolean; created_at: Date; modified_at: Date; modified_by: string | null;
  source: string | null; members: number; has_template: boolean;
};

const MAX_TITLE = 120;
const MAX_THUMB = 400_000;

const COLS = `b.id, b.title, b.owner, b.link_access, b.element_count, b.thumbnail IS NOT NULL AS has_thumb,
  b.created_at, b.modified_at, b.modified_by, b.source, b.template IS NOT NULL AS has_template,
  (SELECT COUNT(*) FROM board_members x WHERE x.board_id = b.id)::int AS members`;

function toBoard(r: Row, email: string): Board {
  return {
    id: r.id,
    title: r.title,
    owner: r.owner,
    role: roleFrom(r, email) ?? "viewer",
    linkAccess: r.link_access,
    shared: r.members > 0 || r.link_access !== "none",
    elementCount: r.element_count,
    hasThumbnail: r.has_thumb,
    createdAt: r.created_at.toISOString(),
    modifiedAt: r.modified_at.toISOString(),
    modifiedBy: r.modified_by,
    source: r.source,
    pendingTemplate: r.has_template,
  };
}

function cleanTitle(v: unknown): string {
  const t = text(v, MAX_TITLE);
  if (!t) throw new UserError("Give the board a name");
  return t;
}

function cleanRole(v: unknown): "viewer" | "editor" {
  if (v === "viewer" || v === "editor") return v;
  throw new UserError("Pick Can view or Can edit");
}

/** The person's role on a board, or a 404 when they have none (so a board's existence isn't given away). */
export async function access(me: Me, id: string, need: Role): Promise<Role> {
  if (!UUID.test(id)) throw new UserError("Not found", 404);
  const [row] = await q<AccessRow>(ACCESS_SQL, [id, me.email]);
  const role = roleFrom(row, me.email);
  if (!role) throw new UserError("Not found", 404);
  if (RANK[role] < RANK[need]) {
    throw new UserError(need === "owner" ? "Only the board's owner can do that" : "You can only view this board", 403);
  }
  return role;
}

/** Boards someone owns, was added to, or opened through a link, most recently changed first. */
export async function listBoards(me: Me): Promise<Board[]> {
  const rows = await q<Row>(
    `SELECT ${COLS}, m.role AS member_role
     FROM boards b
     LEFT JOIN board_members m ON m.board_id = b.id AND m.email = $1
     WHERE b.held_deleted_at IS NULL
       AND (b.owner = $1 OR m.email IS NOT NULL
            OR (b.link_access <> 'none' AND EXISTS (SELECT 1 FROM board_visits v WHERE v.board_id = b.id AND v.email = $1)))
     ORDER BY b.modified_at DESC
     LIMIT 500`,
    [me.email],
  );
  return rows.map((r) => toBoard(r, me.email));
}

export async function createBoard(me: Me, input: { title?: unknown; template?: unknown }): Promise<Board> {
  const title = cleanTitle(input.title ?? "Untitled board");
  let template: string | null = null;
  if (input.template !== undefined && input.template !== null && input.template !== "" && input.template !== "blank") {
    if (typeof input.template !== "string" || !TEMPLATE_IDS.includes(input.template)) throw new UserError("Unknown template");
    template = input.template;
  }
  const [r] = await q<{ id: string }>(
    "INSERT INTO boards (owner, title, template, modified_by) VALUES ($1, $2, $3, $1) RETURNING id",
    [me.email, title, template],
  );
  return getBoard(me, r.id);
}

/** One board, for someone who may at least view it. Opening a board through its link keeps it in their list. */
export async function getBoard(me: Me, id: string, opts: { visit?: boolean } = {}): Promise<Board> {
  await access(me, id, "viewer");
  const [r] = await q<Row>(
    `SELECT ${COLS}, m.role AS member_role FROM boards b
     LEFT JOIN board_members m ON m.board_id = b.id AND m.email = $2
     WHERE b.id = $1`,
    [id, me.email],
  );
  if (opts.visit) {
    await q(
      `INSERT INTO board_visits (board_id, email) VALUES ($1, $2)
       ON CONFLICT (board_id, email) DO UPDATE SET visited_at = now()`,
      [id, me.email],
    );
  }
  return toBoard(r, me.email);
}

/** Rename (editors) or change who the link lets in (the owner). */
export async function updateBoard(me: Me, id: string, patch: { title?: unknown; linkAccess?: unknown }): Promise<Board> {
  if (patch.title !== undefined) {
    await access(me, id, "editor");
    await q("UPDATE boards SET title = $2 WHERE id = $1", [id, cleanTitle(patch.title)]);
  }
  if (patch.linkAccess !== undefined) {
    await access(me, id, "owner");
    if (patch.linkAccess !== "none" && patch.linkAccess !== "view" && patch.linkAccess !== "edit") throw new UserError("Bad link setting");
    await q("UPDATE boards SET link_access = $2 WHERE id = $1", [id, patch.linkAccess]);
  }
  return getBoard(me, id);
}

/** A small PNG of the board for the board list, sent by an editor's browser as a data URL. */
export async function setThumbnail(me: Me, id: string, dataUrl: unknown): Promise<void> {
  await access(me, id, "editor");
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > MAX_THUMB) {
    throw new UserError("Bad thumbnail");
  }
  await q("UPDATE boards SET thumbnail = $2 WHERE id = $1", [id, dataUrl]);
}

export async function thumbnail(me: Me, id: string): Promise<Buffer | null> {
  await access(me, id, "viewer");
  const [r] = await q<{ thumbnail: string | null }>("SELECT thumbnail FROM boards WHERE id = $1", [id]);
  if (!r?.thumbnail) return null;
  return Buffer.from(r.thumbnail.slice(r.thumbnail.indexOf(",") + 1), "base64");
}

/** Deletes a board for good, unless its owner is on legal hold: then it is only hidden. */
export async function deleteBoard(me: Me, id: string): Promise<void> {
  await access(me, id, "owner");
  const [b] = await q<{ owner: string }>("SELECT owner FROM boards WHERE id = $1", [id]);
  if (await policy().onHold(b.owner)) {
    // Its meeting or chat gets a fresh board next time.
    await q("UPDATE boards SET held_deleted_at = now(), source = NULL WHERE id = $1", [id]);
  } else {
    await q("DELETE FROM boards WHERE id = $1", [id]);
  }
}

export async function members(me: Me, id: string): Promise<Member[]> {
  await access(me, id, "viewer");
  const rows = await q<{ email: string; role: "viewer" | "editor"; added_by: string }>(
    "SELECT email, role, added_by FROM board_members WHERE board_id = $1 ORDER BY added_at, email",
    [id],
  );
  return rows.map((r) => ({ email: r.email, role: r.role, addedBy: r.added_by }));
}

/**
 * Shares a board with a person, or changes what they can do. Editors can bring people in, like in
 * Microsoft Whiteboard; only the owner can take someone's editing away or remove them.
 */
export async function share(me: Me, id: string, rawEmail: unknown, rawRole: unknown): Promise<void> {
  const mine = await access(me, id, "editor");
  const email = cleanEmail(rawEmail);
  const role = cleanRole(rawRole ?? "editor");
  const [b] = await q<{ owner: string }>("SELECT owner FROM boards WHERE id = $1", [id]);
  if (email === b.owner) throw new UserError("That's the board's owner");
  const [cur] = await q<{ role: string }>("SELECT role FROM board_members WHERE board_id = $1 AND email = $2", [id, email]);
  if (cur && mine !== "owner" && RANK[role] < RANK[cur.role as Role]) throw new UserError("Only the owner can take editing away", 403);
  await q(
    `INSERT INTO board_members (board_id, email, role, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (board_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, role, me.email],
  );
}

/** The owner removes someone; anyone can leave a board shared with them. */
export async function unshare(me: Me, id: string, rawEmail: unknown): Promise<void> {
  const email = cleanEmail(rawEmail);
  if (email !== me.email) await access(me, id, "owner");
  else await access(me, id, "viewer");
  await q("DELETE FROM board_members WHERE board_id = $1 AND email = $2", [id, email]);
  if (email === me.email) await q("DELETE FROM board_visits WHERE board_id = $1 AND email = $2", [id, email]);
}

/**
 * The template a new board was made from, handed to exactly one editor's browser to lay out
 * (two people opening a new board at once would otherwise both draw it).
 */
export async function claimTemplate(me: Me, id: string): Promise<string | null> {
  await access(me, id, "editor");
  const [r] = await q<{ template: string }>(
    `UPDATE boards b SET template = NULL FROM (SELECT template FROM boards WHERE id = $1 FOR UPDATE) old
     WHERE b.id = $1 AND old.template IS NOT NULL RETURNING old.template`,
    [id],
  );
  return r?.template ?? null;
}

/** A new board holding a scene from a file (opened from Drive or uploaded). */
export async function importBoard(me: Me, title: unknown, scene: Scene): Promise<Board> {
  const { ydoc, text: words, count } = encodeScene(scene);
  const [r] = await q<{ id: string }>(
    `INSERT INTO boards (owner, title, ydoc, text, element_count, modified_by) VALUES ($1, $2, $3, $4, $5, $1) RETURNING id`,
    [me.email, cleanTitle(title), ydoc, words, count],
  );
  return getBoard(me, r.id);
}

/**
 * The board that belongs to a meeting or chat (`source`), made the first time anyone asks for it,
 * with `owner` as its owner. Everyone in `people` can edit it from then on; nobody's access is ever
 * lowered here. Called by the Meet and Chat servers once they have checked who is in the meeting
 * or channel (see app/api/svc).
 */
export async function linkedBoard(input: { source: string; title: string; owner: string; people: string[] }): Promise<{ id: string; created: boolean }> {
  const owner = cleanEmail(input.owner);
  const people = [...new Set(input.people.map((p) => cleanEmail(p)))].slice(0, 500);
  return tx(async (tq) => {
    const [made] = await tq<{ id: string }>(
      `INSERT INTO boards (owner, title, source, modified_by) VALUES ($1, $2, $3, $1)
       ON CONFLICT (source) DO NOTHING RETURNING id`,
      [owner, cleanTitle(input.title), input.source],
    );
    const [b] = made
      ? [{ id: made.id, owner }]
      : await tq<{ id: string; owner: string }>("SELECT id, owner FROM boards WHERE source = $1 AND held_deleted_at IS NULL", [input.source]);
    if (!b) throw new UserError("That board was deleted", 410);
    const add = people.filter((p) => p !== b.owner);
    if (add.length) {
      await tq(
        `INSERT INTO board_members (board_id, email, role, added_by)
         SELECT $1, e, 'editor', $3 FROM unnest($2::text[]) e
         ON CONFLICT (board_id, email) DO UPDATE SET role = 'editor'`,
        [b.id, add, owner],
      );
    }
    return { id: b.id, created: !!made };
  });
}
