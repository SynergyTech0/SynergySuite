import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardFieldValues, customFields } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canWrite, forbidden, isUuid, notFound, requireCard } from "@/lib/authz";
import { validateFieldValue } from "@/lib/custom-fields";

/**
 * PUT /api/cards/[id]/fields { fieldId, value } — set or clear one custom field on a card.
 *
 * The field must belong to this card's board (a field id from another board is simply not found), and
 * the value is checked against the field's type before it is stored.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (!isUuid(body.fieldId)) return notFound();
  const [field] = await db.select().from(customFields).where(eq(customFields.id, body.fieldId));
  if (!field || field.boardId !== access.boardId) return notFound();

  const checked = await validateFieldValue(field, body.value);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: checked.status });

  if (checked.value === null) {
    await db.delete(cardFieldValues).where(and(eq(cardFieldValues.cardId, id), eq(cardFieldValues.fieldId, field.id)));
  } else {
    await db.insert(cardFieldValues).values({ cardId: id, fieldId: field.id, value: checked.value })
      .onConflictDoUpdate({ target: [cardFieldValues.cardId, cardFieldValues.fieldId], set: { value: checked.value } });
  }

  await logActivity({
    boardId: access.boardId, cardId: id, userId: access.user.id, type: "card_updated",
    data: { field: field.name, to: checked.value },
  });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true, value: checked.value });
}
