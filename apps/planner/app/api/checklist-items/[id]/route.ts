import { NextResponse } from "next/server";
import { db } from "@/db";
import { checklistItems, checklists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canWrite, forbidden, notFound, requireChecklistItem, workspacePeerIds } from "@/lib/authz";
import { parseDate } from "@/lib/validate";
import { logActivity } from "@/lib/activity";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireChecklistItem(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if ("isChecked" in body) patch.isChecked = !!body.isChecked;
  if ("text" in body && body.text?.trim()) patch.text = body.text.trim();
  if ("position" in body && typeof body.position === "number") patch.position = body.position;
  // Same rule as card assignees: only someone who shares a workspace with the caller, or an item
  // becomes a way to attach a stranger from another tenant to this board.
  if ("assigneeId" in body) {
    if (body.assigneeId === null) patch.assigneeId = null;
    else if (!(await workspacePeerIds(access.user.id)).includes(String(body.assigneeId))) return notFound();
    else patch.assigneeId = String(body.assigneeId);
  }
  if ("dueDate" in body) {
    const d = parseDate(body.dueDate);
    if (d === undefined) return NextResponse.json({ error: "invalid dueDate" }, { status: 400 });
    patch.dueDate = d;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const [item] = await db.update(checklistItems).set(patch).where(eq(checklistItems.id, id)).returning();
  if (item && "isChecked" in patch) {
    const [cl] = await db.select({ cardId: checklists.cardId }).from(checklists).where(eq(checklists.id, item.checklistId));
    await logActivity({ boardId: access.boardId, cardId: cl?.cardId, userId: access.user.id, type: "checklist_updated", data: { item: item.text, checked: item.isChecked } });
  }
  return NextResponse.json(item);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireChecklistItem(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  await db.delete(checklistItems).where(eq(checklistItems.id, id));
  return NextResponse.json({ ok: true });
}
