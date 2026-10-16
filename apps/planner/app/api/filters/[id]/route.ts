import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { getCurrentUserOrNull } from "@/lib/session";
import { isUuid, notFound } from "@/lib/authz";
import { JqlError, parseJql } from "@/lib/jql";

/** Rename or re-query a saved filter. Someone else's filter is simply not found. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUserOrNull();
  if (!user || !isUuid(id)) return notFound();
  const mine = and(eq(savedFilters.id, id), eq(savedFilters.userId, user.id));
  const [existing] = await db.select().from(savedFilters).where(mine);
  if (!existing) return notFound();

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.query === "string") {
    try {
      parseJql(body.query);
    } catch (err) {
      if (err instanceof JqlError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
    patch.query = body.query.trim();
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const [f] = await db.update(savedFilters).set(patch).where(mine).returning();
  return NextResponse.json(f);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUserOrNull();
  if (!user || !isUuid(id)) return notFound();
  const [gone] = await db.delete(savedFilters)
    .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, user.id))).returning();
  if (!gone) return notFound();
  return NextResponse.json({ ok: true });
}
