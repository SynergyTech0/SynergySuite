import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verify } from "jsonwebtoken";
import crypto from "crypto";
import { scrubInvisible } from "@/lib/ai/visible-text";

export const dynamic = "force-dynamic";

// -------------------------
// Utils
// -------------------------

/**
 * The PDF's VISIBLE text only. pdf-parse returned the whole text layer, including text a reader
 * cannot see (white, invisible, covered, invisible Unicode), straight into a model prompt.
 */
async function visiblePdfText(buffer: Buffer): Promise<string> {
  const { extractLayout } = await import("@/lib/ai/extract");
  return (await extractLayout(buffer)).text;
}

function signPayload(payload: string) {
  const secret = process.env.INFERENCE_HMAC_SECRET!;
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

async function inferenceCall(endpoint: string, body: any) {
  const url = process.env.INFERENCE_API_URL || "http://localhost:8000";

  const payload = JSON.stringify(body);
  const signature = signPayload(payload);

  const res = await fetch(`${url}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-synergy-signature": signature,
    },
    body: payload,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Inference server error: ${err}`);
  }

  return res.json();
}

// -------------------------
// Main Handler
// -------------------------

export async function POST(request: NextRequest) {
  try {
    let userId: string | null = null;

    // 1️⃣ NextAuth
    const session = await getServerSession(authOptions);
    userId = session?.user?.id ?? null;

    // 2️⃣ Bearer token fallback
    if (!userId) {
      const header = request.headers.get("authorization");
      if (header?.startsWith("Bearer ")) {
        try {
          const token = header.split(" ")[1];
          const decoded: any = verify(token, process.env.NEXTAUTH_SECRET!);
          userId = decoded.userId || decoded.id || null;
        } catch {}
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3️⃣ FormData / Document input
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentId = formData.get("documentId") as string | null;

    if (!file && !documentId) {
      return NextResponse.json(
        { error: "Provide either a file or a documentId" },
        { status: 400 }
      );
    }

    let text = "";

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      // Take up to 15k chars for inference
      text = (await visiblePdfText(buffer)).slice(0, 15000);
    } else {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!doc) {
        return NextResponse.json(
          { error: "Document not found" },
          { status: 404 }
        );
      }

      text = `
Title: ${scrubInvisible(doc.title).text}
Description: ${scrubInvisible(doc.description ?? "").text}
`;
    }

    // 4️⃣ Build inference prompt
    const analysisPrompt = `
Analyze the following document text.
Return a JSON object containing:
- title
- summary
- key_entities
- signers
- critical_dates
- document_type
- recommended_actions

Document text:
${text}
`;

    // 5️⃣ Call remote inference server
    const inferenceResult = await inferenceCall("/summarize", {
      prompt: analysisPrompt,
    });

    const resultText = inferenceResult?.result ?? inferenceResult?.summary ?? "";

    // 6️⃣ Save into DB if needed
    let updatedDoc = null;
    if (documentId) {
      updatedDoc = await prisma.document.update({
        where: { id: documentId },
        data: {
          aiFullAnalysis: resultText,
          aiSummary: resultText.slice(0, 500),
          aiAnalyzedAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      success: true,
      result: resultText,
      raw: inferenceResult,
      document: updatedDoc,
    });
  } catch (err) {
    console.error("Document inference failed:", err);
    return NextResponse.json(
      {
        error: "Document analysis failed",
        details: String(err),
      },
      { status: 500 }
    );
  }
}
