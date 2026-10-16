import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFileDownloadUrl } from "@/lib/storage";
import { AuditAction } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * @route GET /api/signers/secure-url?token=xxx
 * @description Generate secure URL for signer document access (token-based, no auth required)
 * @security Uses signing token instead of session auth
 * @returns { url: string, expiresIn: number } - Secure URL valid for 5 minutes
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    // Get requester IP and User Agent for audit logging
    const ipAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    console.log("[Signer Secure URL] Request:", {
      token: token?.substring(0, 10) + "...",
      ipAddress,
    });

    // Validate token presence
    if (!token) {
      return NextResponse.json(
        {
          error: "Missing token",
          code: "MISSING_TOKEN",
          message: "A valid token is required to access documents.",
        },
        { status: 400 }
      );
    }

    // Find the signer by token with document details
    const signer = await prisma.documentSigner.findUnique({
      where: { token },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            cloudStoragePath: true,
            cloudProvider: true,
            status: true,
          },
        },
      },
    });

    // Validate token exists
    if (!signer) {
      console.log("[Signer Secure URL] Invalid token");
      return NextResponse.json(
        {
          error: "Invalid token",
          code: "INVALID_TOKEN",
          message: "The provided token is not valid.",
        },
        { status: 404 }
      );
    }

    // Check if token has expired
    if (signer.tokenExpiresAt && new Date() > new Date(signer.tokenExpiresAt)) {
      console.log("[Signer Secure URL] Expired token");
      return NextResponse.json(
        {
          error: "Token expired",
          code: "TOKEN_EXPIRED",
          message: "This invitation link has expired.",
        },
        { status: 403 }
      );
    }

    // Validate document exists
    if (!signer.document) {
      console.log("[Signer Secure URL] Document not found");
      return NextResponse.json(
        {
          error: "Document not found",
          code: "DOCUMENT_NOT_FOUND",
          message: "The associated document could not be found.",
        },
        { status: 404 }
      );
    }

    // Generate secure URL (5-minute expiry)
    const secureUrl = await getFileDownloadUrl(
      signer.document.cloudStoragePath,
      signer.document.cloudProvider,
      300 // 5 minutes
    );

    // Log file access
    await prisma.auditLog.create({
      data: {
        documentId: signer.document.id,
        documentSignerId: signer.id,
        userId: signer.userId,
        action: AuditAction.FILE_ACCESSED,
        details: {
          accessMethod: "signer_token",
          documentTitle: signer.document.title,
          signerEmail: signer.email,
          expiresIn: 300,
        },
        ipAddress,
        userAgent,
      },
    });

    console.log("[Signer Secure URL] Generated successfully:", {
      documentId: signer.document.id,
      signerId: signer.id,
    });

    return NextResponse.json({
      url: secureUrl,
      expiresIn: 300, // seconds
      message: "Secure URL generated successfully",
    });
  } catch (error: any) {
    console.error("[Signer Secure URL] Error:", error);
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
