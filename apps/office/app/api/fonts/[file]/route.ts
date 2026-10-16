// Fonts for PDFs (see lib/pdf-fonts.ts): only the files listed there, from
// PDF_FONT_DIR when the server has them, otherwise fetched once from
// PDF_FONT_BASE and kept in a cache folder (PDF_FONT_CACHE, or the system's
// temporary folder).
import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { identity } from "@/lib/identity";
import { DEFAULT_FONT_BASE, FONT_SOURCES } from "@/lib/pdf-fonts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 40 * 1024 * 1024;
const pending = new Map<string, Promise<Buffer | null>>();

async function fromDisk(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function fetchFont(file: string): Promise<Buffer | null> {
  const dir = process.env.PDF_FONT_DIR;
  const local = dir ? await fromDisk(join(dir, file)) : null;
  if (local) return local;
  const cacheDir = process.env.PDF_FONT_CACHE || join(tmpdir(), "synergy-pdf-fonts");
  const cached = await fromDisk(join(cacheDir, file));
  if (cached) return cached;
  const base = process.env.PDF_FONT_BASE || DEFAULT_FONT_BASE;
  try {
    const r = await fetch(`${base.replace(/\/?$/, "/")}${FONT_SOURCES[file]}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    // A TrueType font, not an error page.
    if (bytes.length > MAX_BYTES || bytes.length < 12 || bytes.readUInt32BE(0) !== 0x00010000) return null;
    await mkdir(cacheDir, { recursive: true });
    const tmp = join(cacheDir, `${file}.${process.pid}.part`);
    await writeFile(tmp, bytes);
    await rename(tmp, join(cacheDir, file));
    return bytes;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { file } = await ctx.params;
  if (!Object.prototype.hasOwnProperty.call(FONT_SOURCES, file)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let job = pending.get(file);
  if (!job) {
    job = fetchFont(file).finally(() => pending.delete(file));
    pending.set(file, job);
  }
  const bytes = await job;
  if (!bytes) return NextResponse.json({ error: "font unavailable" }, { status: 503 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "font/ttf", "Cache-Control": "private, max-age=604800, immutable" } });
}
