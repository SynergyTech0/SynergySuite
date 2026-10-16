import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { components } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, canSeeBoard, forbidden, isUuid, notFound, requireComponent } from "@/lib/authz";
import { isUniqueViolation } from "@/lib/releases";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireComponent(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.description === "string") patch.description = body.description;
  if ("leadId" in body) {
    if (body.leadId !== null && (!isUuid(body.leadId) || !(await canSeeBoard(body.leadId, access.boardId)))) return notFound();
    patch.leadId = body.leadId;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  try {
    const [c] = await db.update(components).set(patch).where(eq(components.id, id)).returning();
    publish(access.boardId, { type: "changed" });
    return NextResponse.json(c);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: "a component with that name already exists" }, { status: 409 });
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireComponent(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();
  await db.delete(components).where(eq(components.id, id));
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
