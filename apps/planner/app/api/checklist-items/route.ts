import { NextResponse } from "next/server";
import { db } from "@/db";
import { checklistItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { afterLast } from "@/lib/position";
import { canWrite, forbidden, notFound, requireChecklist } from "@/lib/authz";

export async function POST(req: Request) {
  const { checklistId, text } = await req.json();
  if (!checklistId || !text?.trim()) return NextResponse.json({ error: "checklistId + text required" }, { status: 400 });
  const access = await requireChecklist(checklistId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const existing = await db.select({ position: checklistItems.position }).from(checklistItems)
    .where(eq(checklistItems.checklistId, checklistId));
  const [item] = await db.insert(checklistItems)
    .values({ checklistId, text: text.trim(), position: afterLast(existing.map((i) => i.position)) }).returning();
  return NextResponse.json(item, { status: 201 });
}
