/**
 * Each user's drawings: bytes and a small JSON record per file, in a folder of their own.
 *
 * Until Drive runs on the suite's shared sign-in, CAD keeps files here. Everything that touches
 * storage goes through this module, so moving to Drive later changes this file and nothing else.
 *
 * The folder name is a hash of the user's OIDC subject and file ids are generated here, so nothing
 * a client sends decides where bytes land. Each save keeps the bytes it replaces as a version in
 * `<id>.versions/` (the last MAX_VERSIONS of them), which can be downloaded or restored.
 *
 * Sharing a file makes a record under `shares/<token>.json` with the review comments on it. The
 * token is random and also stored on the file's record, so stopping sharing (or deleting the file)
 * kills the link even if the share record were left behind.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_AUTHOR, MAX_COMMENT, MAX_COMMENTS } from "./share";

export const MAX_FILE = 512 * 1024 * 1024; // CADCraft opens DWG files up to 512 MB

export type Drawing = {
  id: string;
  name: string;
  size: number;
  created: string;
  modified: string;
  /** The share link's token while the file is shared. */
  shared?: string;
  /** The folder it's in ("Projects/Site A"); missing or "" for the top of the library. */
  folder?: string;
  /** When its library picture (`<id>.png`) was last made. */
  thumb?: string;
};

export const MAX_THUMB = 512 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An earlier state of a file: `n` counts up from 1, `saved` is when those bytes were saved. */
export type Version = { n: number; size: number; saved: string };

/** How many earlier versions each file keeps (CAD_VERSIONS, default 50). */
export function maxVersions(): number {
  const n = Number(process.env.CAD_VERSIONS);
  return Number.isInteger(n) && n > 0 ? n : 50;
}

export type Comment = { id: string; author: string; guest: boolean; text: string; at: string };

export type Share = {
  token: string;
  /** The owner's folder (a hash of their subject), so the link finds the file without naming the owner. */
  owner: string;
  fileId: string;
  created: string;
  comments: Comment[];
};

/** Read at call time so tests (and deploys) can point it somewhere else. */
export function rootDir(): string {
  return process.env.CAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "drawings");
}

function ownerKey(subject: string): string {
  return createHash("sha256").update(subject).digest("hex").slice(0, 32);
}

function userDir(subject: string): string {
  return path.join(rootDir(), ownerKey(subject));
}

const ID = /^[0-9a-f]{32}$/;
const newId = () => randomUUID().replace(/-/g, "");

/** A label, never a path: no separators, no control characters, no leading dots, and bounded. */
export function safeName(name: string): string {
  const base = String(name).split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "").trim();
  return (cleaned || "drawing").slice(0, 200);
}

/** Plain image types (exports) served inline. Everything else is served as bytes to download. */
const INLINE: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

export function inlineType(name: string): string | null {
  return INLINE[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

async function readMeta(dir: string, id: string): Promise<Drawing | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8")) as Drawing;
  } catch {
    return null;
  }
}

export async function listFiles(subject: string): Promise<Drawing[]> {
  const dir = userDir(subject);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter((id) => ID.test(id));
  const files = (await Promise.all(ids.map((id) => readMeta(dir, id)))).filter((f): f is Drawing => !!f);
  return files.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function getFile(subject: string, id: string): Promise<Drawing | null> {
  return ID.test(id) ? readMeta(userDir(subject), id) : null;
}

export async function readBytes(subject: string, id: string): Promise<Buffer | null> {
  if (!ID.test(id)) return null;
  try {
    return await readFile(path.join(userDir(subject), `${id}.bin`));
  } catch {
    return null;
  }
}

export async function createFile(subject: string, name: string, bytes: Uint8Array): Promise<Drawing> {
  return (await createFileIn(subject, "", name, bytes))!;
}

/** Adds a file to a folder. `folder` must be one of the user's folders, or "" for the top; null when it isn't. */
export async function createFileIn(subject: string, folder: string, name: string, bytes: Uint8Array): Promise<Drawing | null> {
  const dir = userDir(subject);
  const where = folderPath(folder);
  if (where === null || (where && !(await listFolders(subject)).includes(where))) return null;
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const file: Drawing = { id: newId(), name: safeName(name), size: bytes.byteLength, created: now, modified: now, ...(where ? { folder: where } : {}) };
  await writeFile(path.join(dir, `${file.id}.bin`), bytes);
  await writeFile(path.join(dir, `${file.id}.json`), JSON.stringify(file));
  return file;
}

function versionsDir(subject: string, id: string): string {
  return path.join(userDir(subject), `${id}.versions`);
}

async function readVersions(subject: string, id: string): Promise<Version[]> {
  try {
    return JSON.parse(await readFile(path.join(versionsDir(subject, id), "index.json"), "utf8")) as Version[];
  } catch {
    return [];
  }
}

/** Files saved before version history kept one `<id>.prev`; it becomes their first version. */
async function adoptPrev(subject: string, id: string, versions: Version[]): Promise<Version[]> {
  const prev = path.join(userDir(subject), `${id}.prev`);
  const info = await stat(prev).catch(() => null);
  if (!info) return versions;
  const dir = versionsDir(subject, id);
  await mkdir(dir, { recursive: true });
  const n = (versions.at(-1)?.n ?? 0) + 1;
  await rename(prev, path.join(dir, `${n}.bin`));
  const next = [...versions, { n, size: info.size, saved: info.mtime.toISOString() }];
  await writeJson(path.join(dir, "index.json"), next);
  return next;
}

/** A file's earlier versions, newest first. Null when there is no such file. */
export async function listVersions(subject: string, id: string): Promise<Version[] | null> {
  return serial(`file:${ownerKey(subject)}:${id}`, async () => {
    if (!(await getFile(subject, id))) return null;
    return (await adoptPrev(subject, id, await readVersions(subject, id))).slice().reverse();
  });
}

export async function readVersion(subject: string, id: string, n: number): Promise<Buffer | null> {
  if (!(await getFile(subject, id)) || !Number.isInteger(n) || n < 1) return null;
  try {
    return await readFile(path.join(versionsDir(subject, id), `${n}.bin`));
  } catch {
    return null;
  }
}

/**
 * Replaces a file's bytes. The bytes it replaces become its newest version, and versions past
 * maxVersions() are dropped, oldest first. Null when there is no such file.
 */
export function replaceFile(subject: string, id: string, bytes: Uint8Array): Promise<Drawing | null> {
  return serial(`file:${ownerKey(subject)}:${id}`, async () => {
    const dir = userDir(subject);
    const current = await getFile(subject, id);
    if (!current) return null;
    const bin = path.join(dir, `${id}.bin`);
    const tmp = path.join(dir, `${id}.tmp`);
    await writeFile(tmp, bytes);
    let versions = await adoptPrev(subject, id, await readVersions(subject, id));
    const vdir = versionsDir(subject, id);
    await mkdir(vdir, { recursive: true });
    const n = (versions.at(-1)?.n ?? 0) + 1;
    if (await rename(bin, path.join(vdir, `${n}.bin`)).then(() => true, () => false)) {
      versions = [...versions, { n, size: current.size, saved: current.modified }];
    }
    const drop = versions.slice(0, Math.max(0, versions.length - maxVersions()));
    versions = versions.slice(drop.length);
    await writeJson(path.join(vdir, "index.json"), versions);
    await Promise.all(drop.map((v) => rm(path.join(vdir, `${v.n}.bin`), { force: true })));
    await rename(tmp, bin);
    const file = { ...current, size: bytes.byteLength, modified: new Date().toISOString() };
    await writeJson(path.join(dir, `${id}.json`), file);
    return file;
  });
}

/** Puts version `n` back as the file's current bytes. What it replaces becomes a version too, so nothing is lost. */
export async function restoreVersion(subject: string, id: string, n: number): Promise<Drawing | null> {
  const bytes = await readVersion(subject, id, n);
  return bytes ? replaceFile(subject, id, bytes) : null;
}

export async function deleteFile(subject: string, id: string): Promise<boolean> {
  const file = await getFile(subject, id);
  if (!file) return false;
  const dir = userDir(subject);
  if (file.shared) await rm(sharePath(file.shared), { force: true });
  await rm(path.join(dir, `${id}.json`), { force: true });
  await rm(path.join(dir, `${id}.bin`), { force: true });
  await rm(path.join(dir, `${id}.prev`), { force: true });
  await rm(path.join(dir, `${id}.png`), { force: true });
  await rm(versionsDir(subject, id), { recursive: true, force: true });
  return true;
}

function sharePath(token: string): string {
  return path.join(rootDir(), "shares", `${token}.json`);
}

async function readShare(token: string): Promise<Share | null> {
  if (!ID.test(token)) return null;
  try {
    return JSON.parse(await readFile(sharePath(token), "utf8")) as Share;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${newId()}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

/** Changes to one share record run one at a time, so two comments posted together both land. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, run);
  void run.finally(() => queues.get(key) === run && queues.delete(key)).catch(() => {});
  return run;
}

/** The file's share, for its owner. Null when the file isn't shared. */
export async function getShare(subject: string, id: string): Promise<Share | null> {
  const file = await getFile(subject, id);
  return file?.shared ? readShare(file.shared) : null;
}

/** Shares the file (or returns its existing share). Null when there is no such file. */
export function shareFile(subject: string, id: string): Promise<Share | null> {
  return serial(`file:${ownerKey(subject)}:${id}`, async () => {
    const file = await getFile(subject, id);
    if (!file) return null;
    const existing = file.shared ? await readShare(file.shared) : null;
    if (existing) return existing;
    const share: Share = { token: newId(), owner: ownerKey(subject), fileId: id, created: new Date().toISOString(), comments: [] };
    await mkdir(path.dirname(sharePath(share.token)), { recursive: true });
    await writeJson(sharePath(share.token), share);
    await writeJson(path.join(userDir(subject), `${id}.json`), { ...file, shared: share.token });
    return share;
  });
}

/** Stops sharing: the link stops working and its comments are dropped. False when there is no such file. */
export function unshareFile(subject: string, id: string): Promise<boolean> {
  return serial(`file:${ownerKey(subject)}:${id}`, async () => {
    const file = await getFile(subject, id);
    if (!file) return false;
    if (file.shared) {
      const { shared, ...rest } = file;
      await writeJson(path.join(userDir(subject), `${id}.json`), rest);
      await rm(sharePath(shared), { force: true });
    }
    return true;
  });
}

/** A share link's file and comments, for anyone holding the link. Null when the link is dead. */
export async function openShare(token: string): Promise<{ share: Share; file: Drawing } | null> {
  const share = await readShare(token);
  if (!share || !ID.test(share.owner) || !ID.test(share.fileId)) return null;
  const file = await readMeta(path.join(rootDir(), share.owner), share.fileId);
  return file && file.shared === token ? { share, file } : null;
}

export async function readSharedBytes(token: string): Promise<{ file: Drawing; bytes: Buffer } | null> {
  const open = await openShare(token);
  if (!open) return null;
  try {
    return { file: open.file, bytes: await readFile(path.join(rootDir(), open.share.owner, `${open.file.id}.bin`)) };
  } catch {
    return null;
  }
}

export function isOwner(share: Share, subject: string): boolean {
  return share.owner === ownerKey(subject);
}

/** Adds a review comment. "full" when the share already holds MAX_COMMENTS; null when the link is dead. */
export function addComment(token: string, author: string, guest: boolean, text: string): Promise<Comment | "full" | null> {
  return serial(`share:${token}`, async () => {
    if (!(await openShare(token))) return null;
    const share = (await readShare(token))!;
    if (share.comments.length >= MAX_COMMENTS) return "full";
    const comment: Comment = {
      id: newId(),
      author: author.slice(0, MAX_AUTHOR),
      guest,
      text: text.slice(0, MAX_COMMENT),
      at: new Date().toISOString(),
    };
    await writeJson(sharePath(token), { ...share, comments: [...share.comments, comment] });
    return comment;
  });
}

/** The owner removes a comment. False when the link is dead, the caller isn't the owner, or there's no such comment. */
export function removeComment(token: string, subject: string, commentId: string): Promise<boolean> {
  return serial(`share:${token}`, async () => {
    const open = await openShare(token);
    if (!open || !isOwner(open.share, subject)) return false;
    const comments = open.share.comments.filter((c) => c.id !== commentId);
    if (comments.length === open.share.comments.length) return false;
    await writeJson(sharePath(token), { ...open.share, comments });
    return true;
  });
}

/**
 * A folder path as stored: segments joined by "/", each a safe label of up to 100 characters,
 * at most 8 deep. "" is the top of the library. Null when the path can't be a folder.
 */
export function folderPath(input: string): string | null {
  const parts = String(input).split("/").map((p) => p.replace(/[\u0000-\u001f\u007f\\]/g, "").trim()).filter(Boolean);
  if (parts.length > 8 || parts.some((p) => p.length > 100 || p === "." || p === "..")) return null;
  return parts.join("/");
}

function foldersFile(subject: string): string {
  return path.join(userDir(subject), "folders.json");
}

/** Every folder the user has, parents included, sorted. */
export async function listFolders(subject: string): Promise<string[]> {
  try {
    const list = JSON.parse(await readFile(foldersFile(subject), "utf8")) as string[];
    return Array.isArray(list) ? list.filter((f) => typeof f === "string") : [];
  } catch {
    return [];
  }
}

/** Makes a folder and any missing parents. Returns its stored path, or null for a name that can't be one. */
export function createFolder(subject: string, input: string): Promise<string | null> {
  return serial(`folders:${ownerKey(subject)}`, async () => {
    const where = folderPath(input);
    if (!where) return null;
    const have = new Set(await listFolders(subject));
    const parts = where.split("/");
    parts.forEach((_, i) => have.add(parts.slice(0, i + 1).join("/")));
    if (have.size > 1000) return null;
    await mkdir(userDir(subject), { recursive: true });
    await writeJson(foldersFile(subject), [...have].sort((a, b) => a.localeCompare(b)));
    return where;
  });
}

/** Removes an empty folder. "not-empty" when files or folders are still in it; false when there's no such folder. */
export function deleteFolder(subject: string, input: string): Promise<boolean | "not-empty"> {
  return serial(`folders:${ownerKey(subject)}`, async () => {
    const where = folderPath(input);
    const have = await listFolders(subject);
    if (!where || !have.includes(where)) return false;
    if (have.some((f) => f.startsWith(`${where}/`)) || (await listFiles(subject)).some((f) => f.folder === where)) return "not-empty";
    await writeJson(foldersFile(subject), have.filter((f) => f !== where));
    return true;
  });
}

/** Moves a file into a folder ("" for the top). Null when there's no such file or folder. */
export function moveFile(subject: string, id: string, folder: string): Promise<Drawing | null> {
  return serial(`file:${ownerKey(subject)}:${id}`, async () => {
    const where = folderPath(folder);
    const file = await getFile(subject, id);
    if (!file || where === null || (where && !(await listFolders(subject)).includes(where))) return null;
    const { folder: _old, ...rest } = file;
    const moved: Drawing = where ? { ...rest, folder: where } : rest;
    await writeJson(path.join(userDir(subject), `${id}.json`), moved);
    return moved;
  });
}

/** Stores the file's library picture, a PNG made in the browser. Null when there's no such file or it isn't a PNG. */
export function setThumb(subject: string, id: string, png: Uint8Array): Promise<Drawing | null> {
  return serial(`file:${ownerKey(subject)}:${id}`, async () => {
    const file = await getFile(subject, id);
    if (!file || png.byteLength > MAX_THUMB || !PNG.every((b, i) => png[i] === b)) return null;
    const dir = userDir(subject);
    const tmp = path.join(dir, `${id}.png.tmp`);
    await writeFile(tmp, png);
    await rename(tmp, path.join(dir, `${id}.png`));
    const next = { ...file, thumb: new Date().toISOString() };
    await writeJson(path.join(dir, `${id}.json`), next);
    return next;
  });
}

export async function readThumb(subject: string, id: string): Promise<Buffer | null> {
  if (!(await getFile(subject, id))) return null;
  try {
    return await readFile(path.join(userDir(subject), `${id}.png`));
  } catch {
    return null;
  }
}
