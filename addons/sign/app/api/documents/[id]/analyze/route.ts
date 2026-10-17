import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFileBuffer } from "@/lib/storage";
import { analyzeDocument } from "@/lib/ai/analyze";
import { AiUnavailableError, isAiConfigured } from "@/lib/ai/client";
import { auditHiddenText } from "@/lib/ai/hidden-text-audit";
import { documentForOwner, isDenied } from "@/lib/access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/documents/[id]/analyze — read the stored analysis (cheap; no model call).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const __owner = await documentForOwner(id);
  if (isDenied(__owner)) return __owner.denied;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, senderId: true, aiFullAnalysis: true, aiDetectedAt: true },
  });
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (document.senderId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Stored JSON-encoded (String column). A malformed value must not 500 the editor.
  let analysis: unknown = null;
  if (document.aiFullAnalysis) {
    try {
      analysis = JSON.parse(document.aiFullAnalysis);
    } catch {
      analysis = null;
    }
  }

  return NextResponse.json({
    analysis,
    analyzedAt: document.aiDetectedAt,
    available: isAiConfigured(),
  });
}

/**
 * POST /api/documents/[id]/analyze — (re)run document intelligence WITHOUT touching fields.
 *
 * Use this for the insights panel: classification, plain-English summary, parties, and compliance
 * risks. Field creation lives at POST /api/documents/[id]/fields so that analysing a document can
 * never silently rewrite work a user has already done on it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const __owner = await documentForOwner(id);
  if (isDenied(__owner)) return __owner.denied;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (document.senderId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const pdf = await getFileBuffer(document.cloudStoragePath, document.cloudProvider);
    const analysis = await analyzeDocument(pdf);

    await prisma.document.update({
      where: { id },
      data: {
        summary: analysis.summary,
        aiSummary: analysis.summary,
        aiKeywords: analysis.keywords,
        aiDetectedAt: new Date(),
        aiAnalysis: analysis.documentType,             // String column
        aiFullAnalysis: JSON.stringify(analysis),      // String column — full result
        suggestedFields: analysis.suggestedFields as any,
      },
    });
    // The PDF hid text from its reader: it was kept out of the analysis; say so on the record.
    await auditHiddenText(id, analysis.hiddenText, session.user.id);

    return NextResponse.json({ success: true, analysis });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 },
    );
  }
}
