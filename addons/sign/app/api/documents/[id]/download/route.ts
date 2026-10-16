import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFileBuffer, getContentType } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }>}
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const document = await prisma.document.findUnique({
      where: { id: ((await context.params).id) },
      include: { signers: true }
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Check if user has access to this document
    const hasAccess = 
      document.senderId === session.user.id || // User is sender
      document.signers.some((signer: any) => signer.userId === session.user.id || signer.email === session.user.email) || // User is signer
      session.user.role === 'ADMIN'; // User is admin

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Derive filename from storage path
    const fileName = document.cloudStoragePath.split('/').pop() || `document-${document.id}`;
    const contentType = getContentType(fileName);

    try {
      // Fetch file buffer based on provider
      const fileBuffer = await getFileBuffer(document.cloudStoragePath, document.cloudProvider);

      // Return binary response with download headers
      const bytes = new Uint8Array(fileBuffer); // Convert Buffer to acceptable BodyInit
      return new Response(bytes, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': fileBuffer.length.toString(),
          'Cache-Control': 'private, no-store'
        }
      });
    } catch (fileErr) {
      console.error("File retrieval failed", fileErr);
      return NextResponse.json({ error: "Failed to retrieve file" }, { status: 500 });
    }

  } catch (error) {
    console.error("Document download error:", error);
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }
}

