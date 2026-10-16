/**
 * Training Data Export API
 * GET /api/admin/training-data - Export field corrections for ML training
 *
 * Query params:
 * - format: "json" | "csv" (default: json)
 * - limit: number (default: 1000)
 * - offset: number (default: 0)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Auth check - only admins can export training data
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (user?.role !== "ADMIN" && user?.role !== "SYSTEM_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    const limit = Math.min(parseInt(searchParams.get("limit") || "1000"), 10000);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Fetch corrections with related document info
    const corrections = await prisma.fieldCorrection.findMany({
      take: limit,
      skip: offset,
      orderBy: { correctedAt: "desc" },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            originalFileName: true,
          },
        },
        field: {
          select: {
            detectionMethod: true,
          },
        },
      },
    });

    // Get total count for pagination
    const totalCount = await prisma.fieldCorrection.count();

    // Format training data for ML pipeline
    const trainingData = corrections.map((c) => ({
      // Identifiers
      correctionId: c.id,
      documentId: c.documentId,
      fieldId: c.fieldId,
      documentTitle: c.document?.title || "",
      documentFileName: c.document?.originalFileName || "",
      detectionMethod: c.field?.detectionMethod || "UNKNOWN",

      // Original OCR detection
      original: {
        fieldType: c.originalFieldType,
        label: c.originalLabel,
        x: c.originalX,
        y: c.originalY,
        width: c.originalWidth,
        height: c.originalHeight,
        confidence: c.ocrConfidence,
        ocrText: c.ocrSourceText,
      },

      // Human-corrected values
      corrected: {
        fieldType: c.correctedFieldType,
        label: c.correctedLabel,
        x: c.correctedX,
        y: c.correctedY,
        width: c.correctedWidth,
        height: c.correctedHeight,
      },

      // Delta (for analyzing common corrections)
      delta: {
        positionShiftX: c.correctedX - c.originalX,
        positionShiftY: c.correctedY - c.originalY,
        widthChange: c.correctedWidth - c.originalWidth,
        heightChange: c.correctedHeight - c.originalHeight,
        typeChanged: c.correctedFieldType !== c.originalFieldType,
        labelChanged: c.correctedLabel !== c.originalLabel,
      },

      // Metadata
      correctedAt: c.correctedAt.toISOString(),
      correctedBy: c.correctedBy,
    }));

    // Return based on format
    if (format === "csv") {
      const csvHeader = [
        "correctionId",
        "documentId",
        "fieldId",
        "detectionMethod",
        "original_fieldType",
        "original_label",
        "original_x",
        "original_y",
        "original_width",
        "original_height",
        "original_confidence",
        "corrected_fieldType",
        "corrected_label",
        "corrected_x",
        "corrected_y",
        "corrected_width",
        "corrected_height",
        "delta_x",
        "delta_y",
        "delta_width",
        "delta_height",
        "typeChanged",
        "labelChanged",
        "correctedAt",
      ].join(",");

      const csvRows = trainingData.map((t) =>
        [
          t.correctionId,
          t.documentId,
          t.fieldId,
          t.detectionMethod,
          t.original.fieldType,
          `"${t.original.label.replace(/"/g, '""')}"`,
          t.original.x,
          t.original.y,
          t.original.width,
          t.original.height,
          t.original.confidence || "",
          t.corrected.fieldType,
          `"${t.corrected.label.replace(/"/g, '""')}"`,
          t.corrected.x,
          t.corrected.y,
          t.corrected.width,
          t.corrected.height,
          t.delta.positionShiftX,
          t.delta.positionShiftY,
          t.delta.widthChange,
          t.delta.heightChange,
          t.delta.typeChanged,
          t.delta.labelChanged,
          t.correctedAt,
        ].join(",")
      );

      const csv = [csvHeader, ...csvRows].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="training-data-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    // JSON format (default)
    return NextResponse.json({
      success: true,
      meta: {
        total: totalCount,
        limit,
        offset,
        exportedAt: new Date().toISOString(),
      },
      data: trainingData,
    });
  } catch (error: any) {
    console.error("Training data export error:", error);
    return NextResponse.json(
      { error: "Failed to export training data", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/training-data/stats
 * Get statistics about collected training data
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { role: true },
    });

    if (user?.role !== "ADMIN" && user?.role !== "SYSTEM_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Aggregate statistics
    const [
      totalCorrections,
      correctionsByType,
      correctionsByMethod,
      recentCorrections,
    ] = await Promise.all([
      // Total count
      prisma.fieldCorrection.count(),

      // By field type change
      prisma.fieldCorrection.groupBy({
        by: ["originalFieldType", "correctedFieldType"],
        _count: true,
      }),

      // By detection method
      prisma.$queryRaw`
        SELECT df."detectionMethod", COUNT(fc.id)::int as count
        FROM field_corrections fc
        JOIN document_fields df ON fc."fieldId" = df.id
        GROUP BY df."detectionMethod"
      ` as Promise<Array<{ detectionMethod: string; count: number }>>,

      // Last 7 days trend
      prisma.fieldCorrection.groupBy({
        by: ["correctedAt"],
        _count: true,
        orderBy: { correctedAt: "desc" },
        take: 7,
      }),
    ]);

    // Calculate average position corrections
    const avgDeltas = await prisma.fieldCorrection.aggregate({
      _avg: {
        originalX: true,
        originalY: true,
        correctedX: true,
        correctedY: true,
      },
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalCorrections,
        correctionsByFieldType: correctionsByType,
        correctionsByDetectionMethod: correctionsByMethod,
        averagePositionDelta: {
          x: (avgDeltas._avg.correctedX || 0) - (avgDeltas._avg.originalX || 0),
          y: (avgDeltas._avg.correctedY || 0) - (avgDeltas._avg.originalY || 0),
        },
        recentActivity: recentCorrections,
      },
    });
  } catch (error: any) {
    console.error("Training stats error:", error);
    return NextResponse.json(
      { error: "Failed to get training stats", details: error.message },
      { status: 500 }
    );
  }
}
