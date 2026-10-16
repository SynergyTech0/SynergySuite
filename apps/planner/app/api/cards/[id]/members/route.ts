import { NextResponse } from "next/server";
import { db } from "@/db";
import { cardMembers, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { publish } from "@/lib/bus";
import { canWrite, forbidden, notFound, requireCard, workspacePeerIds } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  // Only someone who shares a workspace with the caller can be assigned: otherwise a stranger from
  // another tenant can be attached to a card, and they would then show in this card members list.
  const peers = await workspacePeerIds(access.user.id);
  if (!peers.includes(String(userId))) return notFound();
  const added = await db.insert(cardMembers).values({ cardId: id, userId }).onConflictDoNothing().returning();
  if (added.length) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await logActivity({ boardId: access.boardId, cardId: id, userId: access.user.id, type: "member_added", data: { userId, name: u?.name ?? null } });
  }
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await req.json();
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const removed = await db.delete(cardMembers).where(and(eq(cardMembers.cardId, id), eq(cardMembers.userId, userId))).returning();
  if (removed.length) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await logActivity({ boardId: access.boardId, cardId: id, userId: access.user.id, type: "member_removed", data: { userId, name: u?.name ?? null } });
  }
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
