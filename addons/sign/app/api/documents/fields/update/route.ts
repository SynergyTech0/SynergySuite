import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    // 🔐 1. Auth check
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 📦 2. Parse body
    const { documentId, fields } = await req.json();

    if (!documentId || !Array.isArray(fields)) {
      return NextResponse.json(
        { error: "Invalid payload — missing documentId or fields[]" },
        { status: 400 }
      );
    }

    // 🔐 3. Ensure the document belongs to the user
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, senderId: true },
    });

    if (!doc || doc.senderId !== userId) {
      return NextResponse.json(
        { error: "Document not found or unauthorized" },
        { status: 403 }
      );
    }

    // 🔎 4. Validate fields belong to this document
    const fieldIds = fields.map((f: any) => f.id);

    const existingFields = await prisma.documentField.findMany({
      where: { id: { in: fieldIds }, documentId },
      select: { id: true },
    });

    const existingSet = new Set(existingFields.map((f) => f.id));

    // Check for any invalid / mismatched fields
    const invalidFields = fieldIds.filter((id) => !existingSet.has(id));

    if (invalidFields.length > 0) {
      return NextResponse.json(
        {
          error: "Some fields do not belong to this document",
          invalidFields,
        },
        { status: 400 }
      );
    }

    // 🛠️ 5. Apply updates
    const updates = await Promise.all(
      fields.map((f: any) =>
        prisma.documentField.update({
          where: { id: f.id },
          data: {
            x: f.x ?? undefined,
            y: f.y ?? undefined,
            width: f.width ?? undefined,
            height: f.height ?? undefined,
            signerId: f.signerId ?? undefined,
            label: typeof f.label === "string" ? f.label : undefined,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      updatedCount: updates.length,
      updated: updates,
    });
  } catch (err: any) {
    console.error("Field update error:", err);
    return NextResponse.json(
      { error: "Failed to update fields", details: err?.message },
      { status: 500 }
    );
  }
}
