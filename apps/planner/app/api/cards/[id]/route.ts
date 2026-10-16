import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments, cards, comments, checklists, checklistItems, cardLabels, labels, users, cardMembers } from "@/db/schema";
import { and, eq, asc, desc, inArray } from "drizzle-orm";
import { isHexColor, parseDate } from "@/lib/validate";
import { parseDuration } from "@/lib/duration";
import { linksForCard } from "@/lib/links";
import { fieldValuesFor } from "@/lib/custom-fields";
import { notifyCardChanges } from "@/lib/card-notifications";
import { completionFor, completionOnMove, isResolution } from "@/lib/workflow";
import { runAutomations } from "@/lib/automation";
import { cardComponents, cardFixVersions, cardWatchers, components, versions, workLogs } from "@/db/schema";
import { publish } from "@/lib/bus";
import { cardActivity, logActivity, recordCardChanges } from "@/lib/activity";
import { boardOfCard, boardOfList, boardOfSprint, canSeeBoard, canWrite, forbidden, isUuid, notFound, requireCard, visibleBoardIds } from "@/lib/authz";

// GET: full card detail (labels, checklists+items, comments) for the modal.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  const card = await db.query.cards.findFirst({ where: eq(cards.id, id) });
  if (!card) return notFound();

  const cls = await db.select().from(checklists).where(eq(checklists.cardId, id)).orderBy(asc(checklists.position));
  const items = cls.length
    ? await db.select().from(checklistItems)
        .where(inArray(checklistItems.checklistId, cls.map((c) => c.id))).orderBy(asc(checklistItems.position))
    : [];
  const cl = cls.map((c) => ({ ...c, items: items.filter((i) => i.checklistId === c.id) }));

  const attached = await db.select({ id: labels.id, name: labels.name, color: labels.color })
    .from(cardLabels).innerJoin(labels, eq(cardLabels.labelId, labels.id)).where(eq(cardLabels.cardId, id));

  const cmts = await db.select({
    id: comments.id, body: comments.body, origin: comments.origin, createdAt: comments.createdAt,
    editedAt: comments.editedAt, userId: comments.userId, author: users.name,
  }).from(comments).leftJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.cardId, id)).orderBy(asc(comments.createdAt));

  const members = await db.select({ id: users.id, name: users.name, isMind: users.isMind })
    .from(cardMembers).innerJoin(users, eq(cardMembers.userId, users.id)).where(eq(cardMembers.cardId, id));

  const activity = await cardActivity(id);
  const links = await linksForCard(id, await visibleBoardIds(access.user.id));
  const fields = await fieldValuesFor(id);
  const fixVersions = await db.select({ id: versions.id, name: versions.name }).from(cardFixVersions)
    .innerJoin(versions, eq(versions.id, cardFixVersions.versionId)).where(eq(cardFixVersions.cardId, id));
  const cardComponentList = await db.select({ id: components.id, name: components.name }).from(cardComponents)
    .innerJoin(components, eq(components.id, cardComponents.componentId)).where(eq(cardComponents.cardId, id));
  const logs = await db.select({
    id: workLogs.id, minutes: workLogs.minutes, comment: workLogs.comment, startedAt: workLogs.startedAt,
    userId: workLogs.userId, author: users.name,
  }).from(workLogs).leftJoin(users, eq(users.id, workLogs.userId))
    .where(eq(workLogs.cardId, id)).orderBy(desc(workLogs.startedAt));
  const watchers = await db.select({ id: users.id, name: users.name }).from(cardWatchers)
    .innerJoin(users, eq(users.id, cardWatchers.userId)).where(eq(cardWatchers.cardId, id));
  const atts = await db.select().from(attachments).where(eq(attachments.cardId, id)).orderBy(desc(attachments.createdAt));

  // viewer lets the modal offer edit/delete on the caller's own comments without a second request.
  // It is a hint for the UI only; every write re-checks on the server.
  return NextResponse.json({
    ...card, checklists: cl, labels: attached, comments: cmts, members, activity, attachments: atts, links, watchers, fixVersions, components: cardComponentList, workLogs: logs, fields,
    viewer: { id: access.user.id, role: access.role },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const body = await req.json();

  // Three patchable fields point at other rows, and every one of them can carry this card OUT of
  // its board if left unchecked: listId (which column it sits in), sprintId (which sprint owns it)
  // and parentId (which epic/story it hangs under). A foreign sprintId is not merely untidy — when
  // that sprint is completed, sprints/[id] nulls sprintId on its incomplete cards, so board B's
  // routine action would silently mutate board A's card.
  // A malformed id is a thing that does not exist (404), not a Postgres cast error (500).
  if (body.listId) {
    if (!isUuid(body.listId) || (await boardOfList(body.listId)) !== access.boardId) return notFound();
  }
  if (body.sprintId) {
    if (!isUuid(body.sprintId) || (await boardOfSprint(body.sprintId)) !== access.boardId) return notFound();
  }
  if (body.parentId) {
    if (!isUuid(body.parentId) || (await boardOfCard(body.parentId)) !== access.boardId) return notFound();
  }
  // Assignee and reporter must be people who can see this board; anyone else would be handed a card
  // (and a notification about it) from a board they have no access to.
  for (const k of ["assigneeId", "reporterId"] as const) {
    if (k in body && body[k] !== null) {
      if (!isUuid(body[k]) || !(await canSeeBoard(body[k], access.boardId))) return notFound();
    }
  }

  const before = await db.query.cards.findFirst({ where: eq(cards.id, id) });
  if (!before) return notFound();

  // A cover is a colour or an image already attached to THIS card. It is rendered as inline CSS, so a
  // free-form string (url(javascript:...), expressions) is refused outright.
  if ("cover" in body && body.cover !== null) {
    const own = !isHexColor(body.cover) && isUuid(body.cover)
      ? (await db.select({ id: attachments.id }).from(attachments)
          .where(and(eq(attachments.cardId, id), eq(attachments.id, body.cover))))[0]
      : null;
    if (!isHexColor(body.cover) && !own) return NextResponse.json({ error: "cover must be #rrggbb or an attachment on this card" }, { status: 400 });
  }
  if ("startDate" in body && parseDate(body.startDate) === undefined) {
    return NextResponse.json({ error: "invalid startDate" }, { status: 400 });
  }

  // Estimates arrive as Jira shorthand ("1d 4h") or null. Setting the original estimate seeds the
  // remaining one, but only while nothing has been logged — after that the remaining estimate is the
  // team's live number and re-estimating must not silently discard it.
  const estimates: Record<string, number | null> = {};
  for (const k of ["originalEstimate", "remainingEstimate"] as const) {
    if (!(k in body)) continue;
    if (body[k] === null) { estimates[k] = null; continue; }
    const minutes = parseDuration(String(body[k]));
    if (minutes === null) return NextResponse.json({ error: `${k} must be a duration like 90m, 2h or 1d 4h` }, { status: 400 });
    estimates[k] = minutes;
  }
  if ("originalEstimate" in estimates && !("remainingEstimate" in estimates) && before.timeSpent === 0) {
    estimates.remainingEstimate = estimates.originalEstimate;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["title", "description", "listId", "position", "isComplete", "isArchived", "dueDate", "startDate",
                    "issueType", "priority", "points", "parentId", "sprintId", "cover", "assigneeId", "reporterId"]) {
    if (k in body && body[k] !== undefined) patch[k] = (k === "dueDate" || k === "startDate") ? parseDate(body[k]) : body[k];
  }
  // Completion and resolution (lib/workflow). An explicit isComplete wins; otherwise a move into or out
  // of a Done-category list decides. completedAt is what the burndown reads, so it is stamped only
  // when completion actually changes.
  if ("resolution" in body && body.resolution !== null && !isResolution(body.resolution)) {
    return NextResponse.json({ error: "invalid resolution" }, { status: 400 });
  }
  const resolution = body.resolution ?? undefined;
  if ("isComplete" in patch) {
    Object.assign(patch, patch.isComplete === before.isComplete && resolution === undefined
      ? {}
      : completionFor(!!patch.isComplete, before, resolution));
  } else if (typeof patch.listId === "string") {
    Object.assign(patch, await completionOnMove(before, patch.listId, resolution));
  }
  if (resolution !== undefined && !("resolution" in patch)) {
    // A resolution on its own is only meaningful for a card that is (and stays) complete.
    if (!before.isComplete) return NextResponse.json({ error: "only a completed card has a resolution" }, { status: 400 });
    patch.resolution = resolution;
  }
  Object.assign(patch, estimates);
  const [card] = await db.update(cards).set(patch).where(eq(cards.id, id)).returning();
  if (!card) return notFound();
  await recordCardChanges(access.user.id, before, card);
  await notifyCardChanges(access.user.id, before, card);
  // What actually happened decides which rules run — a move is a move whatever else the patch
  // touched, and completing a card is its own event even when it never changed column.
  let latest = card;
  if (card.listId !== before.listId) {
    await runAutomations({ type: "card_moved", card }, access.user.id);
  }
  if (card.isComplete && !before.isComplete) {
    const [fresh] = await db.select().from(cards).where(eq(cards.id, id));
    await runAutomations({ type: "card_completed", card: fresh ?? card }, access.user.id);
  }
  if (card.listId !== before.listId || (card.isComplete && !before.isComplete)) {
    const [fresh] = await db.select().from(cards).where(eq(cards.id, id));
    if (fresh) latest = fresh;
  }
  publish(card.boardId, { type: "changed" });
  return NextResponse.json(latest);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const [card] = await db.delete(cards).where(eq(cards.id, id)).returning();
  if (card) {
    // Board-level, not card-level: the card's own history rows cascade away with it.
    await logActivity({ boardId: card.boardId, userId: access.user.id, type: "card_deleted", data: { title: card.title, issueKey: card.issueKey } });
  }
  publish(card?.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
