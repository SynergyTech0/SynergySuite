import { NextRequest, NextResponse } from "next/server";
import HTMLtoDOCX from "html-to-docx";
import { identity } from "@/lib/identity";
import { convertLocally, localOffice } from "@/lib/office-convert";

// Node runtime: turn a document into a PDF. The Docs editor sends its own
// .docx (styles, sections, headers and footers, notes, fields and pictures
// already laid out as Word would), so the PDF matches the .docx download;
// a JSON body { html } is still accepted and converted to .docx first.
// The conversion is the shared docx2pdf service (LibreOffice-backed) when it
// is configured, else a local LibreOffice when one is installed; otherwise
// 503 and the client falls back to the browser's print-to-PDF.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX = 60 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = process.env.DOCX2PDF_URL;
  const token = process.env.DOCX2PDF_TOKEN;
  const local = url && token ? null : localOffice();
  if (!(url && token) && !local) return NextResponse.json({ error: "pdf-service-unconfigured" }, { status: 503 });

  let bytes: Uint8Array;
  let title = req.nextUrl.searchParams.get("title") || "document";
  if ((req.headers.get("content-type") || "").startsWith(DOCX)) {
    if (Number(req.headers.get("content-length") || 0) > MAX) return NextResponse.json({ error: "too large" }, { status: 413 });
    bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return NextResponse.json({ error: "empty" }, { status: 400 });
    if (bytes.length > MAX) return NextResponse.json({ error: "too large" }, { status: 413 });
  } else {
    const j = (await req.json().catch(() => ({}))) as { html?: string; title?: string };
    if (!j.html) return NextResponse.json({ error: "empty" }, { status: 400 });
    if (j.title) title = j.title;
    const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${j.html}</body></html>`;
    const docx = (await HTMLtoDOCX(body, null, { table: { row: { cantSplit: true } }, footer: false, pageNumber: false })) as ArrayBuffer | Buffer;
    bytes = docx instanceof ArrayBuffer ? new Uint8Array(docx) : new Uint8Array(docx as Buffer);
  }

  const headers = { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${title.replace(/[^\w.-]+/g, "_")}.pdf"` };
  try {
    if (local) return new NextResponse(Buffer.from(await convertLocally(local, bytes, "docx", "pdf")), { headers });
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: DOCX }), "doc.docx");
    const res = await fetch(`${url!.replace(/\/$/, "")}/convert`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!res.ok) return NextResponse.json({ error: "convert-failed", status: res.status }, { status: 502 });
    return new NextResponse(await res.arrayBuffer(), { headers });
  } catch (e) {
    return NextResponse.json({ error: "pdf-service-unreachable", detail: (e as Error).message }, { status: 502 });
  }
}
