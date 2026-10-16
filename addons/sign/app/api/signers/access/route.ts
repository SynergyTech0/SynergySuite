import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuditAction } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * @route GET /api/signers/access?token=xxx
 * @returns Document data with signer info or error response
 */

export async function GET(req: Request) {
  try {
    // Extract token and client info
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const ipAddress =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    console.log("[Secure Access] Token validation request:", {
      token: token?.substring(0, 10) + "...",
      ipAddress,
    });

    // Validate token presence
    if (!token) {
      return NextResponse.json(
        {
          error: "Missing token",
          code: "MISSING_TOKEN",
          message: "A valid token is required to access this document.",
        },
        { status: 400 },
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
            description: true,
            cloudStoragePath: true,
            cloudProvider: true,
            status: true,
            signingOrder: true,
            deadline: true,
            completedAt: true,
            senderId: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Handle invalid token
    if (!signer) {
      console.log("[Secure Access] Invalid token provided");
      return NextResponse.json(
        {
          error: "Invalid token",
          code: "INVALID_TOKEN",
          message:
            "The provided token is not valid. Please check your invitation link.",
        },
        { status: 404 },
      );
    }

    // Check if token has expired
    if (signer.tokenExpiresAt && new Date() > new Date(signer.tokenExpiresAt)) {
      console.log("[Secure Access] Expired token:", {
        token: token.substring(0, 10) + "...",
        expiresAt: signer.tokenExpiresAt,
      });

      return NextResponse.json(
        {
          error: "Token expired",
          code: "TOKEN_EXPIRED",
          message:
            "This invitation link has expired. Please contact the document sender for a new link.",
          expiresAt: signer.tokenExpiresAt,
        },
        { status: 403 },
      );
    }

    // Validate document exists
    if (!signer.document) {
      console.log("[Secure Access] Document not found for signer:", signer.id);
      return NextResponse.json(
        {
          error: "Document not found",
          code: "DOCUMENT_NOT_FOUND",
          message: "The associated document could not be found.",
        },
        { status: 404 },
      );
    }

    // Check if document has been declined by this signer
    if (signer.status === "DECLINED") {
      return NextResponse.json(
        {
          error: "Document declined",
          code: "DOCUMENT_DECLINED",
          message: "You have already declined to sign this document.",
          declinedAt: signer.declinedAt,
        },
        { status: 403 },
      );
    }

    // Check if document has expired (if deadline is set)
    if (
      signer.document.deadline &&
      new Date() > new Date(signer.document.deadline)
    ) {
      return NextResponse.json(
        {
          error: "Document expired",
          code: "DOCUMENT_EXPIRED",
          message: "This document has passed its signing deadline.",
          deadline: signer.document.deadline,
        },
        { status: 403 },
      );
    }

    // Fetch all signers for the document (for display purposes)
    const allSigners = await prisma.documentSigner.findMany({
      where: { documentId: signer.document.id },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        order: true,
        signedAt: true,
      },
      orderBy: { order: "asc" },
    });

    // Check sequential signing order - if sequential, verify if it's this signer's turn
    if (signer.document.signingOrder === "SEQUENTIAL") {
      const currentSignerIndex = allSigners.findIndex(
        (s) => s.id === signer.id,
      );

      // Check if any previous signers haven't completed yet
      for (let i = 0; i < currentSignerIndex; i++) {
        if (allSigners[i].status !== "COMPLETED") {
          return NextResponse.json(
            {
              error: "Not your turn",
              code: "SEQUENTIAL_ORDER_NOT_MET",
              message:
                "This document requires sequential signing. Please wait for the previous signer to complete.",
              waitingFor: allSigners[i].name,
            },
            { status: 403 },
          );
        }
      }
    }

    // Create audit log entry for document access
    await prisma.auditLog.create({
      data: {
        documentId: signer.document.id,
        documentSignerId: signer.id,
        userId: signer.userId,
        action: AuditAction.DOCUMENT_VIEWED,
        details: {
          signerEmail: signer.email,
          signerName: signer.name,
          accessedAt: new Date().toISOString(),
        },
        ipAddress,
        userAgent,
      },
    });

    console.log("[Secure Access] Document accessed successfully:", {
      documentId: signer.document.id,
      signerId: signer.id,
      ipAddress,
    });

    // file access will be handled via secure token-based endpoints
    const result = {
      success: true,
      signer: {
        id: signer.id,
        name: signer.name,
        email: signer.email,
        status: signer.status,
        order: signer.order,
        signedAt: signer.signedAt,
      },
      document: {
        id: signer.document.id,
        title: signer.document.title,
        description: signer.document.description,
        // cloudStoragePath: REMOVED for security
        // cloudStoragePath: signer.document.cloudStoragePath,
        // provider: REMOVED for security
        // provider: signer.document.cloudProvider,
        status: signer.document.status,
        signingOrder: signer.document.signingOrder,
        deadline: signer.document.deadline,
        completedAt: signer.document.completedAt,
      },
      allSigners: allSigners.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        order: s.order,
        signedAt: s.signedAt,
      })),
      tokenValid: true,
      tokenExpiresAt: signer.tokenExpiresAt,
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Secure Access] Error:", err);
    return NextResponse.json(
      {
        error: "Server error",
        code: "INTERNAL_ERROR",
        message:
          err?.message ||
          "An unexpected error occurred while accessing the document.",
      },
      { status: 500 },
    );
  }
}
