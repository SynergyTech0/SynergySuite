import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

// Node runtime: mammoth converts an uploaded Word .docx into clean HTML that the
// editor loads. Our free, de-branded "Open Word document".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "no file" }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const result = await mammoth.convertToHtml({ buffer });
    return NextResponse.json({ html: result.value });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
