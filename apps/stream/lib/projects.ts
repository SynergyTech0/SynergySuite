import { holdChecker } from "./compliance";
import { q } from "./db";
import { isId, removeProject, saveProject } from "./store";
import { UserError, text } from "./util";
import type { Me } from "./api";

/** A video editor project (.fcproj) and the library videos it was cut from. */
export type Project = { id: string; name: string; size: number; video_ids: string[]; created_at: string; modified_at: string };

type Row = Omit<Project, "created_at" | "modified_at"> & { created_at: Date; modified_at: Date };
// BIGINT arrives as a string.
const out = (r: Row): Project => ({ ...r, size: Number(r.size), created_at: r.created_at.toISOString(), modified_at: r.modified_at.toISOString() });

export const MAX_PROJECT = 64 * 1024 * 1024;

/** "Promo.fcproj" stays; anything else gets the extension. */
export function projectName(v: unknown): string {
  const base = text(String(v ?? "").split(/[\\/]/).pop(), 200).replace(/^\.+/, "");
  if (!base) return "Untitled project.fcproj";
  return /\.fcproj$/i.test(base) ? base : `${base}.fcproj`;
}

/** Only ids of videos this person can open are remembered with a project. */
async function usableVideos(me: Me, ids: unknown): Promise<string[]> {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(isId).slice(0, 500);
  if (!list.length) return [];
  const rows = await q<{ id: string }>(
    `SELECT v.id FROM videos v WHERE v.id = ANY($2::uuid[]) AND v.held_deleted_at IS NULL
       AND (v.owner = $1 OR v.visibility = 'org' OR EXISTS (SELECT 1 FROM video_members m WHERE m.video_id = v.id AND m.email = $1))`,
    [me.email, list],
  );
  const ok = new Set(rows.map((r) => r.id));
  return list.filter((id) => ok.has(id));
}

export async function listProjects(me: Me): Promise<Project[]> {
  const rows = await q<Row>(
    `SELECT id, name, size, video_ids, created_at, modified_at FROM projects WHERE owner = $1 AND held_deleted_at IS NULL ORDER BY modified_at DESC LIMIT 200`,
    [me.email],
  );
  return rows.map(out);
}

export async function getProject(me: Me, id: string): Promise<Project> {
  if (!isId(id)) throw new UserError("Not found", 404);
  const [r] = await q<Row>(
    `SELECT id, name, size, video_ids, created_at, modified_at FROM projects WHERE id = $1 AND owner = $2 AND held_deleted_at IS NULL`,
    [id, me.email],
  );
  if (!r) throw new UserError("Not found", 404);
  return out(r);
}

function checkBytes(bytes: Uint8Array): void {
  if (!bytes.byteLength) throw new UserError("The project was empty");
  if (bytes.byteLength > MAX_PROJECT) throw new UserError("That project is too big", 413);
}

export async function createProject(me: Me, name: unknown, bytes: Uint8Array, videoIds: unknown): Promise<Project> {
  checkBytes(bytes);
  const videos = await usableVideos(me, videoIds);
  const [r] = await q<Row>(
    `INSERT INTO projects (owner, name, size, video_ids) VALUES ($1, $2, $3, $4) RETURNING id, name, size, video_ids, created_at, modified_at`,
    [me.email, projectName(name), bytes.byteLength, videos],
  );
  try {
    await saveProject(r.id, bytes);
  } catch (e) {
    await q(`DELETE FROM projects WHERE id = $1`, [r.id]);
    throw e;
  }
  return out(r);
}

export async function replaceProject(me: Me, id: string, bytes: Uint8Array, videoIds: unknown): Promise<Project> {
  checkBytes(bytes);
  await getProject(me, id);
  const videos = await usableVideos(me, videoIds);
  await saveProject(id, bytes);
  const [r] = await q<Row>(
    `UPDATE projects SET size = $2, video_ids = $3, modified_at = now() WHERE id = $1 RETURNING id, name, size, video_ids, created_at, modified_at`,
    [id, bytes.byteLength, videos],
  );
  return out(r);
}

export async function deleteProject(me: Me, id: string): Promise<void> {
  await getProject(me, id);
  if (await holdChecker()(me.email)) {
    await q(`UPDATE projects SET held_deleted_at = now() WHERE id = $1`, [id]);
    return;
  }
  await q(`DELETE FROM projects WHERE id = $1`, [id]);
  await removeProject(id);
}
