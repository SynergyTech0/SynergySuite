import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { documentForOwner, isDenied } from "@/lib/access";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // ✅ FIX: resolve params properly
    const { id } = await context.params;
    const __owner = await documentForOwner(id);
    if (isDenied(__owner)) return __owner.denied;

    if (!id) {
      return NextResponse.json({ error: "Missing document id" }, { status: 400 });
    }

    // Get current document to flip the archived state
    const current = await prisma.document.findUnique({
      where: { id },
      select: { archived: true },
    });

    if (!current) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Toggle archived: false -> true, true -> false
    const updated = await prisma.document.update({
      where: { id },
      data: { archived: !current.archived },
    });

    return NextResponse.json({ document: updated }, { status: 200 });
  } catch (error: any) {
    // Prisma throws P2025 when a record to update is not found
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    console.error("Failed to archive document:", error);
    return NextResponse.json(
      { error: "Failed to archive document" },
      { status: 500 }
    );
  }
}
