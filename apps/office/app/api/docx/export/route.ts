import { NextRequest, NextResponse } from "next/server";
import HTMLtoDOCX from "html-to-docx";

// Runs in Node (html-to-docx needs Buffer/streams). Turns the editor's HTML
// into a real Word .docx — our free, de-branded "Save as Word".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { html, title } = (await req.json()) as { html?: string; title?: string };
  const body = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html ?? ""}</body></html>`;
  const out = await HTMLtoDOCX(body, null, { table: { row: { cantSplit: true } }, footer: false });
  const buf: Buffer = Buffer.isBuffer(out) ? out : Buffer.from(await (out as Blob).arrayBuffer());
  const name = (title || "document").replace(/[^\w.\- ]+/g, "").slice(0, 80) || "document";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name}.docx"`,
    },
  });
}
