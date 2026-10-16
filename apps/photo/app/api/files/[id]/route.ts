import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { MAX_FILE, deleteFile, getFile, inlineType, readBytes, replaceFile } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** The file's bytes. Common image types are served inline (for thumbnails); the rest as a download. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const file = await getFile(me.subject, id);
  const bytes = file && (await readBytes(me.subject, id));
  if (!file || !bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const type = inlineType(file.name);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type ?? "application/octet-stream",
      "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
  });
}

/** Save over the file with new bytes. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_FILE) return NextResponse.json({ error: "File too large" }, { status: 413 });
  const file = await replaceFile(me.subject, id, bytes);
  return file ? NextResponse.json({ file }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  return (await deleteFile(me.subject, id)) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
