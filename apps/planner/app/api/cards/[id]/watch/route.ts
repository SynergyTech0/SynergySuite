import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardWatchers } from "@/db/schema";
import { notFound, requireCard } from "@/lib/authz";
import { watch } from "@/lib/notify";

// Watch or stop watching a card. Personal and changes nothing shared, so visibility is enough — an
// observer can watch the work they follow.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  await watch(id, access.user.id);
  return NextResponse.json({ watching: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  await db.delete(cardWatchers).where(and(eq(cardWatchers.cardId, id), eq(cardWatchers.userId, access.user.id)));
  return NextResponse.json({ watching: false });
}
