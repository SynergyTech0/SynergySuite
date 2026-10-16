import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";
import { MEDIA_MAX_BYTES, MEDIA_TYPES, putMedia } from "@/lib/slides/media-store";

export const dynamic = "force-dynamic";

// Upload one audio/video file (or a 3D model, as GLB) for a presentation. Body: the raw file bytes,
// Content-Type: its MIME type, optional ?name=. Returns the URL slides store.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atLeast(a.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const mime = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!MEDIA_TYPES.test(mime)) return NextResponse.json({ error: "unsupported media type" }, { status: 415 });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MEDIA_MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (bytes.length > MEDIA_MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  // 3D models are glTF binaries (GLB): check the header
  if (mime === "model/gltf-binary" && !(bytes.length >= 20 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2)) return NextResponse.json({ error: "not a glTF 2.0 binary" }, { status: 415 });
  const mediaId = randomBytes(12).toString("base64url");
  await putMedia({ id: mediaId, docId: id, org: me.org, mime, name: req.nextUrl.searchParams.get("name") || "", bytes, by: me.email });
  return NextResponse.json({ id: mediaId, url: `/api/docs/${encodeURIComponent(id)}/media/${mediaId}`, mime, size: bytes.length }, { status: 201 });
}
