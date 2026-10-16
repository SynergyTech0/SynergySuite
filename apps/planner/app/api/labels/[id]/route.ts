import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { labels } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canWrite, forbidden, notFound, requireLabel } from "@/lib/authz";
import { isHexColor } from "@/lib/validate";

// PATCH /api/labels/[id] — rename or recolour a board label; every card using it follows.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireLabel(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  if ("color" in body) {
    if (!isHexColor(body.color)) {
      return NextResponse.json({ error: "color must be #rrggbb" }, { status: 400 });
    }
    patch.color = body.color;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const [label] = await db.update(labels).set(patch).where(eq(labels.id, id)).returning();
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(label);
}

// DELETE /api/labels/[id] — removes the label from the board and, by cascade, from every card.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireLabel(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  await db.delete(labels).where(eq(labels.id, id));
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
