import { NextResponse, type NextRequest } from "next/server";
import { inlineType, readSharedBytes } from "@/lib/store";

type Ctx = { params: Promise<{ token: string }> };

/** The shared file's bytes, for anyone holding the link. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  const shared = await readSharedBytes(token);
  if (!shared) return NextResponse.json({ error: "This link isn't shared any more" }, { status: 404 });
  const type = inlineType(shared.file.name);
  return new NextResponse(new Uint8Array(shared.bytes), {
    headers: {
      "Content-Type": type ?? "application/octet-stream",
      "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(shared.file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "X-Robots-Tag": "noindex",
    },
  });
}
