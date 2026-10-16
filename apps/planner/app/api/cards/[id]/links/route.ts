import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, issueLinks } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { LINK_LABELS, isLinkType, linkExists } from "@/lib/links";
import { canWrite, forbidden, isUuid, notFound, requireCard, visibleBoardIds } from "@/lib/authz";

/**
 * POST /api/cards/[id]/links { type, targetId | targetKey } — link this card to another.
 *
 * Write access on this card's board; the target only has to be visible (linking to a card on a board
 * you only observe is fine — Jira works the same way). A key is resolved among the caller's visible
 * boards only; since legacy boards share a prefix a key can be ambiguous, and then the caller is asked
 * to pick by id rather than having one chosen for them.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await requireCard(id);
  if (!source) return notFound();
  if (!canWrite(source.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (!isLinkType(body.type)) return NextResponse.json({ error: "type must be blocks, relates, duplicates or clones" }, { status: 400 });

  let targetId: string;
  if (isUuid(body.targetId)) {
    const target = await requireCard(body.targetId);
    if (!target) return notFound();
    targetId = body.targetId;
  } else if (typeof body.targetKey === "string" && body.targetKey.trim()) {
    const visible = await visibleBoardIds(source.user.id);
    const matches = visible.length
      ? await db.select({ id: cards.id, boardTitle: boards.title }).from(cards)
          .innerJoin(boards, eq(boards.id, cards.boardId))
          .where(and(inArray(cards.boardId, visible), sql`upper(${cards.issueKey}) = ${body.targetKey.trim().toUpperCase()}`))
      : [];
    if (!matches.length) return notFound();
    if (matches.length > 1) {
      return NextResponse.json({ error: "that key exists on more than one board; choose the card", candidates: matches }, { status: 409 });
    }
    targetId = matches[0].id;
  } else {
    return NextResponse.json({ error: "targetId or targetKey required" }, { status: 400 });
  }

  if (targetId === id) return NextResponse.json({ error: "a card cannot link to itself" }, { status: 400 });
  if (await linkExists(id, targetId, body.type)) return NextResponse.json({ error: "that link already exists" }, { status: 409 });

  const [created] = await db.insert(issueLinks)
    .values({ sourceId: id, targetId, type: body.type, createdBy: source.user.id })
    .onConflictDoNothing().returning();
  if (!created) return NextResponse.json({ error: "that link already exists" }, { status: 409 });

  const ends = await db.select({ id: cards.id, boardId: cards.boardId, issueKey: cards.issueKey, title: cards.title })
    .from(cards).where(inArray(cards.id, [id, targetId]));
  const src = ends.find((c) => c.id === id)!;
  const tgt = ends.find((c) => c.id === targetId)!;
  const [out, inn] = LINK_LABELS[body.type as keyof typeof LINK_LABELS];
  await logActivity([
    { boardId: src.boardId, cardId: src.id, userId: source.user.id, type: "link_added", data: { linkId: created.id, label: out, other: tgt.issueKey ?? tgt.title } },
    { boardId: tgt.boardId, cardId: tgt.id, userId: source.user.id, type: "link_added", data: { linkId: created.id, label: inn, other: src.issueKey ?? src.title } },
  ]);
  publish(src.boardId, { type: "changed" });
  if (tgt.boardId !== src.boardId) publish(tgt.boardId, { type: "changed" });
  return NextResponse.json(created, { status: 201 });
}
