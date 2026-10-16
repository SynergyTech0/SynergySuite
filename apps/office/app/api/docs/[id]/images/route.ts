import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";
import { putMedia } from "@/lib/slides/media-store";

export const dynamic = "force-dynamic";

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|bmp)$/;

/** The real type of an image from its first bytes (the browser's label is not trusted). */
function sniff(b: Buffer): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  return null;
}

// Upload a picture for a document. Body: the raw image bytes (PNG, JPEG, GIF,
// WebP or BMP), optional ?name=. Pictures are stored as media rows beside the
// document, not inside it, so the collaborative document stays small; the
// document keeps the returned URL.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atLeast(a.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > IMAGE_MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (bytes.length > IMAGE_MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const mime = sniff(bytes);
  if (!mime || !IMAGE_TYPES.test(mime)) return NextResponse.json({ error: "unsupported image type" }, { status: 415 });
  const mediaId = randomBytes(12).toString("base64url");
  await putMedia({ id: mediaId, docId: id, org: me.org, mime, name: req.nextUrl.searchParams.get("name") || "", bytes, by: me.email });
  return NextResponse.json({ id: mediaId, url: `/api/docs/${encodeURIComponent(id)}/media/${mediaId}`, mime, size: bytes.length }, { status: 201 });
}
