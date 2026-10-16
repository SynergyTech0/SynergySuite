import { NextRequest, NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { docAccess } from "@/lib/access";
import { mediaBytes, mediaInfo } from "@/lib/slides/media-store";

export const dynamic = "force-dynamic";

// Stream a presentation's audio/video, with byte ranges so players can seek.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; mediaId: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, mediaId } = await ctx.params;
  if (!(await docAccess(id, me))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const info = await mediaInfo(id, me.org, mediaId);
  if (!info) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": info.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (range && info.size > 0) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : info.size - 1;
    if (Number.isNaN(start)) { start = Math.max(0, info.size - end); end = info.size - 1; } // suffix range
    end = Math.min(end, info.size - 1);
    if (start > end || start >= info.size) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } });
    const b = await mediaBytes(id, me.org, mediaId, start, end);
    if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(b), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(b.length) } });
  }
  const b = await mediaBytes(id, me.org, mediaId, 0, Math.max(0, info.size - 1));
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(b), { status: 200, headers: { ...headers, "Content-Length": String(b.length) } });
}
