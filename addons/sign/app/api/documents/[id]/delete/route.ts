import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Missing document id" }, { status: 400 });
    }

    // ✅ Fetch document metadata before deletion
    const document = await prisma.document.findUnique({
      where: { id },
      select: { cloudStoragePath: true, cloudProvider: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // ✅ Delete the file from cloud/local storage
    try {
      await deleteFile(document.cloudStoragePath, document.cloudProvider);
    } catch (err) {
      console.warn("⚠️ File delete warning:", err);
    }

    // ✅ Delete the document record from DB
    const deleted = await prisma.document.delete({
      where: { id },
    });

    return NextResponse.json({ document: deleted }, { status: 200 });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    console.error("❌ Failed to delete document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}
