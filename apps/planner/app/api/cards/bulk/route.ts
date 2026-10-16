import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cardLabels, cards } from "@/db/schema";
import { publish } from "@/lib/bus";
import { recordCardChanges } from "@/lib/activity";
import { notifyCardChanges } from "@/lib/card-notifications";
import { completionFor, completionOnMove, isResolution } from "@/lib/workflow";
import {
  boardOfLabel, boardOfList, boardOfSprint, canSeeBoard, canWrite, isUuid, notFound, requireCard,
} from "@/lib/authz";

const MAX = 200;
const TYPES = ["epic", "story", "task", "bug", "subtask"];
const PRIORITIES = ["highest", "high", "medium", "low", "lowest"];

/**
 * POST /api/cards/bulk { ids, set?, addLabels?, removeLabels? } — Jira's bulk change.
 *
 * A selection comes from search, so it can span boards. The shape of the change is validated once,
 * up front (a bad priority is a 400 and nothing is touched); then each card is checked on its own —
 * its board's role, and whether a list, sprint, label or assignee belongs to THAT card's board. A
 * card that fails any of those is skipped and counted, never partially applied, and the caller is
 * told how many and why.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter(isUuid) : [];
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  if (ids.length > MAX) return NextResponse.json({ error: `at most ${MAX} cards at a time` }, { status: 400 });

  const set = (body.set ?? {}) as Record<string, unknown>;
  const addLabels: string[] = Array.isArray(body.addLabels) ? body.addLabels.filter(isUuid) : [];
  const removeLabels: string[] = Array.isArray(body.removeLabels) ? body.removeLabels.filter(isUuid) : [];
  if (!Object.keys(set).length && !addLabels.length && !removeLabels.length) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }
  if (set.priority !== undefined && !PRIORITIES.includes(String(set.priority))) {
    return NextResponse.json({ error: "invalid priority" }, { status: 400 });
  }
  if (set.issueType !== undefined && !TYPES.includes(String(set.issueType))) {
    return NextResponse.json({ error: "invalid issueType" }, { status: 400 });
  }
  if (set.resolution !== undefined && set.resolution !== null && !isResolution(set.resolution)) {
    return NextResponse.json({ error: "invalid resolution" }, { status: 400 });
  }

  const reasons: Record<string, number> = {};
  const skip = (why: string) => { reasons[why] = (reasons[why] ?? 0) + 1; };
  const touchedBoards = new Set<string>();
  let updated = 0;

  for (const id of [...new Set(ids)]) {
    const access = await requireCard(id);
    if (!access) { skip("not found"); continue; }
    if (!canWrite(access.role)) { skip("read-only on that board"); continue; }

    const [before] = await db.select().from(cards).where(eq(cards.id, id));
    if (!before) { skip("not found"); continue; }

    // Anything that points at another row must belong to THIS card's board.
    if (set.listId !== undefined && (!isUuid(set.listId) || (await boardOfList(set.listId as string)) !== access.boardId)) { skip("that list is on another board"); continue; }
    if (set.sprintId != null && (!isUuid(set.sprintId) || (await boardOfSprint(set.sprintId as string)) !== access.boardId)) { skip("that sprint is on another board"); continue; }
    if (set.assigneeId != null && (!isUuid(set.assigneeId) || !(await canSeeBoard(set.assigneeId as string, access.boardId)))) { skip("that person cannot see the board"); continue; }
    const labelsHere = [...addLabels, ...removeLabels];
    let labelMismatch = false;
    for (const labelId of labelsHere) {
      if ((await boardOfLabel(labelId)) !== access.boardId) { labelMismatch = true; break; }
    }
    if (labelMismatch) { skip("that label is on another board"); continue; }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["priority", "issueType", "assigneeId", "sprintId", "listId", "isArchived"]) {
      if (set[k] !== undefined) patch[k] = set[k];
    }
    if (set.isComplete !== undefined) {
      Object.assign(patch, completionFor(!!set.isComplete, before, (set.resolution as never) ?? undefined));
    } else if (typeof patch.listId === "string") {
      Object.assign(patch, await completionOnMove(before, patch.listId));
    }

    if (Object.keys(patch).length > 1) {
      const [after] = await db.update(cards).set(patch).where(eq(cards.id, id)).returning();
      await recordCardChanges(access.user.id, before, after);
      await notifyCardChanges(access.user.id, before, after);
    }
    if (addLabels.length) {
      await db.insert(cardLabels).values(addLabels.map((labelId) => ({ cardId: id, labelId }))).onConflictDoNothing();
    }
    if (removeLabels.length) {
      await db.delete(cardLabels).where(and(eq(cardLabels.cardId, id), inArray(cardLabels.labelId, removeLabels)));
    }
    touchedBoards.add(access.boardId);
    updated++;
  }

  for (const boardId of touchedBoards) publish(boardId, { type: "changed" });
  const skipped = Object.values(reasons).reduce((n, v) => n + v, 0);
  if (!updated && !skipped) return notFound();
  return NextResponse.json({ updated, skipped, reasons });
}
