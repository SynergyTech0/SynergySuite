import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { createFolder, deleteFolder, listFolders } from "@/lib/store";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ folders: await listFolders(me.subject) });
}

/** POST `{ path: "Projects/Site A" }` makes the folder and any missing parents. */
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
  const folder = typeof body?.path === "string" ? await createFolder(me.subject, body.path) : null;
  return folder ? NextResponse.json({ folder }, { status: 201 }) : NextResponse.json({ error: "That can't be a folder name" }, { status: 400 });
}

/** DELETE ?path=... removes an empty folder. */
export async function DELETE(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const result = await deleteFolder(me.subject, req.nextUrl.searchParams.get("path") ?? "");
  if (result === "not-empty") return NextResponse.json({ error: "Empty the folder first" }, { status: 409 });
  return result ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
