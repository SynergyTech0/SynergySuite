import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, sprintReports, sprints } from "@/db/schema";
import { notFound, requireBoard } from "@/lib/authz";
import { createdVsResolved, throughput, velocityFrom } from "@/lib/reports";

/**
 * GET /api/boards/[id]/reports?weeks=8 — velocity (from sprint snapshots), created vs resolved, and
 * throughput. Reading reports needs only visibility, so observers see them too.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();
  const weeks = Math.min(Math.max(Number(new URL(req.url).searchParams.get("weeks")) || 8, 2), 26);

  const snapshots = await db.select({
    name: sprints.name,
    committedPoints: sprintReports.committedPoints,
    completedPoints: sprintReports.completedPoints,
    committedCards: sprintReports.committedCards,
    completedCards: sprintReports.completedCards,
    completedAt: sprintReports.completedAt,
  }).from(sprintReports).innerJoin(sprints, eq(sprints.id, sprintReports.sprintId))
    .where(eq(sprintReports.boardId, id));

  const timed = await db.select({ createdAt: cards.createdAt, completedAt: cards.completedAt })
    .from(cards).where(and(eq(cards.boardId, id), eq(cards.isArchived, false)));

  const velocity = velocityFrom(snapshots);
  return NextResponse.json({
    velocity: velocity.sprints,
    averageVelocity: velocity.averageCompleted,
    sprintReports: snapshots,
    createdVsResolved: createdVsResolved(timed, weeks),
    throughput: throughput(timed, weeks),
  });
}
