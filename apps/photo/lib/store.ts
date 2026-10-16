/**
 * Each user's images: bytes and a small JSON record per file, in a folder of their own.
 *
 * Until Drive runs on the suite's shared sign-in, Photo keeps files here. Everything that touches
 * storage goes through this module, so moving to Drive later changes this file and nothing else.
 *
 * The folder name is a hash of the user's OIDC subject and file ids are generated here, so nothing
 * a client sends decides where bytes land. A save keeps the previous bytes as one level of undo.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_FILE = 512 * 1024 * 1024; // layered PSDs get big

export type PhotoFile = {
  id: string;
  name: string;
  size: number;
  created: string;
  modified: string;
};

/** Read at call time so tests (and deploys) can point it somewhere else. */
export function rootDir(): string {
  return process.env.PHOTO_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "photos");
}

function userDir(subject: string): string {
  return path.join(rootDir(), createHash("sha256").update(subject).digest("hex").slice(0, 32));
}

const ID = /^[0-9a-f]{32}$/;

/** A label, never a path: no separators, no control characters, no leading dots, and bounded. */
export function safeName(name: string): string {
  const base = String(name).split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "").trim();
  return (cleaned || "image").slice(0, 200);
}

/** Image types the library shows as thumbnails. Everything else is served as bytes to download. */
const INLINE: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

export function inlineType(name: string): string | null {
  return INLINE[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

async function readMeta(dir: string, id: string): Promise<PhotoFile | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8")) as PhotoFile;
  } catch {
    return null;
  }
}

export async function listFiles(subject: string): Promise<PhotoFile[]> {
  const dir = userDir(subject);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter((id) => ID.test(id));
  const files = (await Promise.all(ids.map((id) => readMeta(dir, id)))).filter((f): f is PhotoFile => !!f);
  return files.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function getFile(subject: string, id: string): Promise<PhotoFile | null> {
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

export async function createFile(subject: string, name: string, bytes: Uint8Array): Promise<PhotoFile> {
  const dir = userDir(subject);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const file: PhotoFile = { id: randomUUID().replace(/-/g, ""), name: safeName(name), size: bytes.byteLength, created: now, modified: now };
  await writeFile(path.join(dir, `${file.id}.bin`), bytes);
  await writeFile(path.join(dir, `${file.id}.json`), JSON.stringify(file));
  return file;
}

/** Replaces a file's bytes, keeping the previous bytes as `<id>.prev`. Null when there is no such file. */
export async function replaceFile(subject: string, id: string, bytes: Uint8Array): Promise<PhotoFile | null> {
  const dir = userDir(subject);
  const current = await getFile(subject, id);
  if (!current) return null;
  const bin = path.join(dir, `${id}.bin`);
  const tmp = path.join(dir, `${id}.tmp`);
  await writeFile(tmp, bytes);
  await rename(bin, path.join(dir, `${id}.prev`)).catch(() => {});
  await rename(tmp, bin);
  const file = { ...current, size: bytes.byteLength, modified: new Date().toISOString() };
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(file));
  return file;
}

export async function deleteFile(subject: string, id: string): Promise<boolean> {
  if (!(await getFile(subject, id))) return false;
  const dir = userDir(subject);
  await rm(path.join(dir, `${id}.json`), { force: true });
  await rm(path.join(dir, `${id}.bin`), { force: true });
  await rm(path.join(dir, `${id}.prev`), { force: true });
  return true;
}
