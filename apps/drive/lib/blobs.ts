import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserError } from "./names";

/**
 * File bytes on disk, named by SHA-256: DRIVE_DIR/blobs/ab/cd/<sha>. Identical content is stored
 * once, so a copy or a restored version costs nothing. Rows in `versions` say which blobs are live.
 */
export function root(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DRIVE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data"));
}

function blobPath(sha: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("bad blob id");
  return path.join(root(), "blobs", sha.slice(0, 2), sha.slice(2, 4), sha);
}

export type Stored = { sha256: string; size: number; head: Buffer };

/**
 * Streams `body` into the store. Fails with 413 past `maxBytes` without keeping anything.
 * `head` is the first 1 MB, for text search and summaries.
 */
export async function put(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Stored> {
  const tmpDir = path.join(root(), "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, randomUUID());
  const hash = createHash("sha256");
  const headParts: Buffer[] = [];
  let headLen = 0;
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > maxBytes) return done(new UserError("This file is bigger than your remaining storage", 413));
      hash.update(chunk);
      if (headLen < HEAD_BYTES) {
        const part = chunk.subarray(0, HEAD_BYTES - headLen);
        headParts.push(part);
        headLen += part.length;
      }
      done(null, chunk);
    },
  });
  try {
    const src = body ? Readable.fromWeb(body as import("node:stream/web").ReadableStream) : Readable.from([]);
    await pipeline(src, meter, createWriteStream(tmp));
    const sha256 = hash.digest("hex");
    const dest = blobPath(sha256);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(tmp, dest);
    return { sha256, size, head: Buffer.concat(headParts) };
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

const HEAD_BYTES = 1024 * 1024;

export function read(sha: string, range?: { start: number; end: number }): Readable {
  return createReadStream(blobPath(sha), range);
}

export function readWeb(sha: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  return Readable.toWeb(read(sha, range)) as unknown as ReadableStream<Uint8Array>;
}

export async function exists(sha: string): Promise<boolean> {
  return stat(blobPath(sha)).then(() => true, () => false);
}

/**
 * Removes blobs that no version points at any more. `stillUsed` checks the database. A blob
 * written in the last few minutes is left alone: an upload of the same bytes may have stored it
 * and not yet recorded its version.
 */
export async function collect(shas: Iterable<string>, stillUsed: (sha: string) => Promise<boolean>): Promise<void> {
  for (const sha of new Set(shas)) {
    if (await stillUsed(sha)) continue;
    const st = await stat(blobPath(sha)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 10 * 60_000) await rm(blobPath(sha), { force: true });
  }
}
