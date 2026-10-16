import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFileBuffer } from "@/lib/storage";
import { analyzeDocument } from "@/lib/ai/analyze";
import { AiUnavailableError, isAiConfigured } from "@/lib/ai/client";
import { auditHiddenText } from "@/lib/ai/hidden-text-audit";

/**
 * GET: all fields for a document.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const fields = await prisma.documentField.findMany({ where: { documentId: id } });
    return NextResponse.json({ fields });
  } catch (error) {
    console.error("Error fetching fields:", error);
    return NextResponse.json({ error: "Failed to fetch fields" }, { status: 500 });
  }
}

/**
 * POST: AI field detection.
 *
 * What this used to do: run Tesseract over the page, THROW THE RESULT AWAY, and insert two
 * hardcoded fields — SIGNATURE at (100,600) and DATE at (350,600) — regardless of the document.
 * That is what was shipped as "AI-powered field detection".
 *
 * What it does now: read the PDF through the storage layer, extract the real text layout with
 * coordinates, and ask the AI model where each party actually has to sign. Fields land on the document's
 * real signature lines, are attributed to detected parties, and carry a confidence + the text that
 * justified them. If the model is unavailable we return an error — we do NOT invent fields.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const document = await prisma.document.findUnique({
      where: { id },
      include: { signers: { orderBy: { order: "asc" } } },
    });
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!isAiConfigured()) {
      return NextResponse.json(
        {
          error: "Document intelligence is not configured (AI_API_KEY or AI_MODEL missing).",
          hint: "Set AI_API_KEY and AI_MODEL to enable AI field detection. Fields can still be placed manually.",
        },
        { status: 503 },
      );
    }

    // Read through storage (never guess a filesystem path — that bug silently broke finalization).
    const pdf = await getFileBuffer(document.cloudStoragePath, document.cloudProvider);

    const analysis = await analyzeDocument(pdf);

    // Map each suggested field's partyRole onto a real signer, when signers already exist.
    // Order matters: the model reports signingOrder, so role N maps to the Nth signer.
    const roleToSigner = new Map<string, string>();
    analysis.parties.forEach((party) => {
      const byName = document.signers.find(
        (s) => party.name && s.name.toLowerCase() === party.name.toLowerCase(),
      );
      const byEmail = document.signers.find(
        (s) => party.email && s.email.toLowerCase() === party.email.toLowerCase(),
      );
      const byOrder = document.signers[party.signingOrder - 1];
      const match = byEmail || byName || byOrder;
      if (match) roleToSigner.set(party.role, match.id);
    });

    // Replace any previously AI-detected fields so re-running is idempotent; never touch fields a
    // human placed or edited.
    await prisma.documentField.deleteMany({
      where: { documentId: id, detectionMethod: "AI", value: null },
    });

    const created = await prisma.$transaction(
      analysis.suggestedFields.map((f) =>
        prisma.documentField.create({
          data: {
            documentId: id,
            assignedToId: roleToSigner.get(f.partyRole) ?? null,
            fieldType: f.fieldType,
            label: f.label,
            required: f.required,
            pageNumber: f.pageNumber,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            value: null,
            detectionMethod: "AI",
            confidence: f.confidence,
            ocrSourceText: f.reason,   // the line that justified this placement
            // Keep the model's original geometry so FieldCorrection can learn from user edits.
            originalX: f.x,
            originalY: f.y,
            originalWidth: f.width,
            originalHeight: f.height,
          },
        }),
      ),
    );

    // Persist the document intelligence.
    await prisma.document.update({
      where: { id },
      data: {
        summary: analysis.summary,
        aiSummary: analysis.summary,
        aiKeywords: analysis.keywords,
        aiDetectedAt: new Date(),
        // aiAnalysis / aiFullAnalysis are String columns (only suggestedFields is Json), so the
        // full result is JSON-encoded rather than handed to Prisma as an object.
        aiAnalysis: analysis.documentType,
        aiFullAnalysis: JSON.stringify(analysis),
        suggestedFields: analysis.suggestedFields as any,
      },
    });
    // The PDF hid text from its reader: it was kept out of the analysis; say so on the record.
    await auditHiddenText(id, analysis.hiddenText);

    return NextResponse.json({
      success: true,
      analysis: {
        documentType: analysis.documentType,
        title: analysis.title,
        summary: analysis.summary,
        keywords: analysis.keywords,
        parties: analysis.parties,
        complianceFlags: analysis.complianceFlags,
        effectiveDate: analysis.effectiveDate,
        governingLaw: analysis.governingLaw,
        // Carries `snapped` + `anchorId`, which the DocumentField rows don't have columns for. The
        // UI needs them to distinguish a field bound to a real rule in the PDF from an estimate.
        suggestedFields: analysis.suggestedFields,
        model: analysis.model,
        // Text the PDF hides from a reader, which the model was NOT shown. The UI warns on it.
        hiddenText: analysis.hiddenText,
      },
      createdFields: created,
      unmatchedParties: analysis.parties
        .filter((p) => !roleToSigner.has(p.role))
        .map((p) => ({ role: p.role, name: p.name, email: p.email })),
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Field detection failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Field detection failed" },
      { status: 500 },
    );
  }
}
