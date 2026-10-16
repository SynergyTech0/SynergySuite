import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { documentForOwner, isDenied } from "@/lib/access";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }>}
) {
  try {
    const documentId = ((await context.params).id);
    const __owner = await documentForOwner(documentId);
    if (isDenied(__owner)) return __owner.denied;
    const body = await request.json();

    const { title, aiSummary, suggestedFields } = body;

    // Update document in DB
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        title,
        aiSummary,
        suggestedFields,
      },
    });

    console.log("Document updated:", updatedDocument.id);
    return NextResponse.json({ success: true, document: updatedDocument });
  } catch (error) {
    console.error("Error updating document:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update document" },
      { status: 500 }
    );
  }
}
