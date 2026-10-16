import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customFields } from "@/db/schema";
import { publish } from "@/lib/bus";
import { boardOfCustomField, canAdminister, forbidden, isUuid, notFound, requireVia } from "@/lib/authz";
import { isUniqueViolation } from "@/lib/releases";

/** Rename, reorder or change the options of a field; or delete it, and its values with it. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const access = await requireVia(() => boardOfCustomField(id));
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
  if (typeof body.position === "number") patch.position = body.position;
  if (Array.isArray(body.options)) {
    const options = body.options.filter((o: unknown) => typeof o === "string" && o.trim()).map((o: string) => o.trim());
    if (!options.length) return NextResponse.json({ error: "a select field needs at least one option" }, { status: 400 });
    patch.options = options;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    const [f] = await db.update(customFields).set(patch).where(eq(customFields.id, id)).returning();
    publish(access.boardId, { type: "changed" });
    return NextResponse.json(f);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: "a field with that name already exists" }, { status: 409 });
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const access = await requireVia(() => boardOfCustomField(id));
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();
  await db.delete(customFields).where(eq(customFields.id, id));
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
