import { NextResponse } from "next/server";
import { db } from "@/db";
import { lists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { afterLast } from "@/lib/position";
import { publish } from "@/lib/bus";
import { canWrite, forbidden, notFound, requireBoard } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { inferCategory, isStatusCategory } from "@/lib/workflow";

export async function POST(req: Request) {
  const body = await req.json();
  const { boardId, title } = body;
  if (!boardId || !title?.trim()) return NextResponse.json({ error: "boardId + title required" }, { status: 400 });
  const access = await requireBoard(boardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const existing = await db.select({ position: lists.position }).from(lists).where(eq(lists.boardId, boardId));
  const [list] = await db.insert(lists)
    .values({
      boardId, title: title.trim(), position: afterLast(existing.map((l) => l.position)),
      statusCategory: isStatusCategory(body.statusCategory) ? body.statusCategory : inferCategory(title),
    }).returning();
  await logActivity({ boardId, userId: access.user.id, type: "list_created", data: { title: list.title } });
  publish(boardId, { type: "changed" });
  return NextResponse.json(list, { status: 201 });
}
