import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards, issueLinks } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { LINK_LABELS } from "@/lib/links";
import { canWrite, forbidden, isUuid, notFound, requireCard } from "@/lib/authz";

/**
 * DELETE /api/issue-links/[id] — remove a link from either end. The caller needs write access on a
 * board holding one of the two cards; if they can see neither end the link does not exist for them.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [row] = await db.select().from(issueLinks).where(eq(issueLinks.id, id));
  if (!row) return notFound();

  const viaSource = await requireCard(row.sourceId);
  const viaTarget = await requireCard(row.targetId);
  if (!viaSource && !viaTarget) return notFound();
  const writable = [viaSource, viaTarget].find((a) => a && canWrite(a.role));
  if (!writable) return forbidden();

  await db.delete(issueLinks).where(eq(issueLinks.id, id));

  const ends = await db.select({ id: cards.id, boardId: cards.boardId, issueKey: cards.issueKey, title: cards.title })
    .from(cards).where(inArray(cards.id, [row.sourceId, row.targetId]));
  const src = ends.find((c) => c.id === row.sourceId);
  const tgt = ends.find((c) => c.id === row.targetId);
  const [out, inn] = LINK_LABELS[row.type];
  await logActivity([
    ...(src && tgt ? [{ boardId: src.boardId, cardId: src.id, userId: writable.user.id, type: "link_removed" as const, data: { label: out, other: tgt.issueKey ?? tgt.title } }] : []),
    ...(src && tgt ? [{ boardId: tgt.boardId, cardId: tgt.id, userId: writable.user.id, type: "link_removed" as const, data: { label: inn, other: src.issueKey ?? src.title } }] : []),
  ]);
  for (const b of new Set(ends.map((e) => e.boardId))) publish(b, { type: "changed" });
  return NextResponse.json({ ok: true });
}
