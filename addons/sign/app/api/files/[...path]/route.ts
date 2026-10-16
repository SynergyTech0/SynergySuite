import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/storage";
import * as path from "path";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await context.params;
  try {
    console.log("🗂️ Requested file path segments:", pathSegments);

    // const filePath = ((await context.params).path).join("/");
    const filePath = pathSegments.join("/").replace(/\\/g, "/");

    // 🧱 Path security
    if (filePath.includes("..") || filePath.includes("~")) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // 🧩 Default to documents/
    let resolvedPath = filePath;
    if (
      !filePath.startsWith("documents/") &&
      !filePath.startsWith("templates/")
    ) {
      resolvedPath = `documents/${filePath}`;
    }

    const buffer = await getFileBuffer(resolvedPath, 'LOCAL');
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

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${path.basename(resolvedPath)}"`,
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*", // 🔥 PDF.js requires this
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type, Authorization",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("❌ File serve error:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

// ✅ Handle preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type, Authorization",
    },
  });
}
