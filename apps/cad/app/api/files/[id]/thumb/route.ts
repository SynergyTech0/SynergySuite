import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { MAX_THUMB, readThumb, setThumb } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** The file's library picture (PNG). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const png = await readThumb(me.subject, id);
  if (!png) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}

/** PUT a PNG (made in the browser from the drawing or model) as the file's library picture. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_THUMB) return NextResponse.json({ error: "Picture too large" }, { status: 413 });
  const file = await setThumb(me.subject, id, new Uint8Array(await req.arrayBuffer()));
  return file ? NextResponse.json({ file }) : NextResponse.json({ error: "Not a PNG, too large, or no such file" }, { status: 400 });
}
