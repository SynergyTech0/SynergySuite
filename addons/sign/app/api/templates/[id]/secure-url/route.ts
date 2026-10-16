import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFileDownloadUrl } from "@/lib/storage";
import { AuditAction } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * @route GET /api/templates/[id]/secure-url
 * @description Generate a short-lived, secure URL for template access
 * @security Validates user permissions before generating URL
 * @returns { url: string, expiresIn: number } - Secure URL valid for 5 minutes
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templateId } = await context.params;
    const session = await getServerSession(authOptions);

    // Get requester IP and User Agent for audit logging
    const ipAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    console.log("[Secure URL] Request for template:", {
      templateId,
      userId: session?.user?.id,
      ipAddress,
    });

    // Validate session exists
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          code: "NO_SESSION",
          message: "You must be logged in to access templates.",
        },
        { status: 401 }
      );
    }

    // Fetch template with authorization details
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      include: {
        creator: true,
      },
    });

    // Validate template exists
    if (!template) {
      console.log("[Secure URL] Template not found:", templateId);
      return NextResponse.json(
        {
          error: "Not found",
          code: "TEMPLATE_NOT_FOUND",
          message: "The requested template does not exist.",
        },
        { status: 404 }
      );
    }

    // Authorization Logic for Templates
    const userId = session.user.id;
    const userRole = session.user.role;
    let authorized = false;
    let authReason = "";

    // 1. Template creator can always access
    if (template.creatorId === userId) {
      authorized = true;
      authReason = "Template creator";
    }
    // 2. Admins can access all templates
    else if (userRole === "ADMIN" || userRole === "SYSTEM_ADMIN") {
      authorized = true;
      authReason = "Admin access";
    }

    if (!authorized) {
      console.log("[Secure URL] Access denied:", {
        templateId,
        userId,
        reason: "User not authorized",
      });

      // Audit log for denied access
      await prisma.auditLog.create({
        data: {
          userId,
          action: AuditAction.DOCUMENT_ACCESS_DENIED,
          details: {
            resourceType: "template",
            templateId,
            templateName: template.name,
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
          message: "You do not have permission to access this template.",
        },
        { status: 403 }
      );
    }

    // Generate secure URL (5-minute expiry)
    const secureUrl = await getFileDownloadUrl(
      template.cloudStoragePath,
      template.cloudProvider,
      300 // 5 minutes = 300 seconds
    );

    // Audit log for successful file access
    await prisma.auditLog.create({
      data: {
        userId,
        action: AuditAction.FILE_ACCESSED,
        details: {
          resourceType: "template",
          templateId,
          templateName: template.name,
          authReason,
          accessedBy: session.user.email,
          expiresIn: 300,
        },
        ipAddress,
        userAgent,
      },
    });

    console.log("[Secure URL] Generated successfully for template:", {
      templateId,
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
