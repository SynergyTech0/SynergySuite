import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Streams a local PDF or other file from the uploads directory.
 * Example: GET /api/files/SynergyTech_EmploymentAgreement_MichaelUtz_Letterhead.pdf
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ filename: string }>}
) {
  try {
    console.log("🗂️ Requested file:", ((await context.params).filename));
    
    // Construct absolute path to file under /uploads/
    const filePath = path.join(process.cwd(), "uploads", ((await context.params).filename));

    if (!fs.existsSync(filePath)) {
      return new NextResponse("File not found", { status: 404 });
    }

    const fileBuffer = await fs.promises.readFile(filePath);

    // Basic MIME detection
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".txt"
        ? "text/plain"
        : ext === ".docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${((await context.params).filename)}"`,
      },
    });
  } catch (err) {
    console.error("❌ File serve error:", err);
    return new NextResponse("Error reading file", { status: 500 });
  }
}
