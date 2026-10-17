import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/storage";
import * as path from "path";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/auth";
import { verifyFileQuery } from "@/lib/file-links";

/**
 * May this request read the stored file? Either the link was signed for it (a signer's viewer,
 * see lib/file-links), or the signed-in person sent the document, made the template, or is an admin.
 */
async function allowed(request: NextRequest, filePath: string, resolvedPath: string): Promise<boolean> {
  const q = request.nextUrl.searchParams;
  if (verifyFileQuery(filePath, q.get("exp"), q.get("sig"))) return true;
  const session = await getServerSession();
  if (!session) return false;
  if (session.user.role === "ADMIN") return true;
  const paths = [...new Set([filePath, resolvedPath, `/${filePath}`, `/${resolvedPath}`])];
  const doc = await prisma.document.findFirst({
    where: { senderId: session.user.id, OR: [{ cloudStoragePath: { in: paths } }, { signedDocumentPath: { in: paths } }] },
    select: { id: true },
  });
  if (doc) return true;
  const tpl = await prisma.template.findFirst({
    where: { cloudStoragePath: { in: paths }, OR: [{ creatorId: session.user.id }, { isPublic: true }] },
    select: { id: true },
  });
  return Boolean(tpl);
}

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

    if (!(await allowed(request, filePath, resolvedPath))) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
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
