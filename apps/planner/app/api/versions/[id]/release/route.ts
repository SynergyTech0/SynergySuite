import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cardFixVersions, cards, versions } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, forbidden, isUuid, notFound, requireVersion } from "@/lib/authz";

/**
 * POST /api/versions/[id]/release { moveUnresolvedTo?: versionId } — mark a version released.
 *
 * Unfinished issues can be carried to another version of the same board, as Jira's release dialog
 * offers; otherwise they stay on the released version, visibly unfinished. Done issues always stay.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireVersion(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const to = body.moveUnresolvedTo ?? null;
  if (to !== null) {
    if (to === id) return NextResponse.json({ error: "cannot move issues to the version being released" }, { status: 400 });
    if (!isUuid(to)) return notFound();
    const [target] = await db.select({ boardId: versions.boardId }).from(versions).where(eq(versions.id, to));
    if (!target || target.boardId !== access.boardId) return notFound();
  }

  let moved = 0;
  await db.transaction(async (tx) => {
    await tx.update(versions).set({ releasedAt: new Date() }).where(eq(versions.id, id));
    if (to) {
      const unresolved = await tx.select({ cardId: cardFixVersions.cardId }).from(cardFixVersions)
        .innerJoin(cards, eq(cards.id, cardFixVersions.cardId))
        .where(and(eq(cardFixVersions.versionId, id), eq(cards.isComplete, false)));
      const ids = unresolved.map((u) => u.cardId);
      if (ids.length) {
        await tx.delete(cardFixVersions).where(and(eq(cardFixVersions.versionId, id), inArray(cardFixVersions.cardId, ids)));
        await tx.insert(cardFixVersions).values(ids.map((cardId) => ({ cardId, versionId: to }))).onConflictDoNothing();
      }
      moved = ids.length;
    }
  });

  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true, moved });
}
