import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/storage";
import * as path from "path";
import prisma from "@/lib/prisma";
import { CloudProvider } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * 📄 File Server Endpoint
 * Handles:
 *   GET /api/files/[id]
 *
 * Supports:
 *   - Local + Hybrid + S3 storage via getFileBuffer()
 *   - PDF.js range + inline rendering
 *   - CORS for embedded viewers
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  console.log("📁 File request ID:", id);

  if (!id?.length) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }

  const fileId = decodeURIComponent(id);
  console.log("📁 Requested file path:", fileId);

  try {
    const doc = await prisma.document.findFirst({
      where: { id: fileId },
      select: { cloudStoragePath: true, cloudProvider: true },
    });

    if (!doc) {
      console.error("❌ Document record not found for id:", fileId);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    console.log("📁 Retrieved document record:", doc);

    const resolvedPath = doc.cloudStoragePath;
    const provider: CloudProvider = doc.cloudProvider;

    const buffer: Buffer | Error = await getFileBuffer(resolvedPath, provider);
    if (buffer instanceof Error) {
      console.error("❌ Error retrieving file buffer:", buffer.message);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (!buffer || buffer.byteLength === 0) {
      console.error("❌ Empty or invalid buffer for:", resolvedPath);
      return NextResponse.json(
        { error: "File not found or empty" },
        { status: 404 }
      );
    }

    // 🧾 Detect MIME type
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".txt": "text/plain",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    console.log(`✅ Serving ${resolvedPath} (${contentType} from ${provider})`);

    // ✅ Return file for inline viewing (supports PDF.js)
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${path.basename(resolvedPath)}"`,
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type, Authorization",
        "Accept-Ranges": "bytes",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Content-Length": buffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("❌ File serve error:", error);
    return NextResponse.json(
      {
        error: "File not found",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 404 }
    );
  }
}

/**
 * ✅ Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
