import { NextResponse } from "next/server";
import { db } from "@/db";
import { cards, sprintReports, sprints } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { publish } from "@/lib/bus";
import { canWrite, forbidden, notFound, requireSprint } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

/**
 * PATCH /api/sprints/[id] — rename/re-goal/re-date, or transition state.
 *
 * Transitions carry real semantics, not just a status flip:
 *   start    -> refuses if the board already has an active sprint (a board burns down ONE sprint)
 *   complete -> incomplete cards fall back to the backlog (standard Jira behaviour), so a finished
 *               sprint only ever contains what actually shipped and velocity stays honest.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const access = await requireSprint(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, id) });
  if (!sprint) return notFound();

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "goal"]) if (k in body && body[k] !== undefined) patch[k] = body[k];
  for (const k of ["startDate", "endDate"]) {
    if (k in body) patch[k] = body[k] ? new Date(body[k]) : null;
  }

  let returned = 0;
  const state = body.state as string | undefined;

  if (state === "active" && sprint.state !== "active") {
    const active = await db.query.sprints.findFirst({
      where: and(eq(sprints.boardId, sprint.boardId), eq(sprints.state, "active"), ne(sprints.id, id)),
    });
    if (active) {
      return NextResponse.json(
        { error: `"${active.name}" is already active — complete it before starting another.` },
        { status: 409 },
      );
    }
    patch.state = "active";
    if (!sprint.startDate && !body.startDate) patch.startDate = new Date();
  } else if (state === "completed" && sprint.state !== "completed") {
    patch.state = "completed";
    if (!body.endDate) patch.endDate = new Date();

    // Snapshot what the sprint held BEFORE unfinished work leaves it: afterwards there is no honest
    // way to know what was committed, and velocity is only as good as this record.
    const held = await db.select().from(cards).where(and(eq(cards.sprintId, id), eq(cards.boardId, sprint.boardId)));
    const points = (cs: typeof held) => cs.reduce((n, c) => n + (c.points ?? 0), 0);
    const finished = held.filter((c) => c.isComplete);
    await db.insert(sprintReports).values({
      sprintId: id, boardId: sprint.boardId,
      committedPoints: points(held), completedPoints: points(finished),
      committedCards: held.length, completedCards: finished.length,
      returnedCards: held.length - finished.length,
      completedAt: new Date(),
    }).onConflictDoNothing();   // re-completing a sprint keeps the first, true record
    // Send unfinished work back to the backlog — but only this board's work. sprintId has no
    // foreign key, so a card from another board can point at this sprint; without the boardId
    // filter, completing a sprint here would silently mutate that other board's card.
    const moved = await db.update(cards)
      .set({ sprintId: null, updatedAt: new Date() })
      .where(and(
        eq(cards.sprintId, id),
        eq(cards.boardId, sprint.boardId),
        eq(cards.isComplete, false),
      ))
      .returning({ id: cards.id });
    returned = moved.length;
  } else if (state === "future" && sprint.state !== "future") {
    patch.state = "future";
  }

  const [s] = await db.update(sprints).set(patch).where(eq(sprints.id, id)).returning();
  if (patch.state === "active") {
    await logActivity({ boardId: sprint.boardId, userId: access.user.id, type: "sprint_started", data: { sprintId: id, name: s.name } });
  } else if (patch.state === "completed") {
    await logActivity({ boardId: sprint.boardId, userId: access.user.id, type: "sprint_completed", data: { sprintId: id, name: s.name, returnedToBacklog: returned } });
  }
  publish(sprint.boardId, { type: "changed" });
  return NextResponse.json({ ...s, returnedToBacklog: returned });
}

// DELETE — sprint_id on cards has no FK, so clear it explicitly or the cards dangle.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSprint(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, id) });
  if (!sprint) return notFound();

  await db.update(cards).set({ sprintId: null, updatedAt: new Date() }).where(eq(cards.sprintId, id));
  await db.delete(sprints).where(eq(sprints.id, id));

  publish(sprint.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
