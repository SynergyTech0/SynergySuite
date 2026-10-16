/**
 * Where video bytes live: one folder per video under STREAM_DIR, holding the file as uploaded
 * (`source.<ext>`), the copy browsers play (`web.mp4`) and a poster frame (`poster.jpg`). Editor
 * projects sit next to them under `projects/`.
 *
 * Folder and file names come from ids made by Postgres and extensions from a fixed list, so
 * nothing a client sends decides where bytes land.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserError } from "./util";

/** Read at call time so tests (and deploys) can point it somewhere else. */
export function rootDir(): string {
  return process.env.STREAM_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "stream");
}

/** Largest upload, STREAM_MAX_UPLOAD_MB (default 10 GB). */
export function maxUpload(): number {
  const mb = Number(process.env.STREAM_MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10 * 1024) * 1024 * 1024;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(id: string): boolean {
  return UUID.test(id);
}

/** Video containers Stream takes. Anything ffmpeg reads would do; this keeps out what isn't video. */
export const VIDEO_EXTS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp", "ogv", "flv"];

/** The lower-case extension of an uploaded file's name, when it is a video type Stream takes. */
export function videoExt(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") && VIDEO_EXTS.includes(ext) ? ext : null;
}

function videoDir(id: string): string {
  if (!isId(id)) throw new UserError("Not found", 404);
  return path.join(rootDir(), "videos", id.toLowerCase());
}

export type Part = "source" | "web" | "poster";

export function filePath(id: string, part: Part, ext = "mp4"): string {
  const dir = videoDir(id);
  if (part === "source") {
    if (!VIDEO_EXTS.includes(ext)) throw new UserError("Not a video", 400);
    return path.join(dir, `source.${ext}`);
  }
  return path.join(dir, part === "web" ? "web.mp4" : "poster.jpg");
}

/** A scratch folder for one job on one video, removed by the caller. */
export async function workDir(id: string, job: string): Promise<string> {
  const dir = path.join(videoDir(id), `work-${job.replace(/[^a-z0-9-]/gi, "")}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Stops a stream that goes past `max` bytes. */
function limit(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > max) return done(new UserError(`Videos can be at most ${Math.round(max / 1024 / 1024 / 1024)} GB`, 413));
      done(null, chunk);
    },
  });
}

/**
 * Writes an upload as the video's source file, streaming (a video is too big to hold in memory).
 * Returns the size. A failed or oversized upload leaves nothing behind.
 */
export async function saveSource(id: string, ext: string, body: ReadableStream<Uint8Array> | Readable, max = maxUpload()): Promise<number> {
  const target = filePath(id, "source", ext);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.part`;
  const input = body instanceof Readable ? body : Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  try {
    await pipeline(input, limit(max), createWriteStream(tmp));
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return (await stat(target)).size;
}

export async function size(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

/** Bytes `start`..`end` (inclusive) of a file, or all of it, as a web stream. */
export function readWeb(file: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(file, range)) as unknown as ReadableStream<Uint8Array>;
}

export async function removeVideo(id: string): Promise<void> {
  await rm(videoDir(id), { recursive: true, force: true });
}

// ---- editor projects --------------------------------------------------------------------------

function projectPath(id: string): string {
  if (!isId(id)) throw new UserError("Not found", 404);
  return path.join(rootDir(), "projects", `${id.toLowerCase()}.fcproj`);
}

export async function saveProject(id: string, bytes: Uint8Array): Promise<void> {
  const file = projectPath(id);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  await pipeline(Readable.from([Buffer.from(bytes)]), createWriteStream(tmp));
  await rename(tmp, file);
}

export function projectFile(id: string): string {
  return projectPath(id);
}

export async function removeProject(id: string): Promise<void> {
  await rm(projectPath(id), { force: true });
}
