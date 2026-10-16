import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

// ------------------------------
// GET: Fetch all signers for a document
// ------------------------------
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }>}
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const document = await prisma.document.findUnique({
      where: { id: ((await context.params).id) },
      select: { senderId: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    // Ensure only sender or admin can access signers
    if (document.senderId !== currentUser?.id && currentUser?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch signers
    const signers = await prisma.documentSigner.findMany({
      where: { documentId: ((await context.params).id) },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        order: true,
      },
      orderBy: { order: "asc" },
    });

    return NextResponse.json(signers);
  } catch (error) {
    console.error("Error fetching signers:", error);
    return NextResponse.json(
      { error: "Failed to fetch signers" },
      { status: 500 }
    );
  }
}
