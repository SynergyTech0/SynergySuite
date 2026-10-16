import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { getFile, getShare, shareFile, unshareFile } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** The file's share link and its review comments, or `{ share: null }` when it isn't shared. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!(await getFile(me.subject, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ share: await getShare(me.subject, id) });
}

/** Shares the file with a view-only link (or returns the link it already has). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const share = await shareFile(me.subject, id);
  return share ? NextResponse.json({ share }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Stops sharing. The link stops working and its comments are removed. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  return (await unshareFile(me.subject, id)) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
