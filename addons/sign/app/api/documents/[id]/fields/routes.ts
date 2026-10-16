import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

// ------------------------------
// GET: Fetch all fields for a document
// ------------------------------
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const document = await prisma.document.findUnique({
      where: { id: params.id },
      include: {
        fields: {
          include: {
            document_signers: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Only sender can access full field details
    const sender = await prisma.user.findUnique({
      where: { email: session.user.email },
    });
    if (document.senderId !== sender?.id && sender?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(document.fields);
  } catch (error) {
    console.error("Error fetching document fields:", error);
    return NextResponse.json(
      { error: "Failed to fetch document fields" },
      { status: 500 }
    );
  }
}

// ------------------------------
// PATCH: Update field assignments or metadata
// ------------------------------
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sender = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    const document = await prisma.document.findUnique({
      where: { id: params.id },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Validate sender access
    if (document.senderId !== sender?.id && sender?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    if (!Array.isArray(body.fields)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const updates = [];

    for (const field of body.fields) {
      const { id, label, fieldType, required, pageNumber, x, y, width, height, assignedToId } = field;

      // Check that signer belongs to this document if assigned
      if (assignedToId) {
        const signer = await prisma.documentSigner.findUnique({
          where: { id: assignedToId },
          select: { documentId: true },
        });

        if (!signer || signer.documentId !== document.id) {
          return NextResponse.json(
            { error: `Invalid signer assignment for field ${id}` },
            { status: 400 }
          );
        }
      }

      updates.push(
        prisma.documentField.update({
          where: { id },
          data: {
            label,
            fieldType,
            required,
            pageNumber,
            x,
            y,
            width,
            height,
            assignedToId,
          },
        })
      );
    }

    const results = await prisma.$transaction(updates);

    return NextResponse.json({
      success: true,
      updatedCount: results.length,
      message: "Fields successfully updated",
    });
  } catch (error) {
    console.error("Error updating document fields:", error);
    return NextResponse.json(
      { error: "Failed to update document fields" },
      { status: 500 }
    );
  }
}
