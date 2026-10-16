import { NextResponse } from "next/server";
import { UserError } from "./util";

/** An image from the database, which must never run as a page. */
export function imageResponse(img: { mime: string; data: Buffer } | null): Response {
  if (!img) return NextResponse.json({ error: "No photo" }, { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Content-Length": String(img.data.length),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function readBody(req: Request, max: number): Promise<Buffer> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) throw new UserError("That file is too big", 413);
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > max) throw new UserError("That file is too big", 413);
  return buf;
}

export function download(body: string, name: string, type: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
