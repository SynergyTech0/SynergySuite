import { NextResponse } from "next/server";
import { db } from "@/db";
import { lists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { publish } from "@/lib/bus";
import { canWrite, forbidden, notFound, requireList } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { isStatusCategory } from "@/lib/workflow";

// PATCH /api/lists/[id] — rename, reposition, or archive a column.
// Archiving is the safe default for "remove": the list drops out of the board snapshot while its
// cards stay in the database, so a mis-click loses nothing.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireList(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.position === "number") patch.position = body.position;
  if ("isArchived" in body) patch.isArchived = !!body.isArchived;
  if ("statusCategory" in body) {
    if (!isStatusCategory(body.statusCategory)) return NextResponse.json({ error: "statusCategory must be todo, in_progress or done" }, { status: 400 });
    patch.statusCategory = body.statusCategory;
  }
  if ("wipLimit" in body) {
    const w = body.wipLimit;
    if (w !== null && !(Number.isInteger(w) && w >= 0)) {
      return NextResponse.json({ error: "wipLimit must be a whole number of 0 or more, or null" }, { status: 400 });
    }
    patch.wipLimit = w === 0 ? null : w;   // 0 means "no limit", as in Jira
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const [before] = await db.select().from(lists).where(eq(lists.id, id));
  const [list] = await db.update(lists).set(patch).where(eq(lists.id, id)).returning();
  if (!list) return notFound();
  if (before && before.title !== list.title) {
    await logActivity({ boardId: access.boardId, userId: access.user.id, type: "list_updated", data: { field: "title", from: before.title, to: list.title } });
  }
  if (before && before.isArchived !== list.isArchived) {
    await logActivity({ boardId: access.boardId, userId: access.user.id, type: list.isArchived ? "list_archived" : "list_updated", data: list.isArchived ? { title: list.title } : { field: "restored", title: list.title } });
  }
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(list);
}

// DELETE /api/lists/[id] — destroys the column and, by cascade, its cards. Prefer archiving.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireList(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const [gone] = await db.delete(lists).where(eq(lists.id, id)).returning();
  if (gone) await logActivity({ boardId: access.boardId, userId: access.user.id, type: "list_archived", data: { title: gone.title, deleted: true } });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
