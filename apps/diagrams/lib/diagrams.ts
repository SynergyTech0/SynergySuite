import { holdChecker } from "./compliance";
import { q, tx, type Tq } from "./db";
import type { Diagram, DiagramInfo, Member, Role, Version, View } from "./types";
import { UserError, cleanEmail, text } from "./util";
import { blankXml, cleanXml, summarize } from "./xml";

/** Diagrams person $1 can open: their own and those shared with them, without any deleted under a hold. */
export const MINE = `(SELECT id FROM diagrams WHERE owner = $1 AND held_deleted_at IS NULL
  UNION SELECT m.diagram_id FROM diagram_members m JOIN diagrams md ON md.id = m.diagram_id AND md.held_deleted_at IS NULL WHERE m.email = $1)`;

/** A new snapshot of the previous save is kept when the last one is older than this. */
const SNAPSHOT_MS = 10 * 60 * 1000;

export function versionsKept(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DIAGRAMS_VERSIONS);
  return Number.isInteger(n) && n > 0 ? n : 25;
}

export function cleanName(v: unknown, fallback = "Untitled diagram"): string {
  const name = text(v, 200).replace(/\.(drawio|vsdx|xml)$/i, "").trim();
  return name || fallback;
}

type Access = { role: Role; owner: string; version: number };

async function access(email: string, id: string, tq: Tq = q, lock = false): Promise<Access> {
  const [row] = await tq<{ owner: string; version: number; role: "edit" | "view" | null }>(
    `SELECT d.owner, d.version, (SELECT m.role FROM diagram_members m WHERE m.diagram_id = d.id AND m.email = $1) AS role
     FROM diagrams d WHERE d.id = $2::uuid AND d.held_deleted_at IS NULL${lock ? " FOR UPDATE OF d" : ""}`,
    [email, id],
  );
  if (!row || (row.owner !== email && !row.role)) throw new UserError("Diagram not found", 404);
  return { role: row.owner === email ? "owner" : row.role!, owner: row.owner, version: row.version };
}

function canEdit(a: Access): void {
  if (a.role === "view") throw new UserError("You can only view this diagram", 403);
}

type Row = {
  id: string; name: string; owner: string; pages: number; version: number; has_thumbnail: boolean;
  created_at: Date; modified_at: Date; modified_by: string; opened_at: Date | null; role: "edit" | "view" | null;
  members: Member[] | null;
};

const INFO = `d.id, d.name, d.owner, d.pages, d.version, d.thumbnail IS NOT NULL AS has_thumbnail,
  d.created_at, d.modified_at, d.modified_by,
  (SELECT o.opened_at FROM opened o WHERE o.email = $1 AND o.diagram_id = d.id) AS opened_at,
  (SELECT m.role FROM diagram_members m WHERE m.diagram_id = d.id AND m.email = $1) AS role,
  (SELECT json_agg(json_build_object('email', m.email, 'role', m.role) ORDER BY m.added_at) FROM diagram_members m WHERE m.diagram_id = d.id) AS members`;

function toInfo(r: Row, viewer: string): DiagramInfo {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner,
    role: r.owner === viewer ? "owner" : (r.role ?? "view"),
    pages: r.pages,
    version: r.version,
    hasThumbnail: r.has_thumbnail,
    createdAt: r.created_at.toISOString(),
    modifiedAt: r.modified_at.toISOString(),
    modifiedBy: r.modified_by,
    openedAt: r.opened_at?.toISOString() ?? null,
    members: r.members ?? [],
  };
}

/** Recent (opened or changed, newest first), the person's own, or those shared with them. */
export async function list(email: string, opts: { view?: View; query?: string } = {}): Promise<DiagramInfo[]> {
  const params: unknown[] = [email];
  const where = [`d.id IN ${MINE}`];
  if (opts.view === "mine") where.push("d.owner = $1");
  if (opts.view === "shared") where.push("d.owner <> $1");
  const query = text(opts.query, 200);
  if (query) {
    params.push(`%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(d.name ILIKE $${params.length} OR d.text_content ILIKE $${params.length})`);
  }
  const order = opts.view === "recent" || !opts.view
    ? "GREATEST(d.modified_at, COALESCE((SELECT o.opened_at FROM opened o WHERE o.email = $1 AND o.diagram_id = d.id), d.modified_at)) DESC"
    : "d.modified_at DESC";
  const rows = await q<Row>(`SELECT ${INFO} FROM diagrams d WHERE ${where.join(" AND ")} ORDER BY ${order}, d.id LIMIT 500`, params);
  return rows.map((r) => toInfo(r, email));
}

async function info(email: string, id: string, tq: Tq = q): Promise<DiagramInfo> {
  const [r] = await tq<Row>(`SELECT ${INFO} FROM diagrams d WHERE d.id = $2::uuid`, [email, id]);
  return toInfo(r, email);
}

/** One diagram with its drawing; opening it puts it at the top of the person's Recent. */
export async function get(email: string, id: string, opts: { open?: boolean } = {}): Promise<Diagram> {
  await access(email, id);
  if (opts.open) {
    await q(
      `INSERT INTO opened (email, diagram_id) VALUES ($1, $2::uuid) ON CONFLICT (email, diagram_id) DO UPDATE SET opened_at = now()`,
      [email, id],
    );
  }
  const [{ xml }] = await q<{ xml: string }>(`SELECT xml FROM diagrams WHERE id = $1::uuid`, [id]);
  return { ...(await info(email, id)), xml };
}

export async function create(email: string, input: { name?: unknown; xml?: unknown }): Promise<DiagramInfo> {
  const xml = input.xml === undefined || input.xml === null || input.xml === "" ? blankXml() : cleanXml(input.xml);
  const s = summarize(xml);
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO diagrams (owner, name, xml, text_content, pages, modified_by) VALUES ($1, $2, $3, $4, $5, $1) RETURNING id`,
    [email, cleanName(input.name), xml, s.text, s.pages],
  );
  await q(`INSERT INTO opened (email, diagram_id) VALUES ($1, $2::uuid)`, [email, id]);
  return info(email, id);
}

/** Is anyone on this diagram (its owner, the people it's shared with, its last editor) on legal hold? */
async function anyoneHeld(id: string, tq: Tq = q): Promise<boolean> {
  const [row] = await tq<{ people: string[] }>(
    `SELECT ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[d.owner, d.modified_by] ||
       ARRAY(SELECT m.email FROM diagram_members m WHERE m.diagram_id = d.id)) e) AS people
     FROM diagrams d WHERE d.id = $1::uuid`,
    [id],
  );
  if (!row) return false;
  const held = holdChecker();
  for (const p of row.people) if (await held(p)) return true;
  return false;
}

/** Drops the oldest snapshots past the limit, unless someone on the diagram is on hold. */
async function prune(id: string, tq: Tq): Promise<void> {
  if (await anyoneHeld(id, tq)) return;
  await tq(
    `DELETE FROM diagram_versions WHERE id IN (
       SELECT id FROM diagram_versions WHERE diagram_id = $1::uuid ORDER BY saved_at DESC, version DESC OFFSET $2)`,
    [id, versionsKept()],
  );
}

export type SaveResult = { version: number; modifiedAt: string; changed: boolean };

/**
 * Saves the editor's drawing. `baseVersion` is the version the editor loaded or last saved; when
 * someone else has saved since, the save is refused (409) unless `force` is set, so nobody
 * overwrites another person's work without knowing. The previous save is kept as a version when
 * the last kept one is more than ten minutes old or someone else made it.
 */
export async function save(
  email: string,
  id: string,
  input: { xml: unknown; name?: unknown; baseVersion?: unknown; force?: unknown },
  opts: { keepPrevious?: boolean } = {},
): Promise<SaveResult> {
  const xml = cleanXml(input.xml);
  const s = summarize(xml);
  return tx(async (tq) => {
    const a = await access(email, id, tq, true);
    canEdit(a);
    const [cur] = await tq<{ name: string; xml: string; version: number; modified_by: string; modified_at: Date }>(
      `SELECT name, xml, version, modified_by, modified_at FROM diagrams WHERE id = $1::uuid`,
      [id],
    );
    const base = Number(input.baseVersion);
    if (input.force !== true && Number.isInteger(base) && base !== cur.version) {
      throw new UserError(cur.modified_by === email ? "You saved a newer copy of this diagram in another window" : `${cur.modified_by} saved a newer copy of this diagram`, 409);
    }
    const name = input.name === undefined ? cur.name : cleanName(input.name, cur.name);
    if (cur.xml === xml && cur.name === name) return { version: cur.version, modifiedAt: cur.modified_at.toISOString(), changed: false };
    const [last] = await tq<{ saved_at: Date }>(
      `SELECT saved_at FROM diagram_versions WHERE diagram_id = $1::uuid ORDER BY saved_at DESC LIMIT 1`,
      [id],
    );
    if (cur.xml !== xml && (opts.keepPrevious || !last || Date.now() - last.saved_at.getTime() > SNAPSHOT_MS || cur.modified_by !== email)) {
      await tq(
        `INSERT INTO diagram_versions (diagram_id, version, name, xml, saved_by, saved_at) VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
        [id, cur.version, cur.name, cur.xml, cur.modified_by, cur.modified_at],
      );
      await prune(id, tq);
    }
    const [row] = await tq<{ version: number; modified_at: Date }>(
      `UPDATE diagrams SET xml = $2, name = $3, text_content = $4, pages = $5, version = version + 1, modified_at = now(), modified_by = $6
       WHERE id = $1::uuid RETURNING version, modified_at`,
      [id, xml, name, s.text, s.pages, email],
    );
    return { version: row.version, modifiedAt: row.modified_at.toISOString(), changed: true };
  });
}

export async function rename(email: string, id: string, name: unknown): Promise<DiagramInfo> {
  const a = await access(email, id);
  canEdit(a);
  await q(`UPDATE diagrams SET name = $2 WHERE id = $1::uuid`, [id, cleanName(name)]);
  return info(email, id);
}

/** A copy of its own, for anyone who can open the diagram (viewers included). */
export async function copy(email: string, id: string, name?: unknown): Promise<DiagramInfo> {
  const d = await get(email, id);
  return create(email, { name: name ?? `Copy of ${d.name}`, xml: d.xml });
}

/**
 * The owner deletes a diagram for everyone; anyone else only takes it out of their own lists.
 * While anyone on it is on legal hold it is hidden instead, and eDiscovery still finds it.
 */
export async function remove(email: string, id: string): Promise<void> {
  const a = await access(email, id);
  if (a.role !== "owner") {
    await q(`DELETE FROM diagram_members WHERE diagram_id = $1::uuid AND email = $2`, [id, email]);
    await q(`DELETE FROM opened WHERE diagram_id = $1::uuid AND email = $2`, [id, email]);
    return;
  }
  if (await anyoneHeld(id)) await q(`UPDATE diagrams SET held_deleted_at = now() WHERE id = $1::uuid`, [id]);
  else await q(`DELETE FROM diagrams WHERE id = $1::uuid`, [id]);
}

export async function members(email: string, id: string): Promise<{ owner: string; members: Member[] }> {
  await access(email, id);
  const d = await info(email, id);
  return { owner: d.owner, members: d.members };
}

/** The owner shares with someone (or changes what they can do). */
export async function share(email: string, id: string, target: unknown, role: unknown = "edit"): Promise<Member[]> {
  const a = await access(email, id);
  if (a.role !== "owner") throw new UserError("Only the owner can share this diagram", 403);
  const who = cleanEmail(target);
  if (who === a.owner) throw new UserError("That's the owner");
  if (role !== "edit" && role !== "view") throw new UserError("Pick edit or view");
  await q(
    `INSERT INTO diagram_members (diagram_id, email, role, added_by) VALUES ($1::uuid, $2, $3, $4)
     ON CONFLICT (diagram_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, who, role, email],
  );
  return (await members(email, id)).members;
}

export async function unshare(email: string, id: string, target: unknown): Promise<Member[]> {
  const a = await access(email, id);
  const who = String(target ?? "").trim().toLowerCase();
  if (a.role !== "owner" && who !== email) throw new UserError("Only the owner can change who has this diagram", 403);
  await q(`DELETE FROM diagram_members WHERE diagram_id = $1::uuid AND email = $2`, [id, who]);
  await q(`DELETE FROM opened WHERE diagram_id = $1::uuid AND email = $2`, [id, who]);
  return a.role === "owner" ? (await members(email, id)).members : [];
}

export async function versions(email: string, id: string): Promise<Version[]> {
  await access(email, id);
  const rows = await q<{ id: string; version: number; name: string; saved_by: string; saved_at: Date }>(
    `SELECT id, version, name, saved_by, saved_at FROM diagram_versions WHERE diagram_id = $1::uuid ORDER BY saved_at DESC, version DESC`,
    [id],
  );
  return rows.map((r) => ({ id: r.id, version: r.version, name: r.name, savedBy: r.saved_by, savedAt: r.saved_at.toISOString() }));
}

export async function versionXml(email: string, id: string, versionId: string): Promise<{ name: string; xml: string }> {
  await access(email, id);
  const [row] = await q<{ name: string; xml: string }>(
    `SELECT name, xml FROM diagram_versions WHERE id = $2::uuid AND diagram_id = $1::uuid`,
    [id, versionId],
  );
  if (!row) throw new UserError("Version not found", 404);
  return row;
}

/** Makes an earlier version the current one; what was current is kept as a version first. */
export async function restore(email: string, id: string, versionId: string): Promise<SaveResult> {
  const v = await versionXml(email, id, versionId);
  return save(email, id, { xml: v.xml, force: true }, { keepPrevious: true });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_THUMBNAIL = 1024 * 1024;

/** The picture shown in lists: a PNG the editor rendered, as a data: URL or bytes. */
export async function setThumbnail(email: string, id: string, png: unknown): Promise<void> {
  const a = await access(email, id);
  canEdit(a);
  const s = typeof png === "string" ? png : "";
  const bytes = Buffer.from(s.replace(/^data:image\/png;base64,/, ""), "base64");
  if (bytes.length > MAX_THUMBNAIL) throw new UserError("That picture is too large", 413);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG)) throw new UserError("A thumbnail must be a PNG");
  await q(`UPDATE diagrams SET thumbnail = $2 WHERE id = $1::uuid`, [id, bytes]);
}

export async function thumbnail(email: string, id: string): Promise<{ png: Buffer; version: number } | null> {
  const a = await access(email, id);
  const [row] = await q<{ thumbnail: Buffer | null }>(`SELECT thumbnail FROM diagrams WHERE id = $1::uuid`, [id]);
  return row?.thumbnail ? { png: row.thumbnail, version: a.version } : null;
}
