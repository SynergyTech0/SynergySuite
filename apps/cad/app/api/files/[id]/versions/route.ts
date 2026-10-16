import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { listVersions } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** The file's earlier versions, newest first. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const versions = await listVersions(me.subject, id);
  return versions ? NextResponse.json({ versions }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
