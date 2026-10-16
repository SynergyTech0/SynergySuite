import { NextResponse } from "next/server";
import { db } from "@/db";
import { cards, lists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { afterLast } from "@/lib/position";
import { logActivity } from "@/lib/activity";
import { nextIssueKey } from "@/lib/issue-key";
import { runAutomations } from "@/lib/automation";
import { watch } from "@/lib/notify";
import { publish } from "@/lib/bus";
import { boardOfCard, canWrite, forbidden, isUuid, notFound, requireList } from "@/lib/authz";

export async function POST(req: Request) {
  const body = await req.json();
  const { listId, title } = body;
  if (!listId || !title?.trim()) return NextResponse.json({ error: "listId + title required" }, { status: 400 });
  const access = await requireList(listId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) return notFound();

  // Enums are checked here, not left to Postgres: an unknown value would otherwise surface as a 500.
  const TYPES = ["epic", "story", "task", "bug", "subtask"];
  const PRIORITIES = ["highest", "high", "medium", "low", "lowest"];
  if (body.issueType !== undefined && !TYPES.includes(body.issueType)) return NextResponse.json({ error: "invalid issueType" }, { status: 400 });
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) return NextResponse.json({ error: "invalid priority" }, { status: 400 });
  // A parent (epic/story, or the parent of a subtask) must be on the same board, as cards PATCH enforces.
  if (body.parentId != null && (!isUuid(body.parentId) || (await boardOfCard(body.parentId)) !== list.boardId)) return notFound();
  const existing = await db.select({ position: cards.position }).from(cards).where(eq(cards.listId, listId));
  const issueKey = await nextIssueKey(list.boardId);
  const [card] = await db.insert(cards).values({
    listId, boardId: list.boardId, title: title.trim(),
    position: afterLast(existing.map((c) => c.position)), createdBy: access.user.id, issueKey,
    issueType: body.issueType || "task", priority: body.priority || "medium",
    parentId: body.parentId ?? null,
    reporterId: access.user.id,
  }).returning();
  await logActivity({ boardId: list.boardId, cardId: card.id, userId: access.user.id, type: "card_created", data: { title: card.title } });
  await watch(card.id, access.user.id);
  // Automations run after the card exists, so a rule sees a real card and a failure cannot take the
  // creation down with it. The response carries the card as the rules left it.
  await runAutomations({ type: "card_created", card }, access.user.id);
  const [after] = await db.select().from(cards).where(eq(cards.id, card.id));
  publish(list.boardId, { type: "changed" });
  return NextResponse.json(after ?? card, { status: 201 });
}
