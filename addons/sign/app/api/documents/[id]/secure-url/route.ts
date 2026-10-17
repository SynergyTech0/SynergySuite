import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFileDownloadUrl } from "@/lib/storage";
import { AuditAction } from "@prisma/client";
import { documentForOwner, isDenied } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * @route GET /api/documents/[id]/secure-url
 * @description Generate a short-lived, secure URL for document access
 * @security Validates user permissions before generating URL
 * @returns { url: string, expiresIn: number } - Secure URL valid for 5 minutes
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: documentId } = await context.params;
    const __owner = await documentForOwner(documentId);
    if (isDenied(__owner)) return __owner.denied;
    const session = await getServerSession(authOptions);

    // Get requester IP and User Agent for audit logging
    const ipAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    console.log("[Secure URL] Request for document:", {
      documentId,
      userId: session?.user?.id,
      ipAddress,
    });

    // Validate session exists
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          code: "NO_SESSION",
          message: "You must be logged in to access documents.",
        },
        { status: 401 }
      );
    }

    // Fetch document with authorization details
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        sender: true,
        signers: {
          select: {
            userId: true,
            status: true,
          },
        },
      },
    });

    // Validate document exists
    if (!document) {
      console.log("[Secure URL] Document not found:", documentId);
      return NextResponse.json(
        {
          error: "Not found",
          code: "DOCUMENT_NOT_FOUND",
          message: "The requested document does not exist.",
        },
        { status: 404 }
      );
    }

    // Authorization Logic
    const userId = session.user.id;
    const userRole = session.user.role;
    let authorized = false;
    let authReason = "";

    // 1. Document sender can always access
    if (document.senderId === userId) {
      authorized = true;
      authReason = "Document sender";
    }
    // 2. Assigned signers can access their documents
    else if (document.signers.some((s) => s.userId === userId)) {
      authorized = true;
      authReason = "Assigned signer";
    }
    // 3. Admins can access all documents (future: scope to their enterprise)
    else if (userRole === "ADMIN" || userRole === "SYSTEM_ADMIN") {
      authorized = true;
      authReason = "Admin access";
    }

    if (!authorized) {
      console.log("[Secure URL] Access denied:", {
        documentId,
        userId,
        reason: "User not authorized",
      });

      // Log failed access attempt
      await prisma.auditLog.create({
        data: {
          documentId,
          userId,
          action: AuditAction.DOCUMENT_ACCESS_DENIED,
          details: {
            reason: "Unauthorized access attempt",
            requestedBy: session.user.email,
          },
          ipAddress,
          userAgent,
        },
      });

      return NextResponse.json(
        {
          error: "Forbidden",
          code: "ACCESS_DENIED",
          message: "You do not have permission to access this document.",
        },
        { status: 403 }
      );
    }

    // Generate secure URL (5-minute expiry)
    const secureUrl = await getFileDownloadUrl(
      document.cloudStoragePath,
      document.cloudProvider,
      300 // 5 minutes = 300 seconds
    );

    console.log("[Secure URL] Generated URL:", {
      cloudStoragePath: document.cloudStoragePath,
      cloudProvider: document.cloudProvider,
      secureUrl: secureUrl,
    });

    // Log successful file access
    await prisma.auditLog.create({
      data: {
        documentId,
        userId,
        action: AuditAction.FILE_ACCESSED,
        details: {
          authReason,
          documentTitle: document.title,
          accessedBy: session.user.email,
          expiresIn: 300,
        },
        ipAddress,
        userAgent,
      },
    });

    console.log("[Secure URL] Generated successfully:", {
      documentId,
      userId,
      authReason,
      expiresIn: 300,
    });

    return NextResponse.json({
      url: secureUrl,
      expiresIn: 300, // seconds
      message: "Secure URL generated successfully",
    });
  } catch (error: any) {
    console.error("[Secure URL] Error:", error);
    return NextResponse.json(
      {
        error: "Server error",
        code: "INTERNAL_ERROR",
        message: error?.message || "Failed to generate secure URL",
      },
      { status: 500 }
    );
  }
}
