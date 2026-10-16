/**
 * Record, on the document's audit trail, that its PDF carried text a reader cannot see.
 *
 * The text itself never reached the model (see visible-text.ts). This is the evidence for the
 * sender and for anyone reviewing the document later: how much, why it was hidden, on which pages,
 * and a few samples of what it said (often an instruction aimed at the AI). The samples are for
 * humans — nothing reads this log back into a prompt, and nothing may.
 */
import { prisma } from "@/lib/db";
import { describeHiddenText, HIDDEN_REASONS, type HiddenTextReport } from "./visible-text";

export async function auditHiddenText(documentId: string, report: HiddenTextReport | undefined, userId?: string | null) {
  if (!report?.chars) return;
  try {
    await prisma.auditLog.create({
      data: {
        documentId,
        userId: userId ?? null,
        action: "DOCUMENT_UPDATED",
        details: {
          event: "hidden_text_detected",
          message: describeHiddenText(report),
          chars: report.chars,
          byReason: Object.fromEntries(HIDDEN_REASONS.filter((r) => report.byReason[r]).map((r) => [r, report.byReason[r]])),
          pages: report.pages,
          ocrLayerOnly: report.ocrLayerOnly,
          samples: report.samples,
          checks: report.checks,
        },
      },
    });
  } catch (e) {
    // The analysis already excluded the text; a failed log write must not fail the request, but it
    // must not vanish either.
    console.error(`[hidden-text] audit log write failed for document ${documentId}:`, e);
  }
}
