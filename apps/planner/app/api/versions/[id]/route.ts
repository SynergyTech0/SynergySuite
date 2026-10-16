import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { versions } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, forbidden, notFound, requireVersion } from "@/lib/authz";
import { isUniqueViolation } from "@/lib/releases";
import { parseDate } from "@/lib/validate";

// PATCH /api/versions/[id] — rename, re-date, archive, or unrelease ({ released: false }). Admin only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireVersion(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.description === "string") patch.description = body.description;
  for (const k of ["startDate", "releaseDate"] as const) {
    if (k in body) {
      const d = parseDate(body[k]);
      if (d === undefined) return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      patch[k] = d;
    }
  }
  if ("isArchived" in body) patch.isArchived = !!body.isArchived;
  if (body.released === false) patch.releasedAt = null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    const [v] = await db.update(versions).set(patch).where(eq(versions.id, id)).returning();
    publish(access.boardId, { type: "changed" });
    return NextResponse.json(v);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: "a version with that name already exists" }, { status: 409 });
    throw err;
  }
}

// DELETE /api/versions/[id] — removes the version and every card's tag of it (cascade). Admin only.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireVersion(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();
  await db.delete(versions).where(eq(versions.id, id));
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
