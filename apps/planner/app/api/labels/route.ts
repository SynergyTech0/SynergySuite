import { NextResponse } from "next/server";
import { db } from "@/db";
import { labels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canWrite, forbidden, notFound, requireBoard } from "@/lib/authz";
import { isHexColor } from "@/lib/validate";

export async function GET(req: Request) {
  const boardId = new URL(req.url).searchParams.get("boardId");
  if (!boardId) return NextResponse.json({ error: "boardId required" }, { status: 400 });
  if (!(await requireBoard(boardId))) return notFound();
  return NextResponse.json(await db.select().from(labels).where(eq(labels.boardId, boardId)));
}

export async function POST(req: Request) {
  const { boardId, name, color } = await req.json();
  if (!boardId || !color) return NextResponse.json({ error: "boardId + color required" }, { status: 400 });
  const access = await requireBoard(boardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  if (!isHexColor(color)) return NextResponse.json({ error: "color must be #rrggbb" }, { status: 400 });
  const [label] = await db.insert(labels).values({ boardId, name: name || null, color }).returning();
  return NextResponse.json(label, { status: 201 });
}
