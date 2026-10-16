import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { MAX_FILE, createFile, listFiles } from "@/lib/store";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ files: await listFiles(me.subject) });
}

/** POST /api/files?name=photo.png with the file's bytes as the body. */
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE) return NextResponse.json({ error: "File too large" }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_FILE) return NextResponse.json({ error: "File too large" }, { status: 413 });
  return NextResponse.json({ file: await createFile(me.subject, name, bytes) }, { status: 201 });
}
