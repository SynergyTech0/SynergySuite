import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isDenied, signerForToken } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Values a field can hold: typed text, a date, "checked", or a drawn signature as a PNG data URL. */
const MAX_VALUE = 2_000_000;

/**
 * PATCH /api/signers/fields/:fieldId  { token, value }
 * A signer fills in one of their own fields. Nothing else about the field can change from here.
 */
export async function PATCH(req: Request, context: { params: Promise<{ fieldId: string }> }) {
  const { fieldId } = await context.params;
  let body: { token?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body" }, { status: 400 });
  }
  const signer = await signerForToken(typeof body.token === "string" ? body.token : null, { forWriting: true });
  if (isDenied(signer)) return signer.denied;
  if (typeof body.value !== "string" || body.value.length > MAX_VALUE) {
    return NextResponse.json({ error: "value must be text" }, { status: 400 });
  }
  const field = await prisma.documentField.findUnique({ where: { id: fieldId } });
  if (!field || field.documentId !== signer.documentId || field.assignedToId !== signer.id) {
    return NextResponse.json({ error: "Field not found" }, { status: 404 });
  }
  const updated = await prisma.documentField.update({ where: { id: field.id }, data: { value: body.value } });
  return NextResponse.json({ success: true, field: updated });
}
