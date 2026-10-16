import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardFixVersions } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { boardOfVersion, canWrite, forbidden, isUuid, notFound, requireCard } from "@/lib/authz";

// Tag or untag a card with a fix version. An ordinary edit (write access); the fix version must belong to the
// card's own board, or a card on board A could be counted in board B's release.
async function guard(req: Request, id: string) {
  const access = await requireCard(id);
  if (!access) return { error: notFound() };
  if (!canWrite(access.role)) return { error: forbidden() };
  const body = await req.json().catch(() => ({}));
  const ref = body.versionId;
  if (!isUuid(ref) || (await boardOfVersion(ref)) !== access.boardId) return { error: notFound() };
  return { access, ref };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const added = await db.insert(cardFixVersions).values({ cardId: id, versionId: g.ref }).onConflictDoNothing().returning();
  if (added.length) {
    await logActivity({ boardId: g.access.boardId, cardId: id, userId: g.access.user.id, type: "card_updated", data: { field: "fix version", added: g.ref } });
  }
  publish(g.access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const removed = await db.delete(cardFixVersions).where(and(eq(cardFixVersions.cardId, id), eq(cardFixVersions.versionId, g.ref))).returning();
  if (removed.length) {
    await logActivity({ boardId: g.access.boardId, cardId: id, userId: g.access.user.id, type: "card_updated", data: { field: "fix version", removed: g.ref } });
  }
  publish(g.access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
