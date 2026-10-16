import { NextResponse } from "next/server";
import { db } from "@/db";
import { sprints } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { publish } from "@/lib/bus";
import { canWrite, forbidden, notFound, requireBoard } from "@/lib/authz";

// GET /api/sprints?boardId=… — sprints for a board, oldest first.
export async function GET(req: Request) {
  const boardId = new URL(req.url).searchParams.get("boardId");
  if (!boardId) return NextResponse.json({ error: "boardId required" }, { status: 400 });
  if (!(await requireBoard(boardId))) return notFound();
  const rows = await db.select().from(sprints)
    .where(eq(sprints.boardId, boardId)).orderBy(asc(sprints.createdAt));
  return NextResponse.json(rows);
}

// POST /api/sprints — create a future sprint.
export async function POST(req: Request) {
  const body = await req.json();
  const boardId = String(body.boardId || "");
  const name = String(body.name || "").trim();
  if (!boardId || !name) return NextResponse.json({ error: "boardId + name required" }, { status: 400 });
  const access = await requireBoard(boardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const [s] = await db.insert(sprints).values({
    boardId,
    name,
    goal: body.goal ?? null,
    state: "future",
    startDate: body.startDate ? new Date(body.startDate) : null,
    endDate: body.endDate ? new Date(body.endDate) : null,
  }).returning();

  publish(boardId, { type: "changed" });
  return NextResponse.json(s);
}
