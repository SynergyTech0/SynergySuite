import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { checklists } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canWrite, forbidden, notFound, requireChecklist } from "@/lib/authz";

// PATCH /api/checklists/[id] — rename or reposition a checklist.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireChecklist(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.position === "number") patch.position = body.position;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const [cl] = await db.update(checklists).set(patch).where(eq(checklists.id, id)).returning();
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(cl);
}

// DELETE /api/checklists/[id] — removes the checklist and, by cascade, its items.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireChecklist(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const [gone] = await db.delete(checklists).where(eq(checklists.id, id)).returning();
  if (gone) {
    await logActivity({ boardId: access.boardId, cardId: gone.cardId, userId: access.user.id, type: "checklist_updated", data: { checklist: gone.title, deleted: true } });
  }
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
