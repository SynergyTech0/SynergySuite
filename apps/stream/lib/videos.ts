import { randomBytes } from "node:crypto";
import { type Chapter, MAX_CAPTIONS, cleanChapters, normalizeCaptions, parseCues, transcriptText } from "./captions";
import { holdChecker } from "./compliance";
import { q } from "./db";
import { startProcessing } from "./media";
import { isId, removeVideo, saveSource, videoExt } from "./store";
import { UserError, cleanEmail, text } from "./util";
import type { Me } from "./api";

export type Visibility = "private" | "org";

/** A video as the library lists it. */
export type VideoCard = {
  id: string;
  title: string;
  owner: string;
  status: "processing" | "ready" | "failed";
  progress: number;
  error: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  visibility: Visibility;
  shared: boolean;
  views: number;
  created_at: string;
};

/** A video as its watch page shows it. */
export type VideoDetail = VideoCard & {
  description: string;
  source_name: string;
  size: number;
  origin: "upload" | "recording" | "editor";
  allow_comments: boolean;
  chapters: Chapter[];
  has_captions: boolean;
  captions_source: "upload" | "ai" | null;
  captions_status: "none" | "working" | "ready" | "failed";
  captions_error: string | null;
  summary: string;
  share_token: string | null;
  members: string[];
  can_edit: boolean;
  modified_at: string;
};

export type Comment = { id: string; author: string; body: string; at_seconds: number | null; created_at: string; mine: boolean };

/**
 * The videos a person may watch inside the app: their own, ones shared with them, and ones open to
 * the whole organization. Link viewers go through the share-link routes instead. $1 is the email.
 */
export const CAN_VIEW = `(v.owner = $1 OR v.visibility = 'org' OR EXISTS (SELECT 1 FROM video_members m WHERE m.video_id = v.id AND m.email = $1))`;

const VIEWS = `((SELECT count(*) FROM video_views w WHERE w.video_id = v.id) + v.anon_views)::int`;

const CARD = `v.id, v.title, v.owner, v.status, v.progress, v.error, v.duration, v.width, v.height, v.visibility,
  (v.share_token IS NOT NULL OR EXISTS (SELECT 1 FROM video_members m WHERE m.video_id = v.id)) AS shared,
  ${VIEWS} AS views, v.created_at`;

type CardRow = Omit<VideoCard, "created_at"> & { created_at: Date };
const card = (r: CardRow): VideoCard => ({ ...r, created_at: r.created_at.toISOString() });

export type Shelf = "mine" | "shared" | "org";

/** One shelf of the library, newest first, optionally narrowed by words in the title or description. */
export async function listVideos(me: Me, shelf: Shelf, filter = ""): Promise<VideoCard[]> {
  const where =
    shelf === "mine"
      ? `v.owner = $1`
      : shelf === "shared"
        ? `v.owner <> $1 AND EXISTS (SELECT 1 FROM video_members m WHERE m.video_id = v.id AND m.email = $1)`
        : `v.visibility = 'org' AND (v.status = 'ready' OR v.owner = $1)`;
  const params: unknown[] = [me.email];
  let words = "";
  for (const w of filter.trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    params.push(`%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    words += ` AND (v.title ILIKE $${params.length} OR v.description ILIKE $${params.length} OR v.transcript ILIKE $${params.length})`;
  }
  const rows = await q<CardRow>(
    `SELECT ${CARD} FROM videos v WHERE ${where} AND v.held_deleted_at IS NULL${words} ORDER BY v.created_at DESC LIMIT 500`,
    params,
  );
  return rows.map(card);
}

type DetailRow = CardRow & Omit<VideoDetail, keyof VideoCard | "has_captions" | "members" | "can_edit" | "modified_at"> & {
  captions: string | null; modified_at: Date;
};

async function detailRow(id: string): Promise<(DetailRow & { members: string[] }) | null> {
  if (!isId(id)) return null;
  const rows = await q<DetailRow & { members: string[] }>(
    `SELECT ${CARD}, v.description, v.source_name, v.size, v.origin, v.allow_comments, v.chapters, v.captions,
       v.captions_source, v.captions_status, v.captions_error, v.summary, v.share_token, v.modified_at,
       ARRAY(SELECT m.email FROM video_members m WHERE m.video_id = v.id ORDER BY m.added_at) AS members
     FROM videos v WHERE v.id = $1 AND v.held_deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

function canView(me: Me, r: { owner: string; visibility: string; members: string[] }): boolean {
  return r.owner === me.email || r.visibility === "org" || r.members.includes(me.email);
}

function detail(me: Me | null, r: DetailRow & { members: string[] }): VideoDetail {
  const owner = !!me && r.owner === me.email;
  const { captions, ...rest } = r;
  return {
    ...card(r),
    ...rest,
    size: Number(r.size), // BIGINT arrives as a string
    created_at: r.created_at.toISOString(),
    modified_at: r.modified_at.toISOString(),
    has_captions: !!captions,
    // Only the owner sees who else it is shared with and its link.
    members: owner ? r.members : [],
    share_token: owner ? r.share_token : null,
    can_edit: owner,
  };
}

/** A video for someone allowed to watch it in the app; 404 otherwise (whether or not it exists). */
export async function getVideo(me: Me, id: string): Promise<VideoDetail> {
  const r = await detailRow(id);
  if (!r || !canView(me, r)) throw new UserError("Not found", 404);
  return detail(me, r);
}

/** The owner's own video, for changes; 404 for anyone else. */
async function owned(me: Me, id: string): Promise<DetailRow & { members: string[] }> {
  const r = await detailRow(id);
  if (!r || r.owner !== me.email) throw new UserError("Not found", 404);
  return r;
}

/** The facts the media routes need, for someone allowed to watch. */
export async function mediaFor(me: Me, id: string): Promise<{ id: string; source_ext: string; source_name: string; status: string; captions: string | null; title: string }> {
  if (!isId(id)) throw new UserError("Not found", 404);
  const rows = await q<{ id: string; source_ext: string; source_name: string; status: string; captions: string | null; title: string; owner: string; visibility: string; members: string[] }>(
    `SELECT v.id, v.source_ext, v.source_name, v.status, v.captions, v.title, v.owner, v.visibility,
       ARRAY(SELECT m.email FROM video_members m WHERE m.video_id = v.id) AS members
     FROM videos v WHERE v.id = $1 AND v.held_deleted_at IS NULL`,
    [id],
  );
  const r = rows[0];
  if (!r || !canView(me, r)) throw new UserError("Not found", 404);
  return r;
}

/** "Quarterly update.mp4" → "Quarterly update" */
export function titleFrom(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return text(base.replace(/\.[^.]+$/, "").replace(/[_]+/g, " "), 200) || "Untitled video";
}

/** Adds an uploaded (or recorded, or edited) video and starts making it watchable. */
export async function createVideo(
  me: Me,
  name: string,
  body: ReadableStream<Uint8Array> | null,
  origin: "upload" | "recording" | "editor" = "upload",
): Promise<VideoCard> {
  const cleanName = text(name.split(/[\\/]/).pop(), 200);
  const ext = videoExt(cleanName);
  if (!ext) throw new UserError("That isn't a video file Stream can take (try MP4, MOV, WebM or MKV)", 415);
  if (!body) throw new UserError("The upload was empty");
  const [row] = await q<{ id: string }>(
    `INSERT INTO videos (owner, title, source_name, source_ext, origin) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [me.email, titleFrom(cleanName), cleanName, ext, origin],
  );
  try {
    const size = await saveSource(row.id, ext, body);
    if (!size) throw new UserError("The upload was empty");
    await q(`UPDATE videos SET size = $2 WHERE id = $1`, [row.id, size]);
  } catch (e) {
    await q(`DELETE FROM videos WHERE id = $1`, [row.id]);
    await removeVideo(row.id).catch(() => {});
    throw e;
  }
  startProcessing(row.id, ext);
  const [r] = await q<CardRow>(`SELECT ${CARD} FROM videos v WHERE v.id = $1`, [row.id]);
  return card(r);
}

export type VideoChanges = {
  title?: unknown;
  description?: unknown;
  visibility?: unknown;
  allow_comments?: unknown;
  chapters?: unknown;
  summary?: unknown;
};

export async function updateVideo(me: Me, id: string, c: VideoChanges): Promise<VideoDetail> {
  const r = await owned(me, id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (c.title !== undefined) {
    const t = text(c.title, 200);
    if (!t) throw new UserError("Give the video a title");
    set("title", t);
  }
  if (c.description !== undefined) set("description", text(c.description, 5000));
  if (c.summary !== undefined) set("summary", text(c.summary, 5000));
  if (c.visibility !== undefined) {
    if (c.visibility !== "private" && c.visibility !== "org") throw new UserError("Pick who can watch it");
    set("visibility", c.visibility);
  }
  if (c.allow_comments !== undefined) set("allow_comments", c.allow_comments === true);
  if (c.chapters !== undefined) set("chapters", JSON.stringify(cleanChapters(c.chapters, r.duration)));
  if (sets.length) await q(`UPDATE videos SET ${sets.join(", ")}, modified_at = now() WHERE id = $1`, params);
  return getVideo(me, id);
}

/**
 * Deletes a video for good, or, while its owner is on legal hold, only hides it (files kept, still
 * found by eDiscovery).
 */
export async function deleteVideo(me: Me, id: string): Promise<void> {
  await owned(me, id);
  if (await holdChecker()(me.email)) {
    await q(`UPDATE videos SET held_deleted_at = now() WHERE id = $1`, [id]);
    return;
  }
  await q(`DELETE FROM videos WHERE id = $1`, [id]);
  await removeVideo(id);
}

// ---- sharing ----------------------------------------------------------------------------------

export async function addMember(me: Me, id: string, email: unknown): Promise<VideoDetail> {
  await owned(me, id);
  const e = cleanEmail(email);
  if (e === me.email) throw new UserError("You already own this video");
  await q(`INSERT INTO video_members (video_id, email, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, e, me.email]);
  return getVideo(me, id);
}

export async function removeMember(me: Me, id: string, email: unknown): Promise<VideoDetail> {
  await owned(me, id);
  await q(`DELETE FROM video_members WHERE video_id = $1 AND email = $2`, [id, String(email ?? "").trim().toLowerCase()]);
  return getVideo(me, id);
}

/** Turns the "anyone with the link" link on (a new one each time, so an old link stops working) or off. */
export async function setLink(me: Me, id: string, on: boolean): Promise<VideoDetail> {
  await owned(me, id);
  await q(`UPDATE videos SET share_token = $2 WHERE id = $1`, [id, on ? randomBytes(18).toString("base64url") : null]);
  return getVideo(me, id);
}

// ---- captions ---------------------------------------------------------------------------------

/** Puts in captions from a WebVTT or SubRip file; they also become the searchable transcript. */
export async function setCaptions(me: Me, id: string, raw: string, source: "upload" | "ai" = "upload"): Promise<VideoDetail> {
  await owned(me, id);
  if (raw.length > MAX_CAPTIONS) throw new UserError("That captions file is too big");
  const vtt = normalizeCaptions(raw);
  if (!vtt) throw new UserError("That file has no captions in it (Stream takes WebVTT .vtt and SubRip .srt)");
  await saveCaptions(id, vtt, source);
  return getVideo(me, id);
}

export async function saveCaptions(id: string, vtt: string, source: "upload" | "ai"): Promise<void> {
  await q(
    `UPDATE videos SET captions = $2, captions_source = $3, captions_status = 'ready', captions_error = NULL, transcript = $4, modified_at = now() WHERE id = $1`,
    [id, vtt, source, transcriptText(parseCues(vtt))],
  );
}

export async function clearCaptions(me: Me, id: string): Promise<VideoDetail> {
  await owned(me, id);
  await q(`UPDATE videos SET captions = NULL, captions_source = NULL, captions_status = 'none', captions_error = NULL, transcript = '' WHERE id = $1`, [id]);
  return getVideo(me, id);
}

// ---- views and comments -----------------------------------------------------------------------

export async function recordView(me: Me, id: string): Promise<void> {
  await mediaFor(me, id);
  await q(`INSERT INTO video_views (video_id, viewer) VALUES ($1, $2) ON CONFLICT (video_id, viewer) DO UPDATE SET viewed_at = now()`, [id, me.email]);
}

type CommentRow = { id: string; author: string; body: string; at_seconds: number | null; created_at: Date };

export async function listComments(me: Me, id: string): Promise<Comment[]> {
  await mediaFor(me, id);
  const rows = await q<CommentRow>(
    `SELECT id, author, body, at_seconds, created_at FROM comments WHERE video_id = $1 AND held_deleted_at IS NULL ORDER BY created_at`,
    [id],
  );
  return rows.map((r) => ({ ...r, created_at: r.created_at.toISOString(), mine: r.author === me.email }));
}

export async function addComment(me: Me, id: string, body: unknown, at: unknown): Promise<Comment> {
  const v = await getVideo(me, id);
  if (!v.allow_comments) throw new UserError("Comments are turned off for this video", 403);
  const b = text(body, 2000);
  if (!b) throw new UserError("Write a comment first");
  const t = at === null || at === undefined || at === "" ? null : Number(at);
  const seconds = t !== null && Number.isFinite(t) && t >= 0 && (!v.duration || t <= v.duration) ? t : null;
  const [r] = await q<CommentRow>(
    `INSERT INTO comments (video_id, author, body, at_seconds) VALUES ($1, $2, $3, $4) RETURNING id, author, body, at_seconds, created_at`,
    [id, me.email, b, seconds],
  );
  return { ...r, created_at: r.created_at.toISOString(), mine: true };
}

/** The comment's author or the video's owner removes a comment; kept hidden while its author is on hold. */
export async function deleteComment(me: Me, id: string, commentId: string): Promise<void> {
  if (!isId(commentId)) throw new UserError("Not found", 404);
  const v = await getVideo(me, id);
  const [c] = await q<{ author: string }>(`SELECT author FROM comments WHERE id = $1 AND video_id = $2 AND held_deleted_at IS NULL`, [commentId, id]);
  if (!c || (c.author !== me.email && !v.can_edit)) throw new UserError("Not found", 404);
  if (await holdChecker()(c.author)) await q(`UPDATE comments SET held_deleted_at = now() WHERE id = $1`, [commentId]);
  else await q(`DELETE FROM comments WHERE id = $1`, [commentId]);
}

// ---- share links ------------------------------------------------------------------------------

/** What someone with the link sees: no sharing details, no comments. */
export type SharedVideo = {
  id: string; title: string; description: string; owner: string; duration: number | null; width: number | null; height: number | null;
  status: string; chapters: Chapter[]; has_captions: boolean; summary: string; created_at: string;
};

export async function sharedByToken(token: string): Promise<SharedVideo & { source_ext: string; captions: string | null }> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new UserError("This link doesn't work any more", 404);
  const rows = await q<SharedVideo & { source_ext: string; captions: string | null; created_at: Date }>(
    `SELECT id, title, description, owner, duration, width, height, status, chapters, captions IS NOT NULL AS has_captions, summary,
       created_at, source_ext, captions
     FROM videos WHERE share_token = $1 AND held_deleted_at IS NULL`,
    [token],
  );
  const r = rows[0];
  if (!r) throw new UserError("This link doesn't work any more", 404);
  return { ...r, created_at: r.created_at.toISOString() };
}

export async function recordLinkView(id: string): Promise<void> {
  await q(`UPDATE videos SET anon_views = anon_views + 1 WHERE id = $1`, [id]);
}
