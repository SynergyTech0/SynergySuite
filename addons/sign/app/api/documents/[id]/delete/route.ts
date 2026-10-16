import { NextRequest, NextResponse } from "next/server";
import { documentForOwner, isDenied } from "@/lib/access";
import { holdChecker } from "@/lib/compliance";
import { deleteDocument } from "@/lib/ediscovery";

/**
 * Deletes a document the signed-in person sent. When anyone on it is under a legal hold, it is
 * kept for eDiscovery instead (and disappears for everyone else); the answer is the same either way.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const owner = await documentForOwner(id);
    if (isDenied(owner)) return owner.denied;
    await deleteDocument(id, holdChecker());
    return NextResponse.json({ document: { id }, deleted: true }, { status: 200 });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    console.error("Failed to delete document:", error);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}
