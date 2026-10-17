import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { scrubInvisible } from "@/lib/ai/visible-text";
import { documentForOwner, isDenied } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * HMAC Signer for secure inference calls
 */
function signPayload(payload: string) {
  const secret = process.env.INFERENCE_HMAC_SECRET!;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Call to remote inference server (IO.net GPU)
 */
async function inferenceCall(endpoint: string, body: any) {
  const url = process.env.INFERENCE_API_URL || "http://localhost:8000";
  const json = JSON.stringify(body);
  const signature = signPayload(json);

  const res = await fetch(`${url}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-synergy-signature": signature,
    },
    body: json,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Inference error: ${text}`);
  }

  return res.json();
}

/**
 * The PDF's VISIBLE text only. pdf-parse returned the whole text layer, including text a reader
 * cannot see (white, invisible, covered, invisible Unicode), straight into a model prompt.
 */
async function visiblePdfText(buffer: Buffer): Promise<string> {
  const { extractLayout } = await import("@/lib/ai/extract");
  return (await extractLayout(buffer)).text;
}

export async function POST(request: NextRequest) {
  try {
    //
    // 1️⃣ AUTH
    //
    const session = await getServerSession(authOptions);
    let userId = session?.user?.id ?? null;


    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    //
    // 2️⃣ Input
    //
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentId = formData.get("documentId") as string | null;

    if (!file && !documentId) {
      return NextResponse.json(
        { error: "Provide a file or a documentId" },
        { status: 400 }
      );
    }

    //
    // 3️⃣ Extract Text from PDF
    //
    if (documentId) {
      const __owner = await documentForOwner(documentId);
      if (isDenied(__owner)) return __owner.denied;
    }

    let text = "";

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      text = (await visiblePdfText(buffer)).slice(0, 15000);
    } else {
      const doc = await prisma.document.findUnique({
        where: { id: documentId! },
      });

      if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      text = `
Title: ${scrubInvisible(doc.title).text}
Description: ${scrubInvisible(doc.description ?? "").text}
(No stored PDF content)
`;
    }

    //
    // 4️⃣ Build inference request
    //
    const prompt = `
You are an AI specialized in PDF signature-field detection.

Given the text of a document, produce JSON describing expected form fields.
Field types include:
- signature
- date
- initials
- printed_name
- address
- checkbox
- email
- phone

Your JSON MUST follow this structure:

[
  {
    "label": "Signature",
    "type": "signature",
    "page": 1,
    "x": 100,
    "y": 600,
    "width": 200,
    "height": 40
  }
]

Notes:
- Return JSON ONLY. No markdown.
- If coordinates are unknown, estimate relative ordering.
- Use page=1 if unknown.
- Prefer "signature", "date", "initials" as types.
- Ensure valid JSON array, no trailing commas.

Document text:
${text}
    `;

    //
    // 5️⃣ GPU Inference call
    //
    const response = await inferenceCall("/fields", { prompt });

    let fields = [];
    try {
      fields = JSON.parse(response?.result ?? "[]");
    } catch {
      fields = [];
    }

    //
    // 6️⃣ Save to DB
    //
    let updatedDoc = null;

    if (documentId) {
      updatedDoc = await prisma.document.update({
        where: { id: documentId! },
        data: {
          suggestedFields: fields,
          aiDetectedAt: new Date(),
        },
      });
    }

    //
    // 7️⃣ Return
    //
    return NextResponse.json({
      success: true,
      fields,
      raw: response,
      document: updatedDoc,
    });
  } catch (error) {
    console.error("FIELD DETECTION ERROR:", error);
    return NextResponse.json(
      {
        error: "Field detection failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
