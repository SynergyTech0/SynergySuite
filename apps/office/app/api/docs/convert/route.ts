import { NextRequest, NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { convertLocally, localOffice, sniffFormat, type OutFormat } from "@/lib/office-convert";

// Node runtime: other word-processor formats through a local LibreOffice.
// POST a file with ?to=docx (an .odt, .rtf or .doc to open) or ?to=odt|rtf
// (our .docx to download in that format). GET: whether conversion is
// available. 503 when LibreOffice is not installed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 40 * 1024 * 1024;
const TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
};

export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ available: !!localOffice() });
}

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const bin = localOffice();
  if (!bin) return NextResponse.json({ error: "Converting other formats needs LibreOffice on the server." }, { status: 503 });
  const to = req.nextUrl.searchParams.get("to") as OutFormat;
  if (!(to === "docx" || to === "odt" || to === "rtf")) return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (Number(req.headers.get("content-length") || 0) > MAX) return NextResponse.json({ error: "too large" }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (bytes.length > MAX) return NextResponse.json({ error: "too large" }, { status: 413 });
  const from = sniffFormat(bytes);
  // opening: OpenDocument, RTF or Word 97-2003; saving: our own .docx
  if (!from || (to === "docx" ? from === "docx" : from !== "docx")) return NextResponse.json({ error: "That file is not a supported document." }, { status: 415 });
  try {
    const out = await convertLocally(bin, bytes, from, to);
    return new NextResponse(Buffer.from(out), { headers: { "Content-Type": TYPES[to] } });
  } catch (e) {
    return NextResponse.json({ error: "The file could not be converted.", detail: (e as Error).message }, { status: 422 });
  }
}
