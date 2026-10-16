import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardComponents } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { boardOfComponent, canWrite, forbidden, isUuid, notFound, requireCard } from "@/lib/authz";

// Tag or untag a card with a component. An ordinary edit (write access); the component must belong to the
// card's own board, or a card on board A could be counted in board B's release.
async function guard(req: Request, id: string) {
  const access = await requireCard(id);
  if (!access) return { error: notFound() };
  if (!canWrite(access.role)) return { error: forbidden() };
  const body = await req.json().catch(() => ({}));
  const ref = body.componentId;
  if (!isUuid(ref) || (await boardOfComponent(ref)) !== access.boardId) return { error: notFound() };
  return { access, ref };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const added = await db.insert(cardComponents).values({ cardId: id, componentId: g.ref }).onConflictDoNothing().returning();
  if (added.length) {
    await logActivity({ boardId: g.access.boardId, cardId: id, userId: g.access.user.id, type: "card_updated", data: { field: "component", added: g.ref } });
  }
  publish(g.access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const removed = await db.delete(cardComponents).where(and(eq(cardComponents.cardId, id), eq(cardComponents.componentId, g.ref))).returning();
  if (removed.length) {
    await logActivity({ boardId: g.access.boardId, cardId: id, userId: g.access.user.id, type: "card_updated", data: { field: "component", removed: g.ref } });
  }
  publish(g.access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
