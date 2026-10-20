import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { asText, getTranscript } from "@/lib/transcripts";

export const dynamic = "force-dynamic";

/** One transcript with its lines; ?format=txt downloads it as text (&tz= for the reader's clock). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Sign in to see transcripts" }, { status: 401 });
  const t = await getTranscript(session.user.email, (await params).id);
  if (!t) return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  const u = new URL(req.url).searchParams;
  if (u.get("format") === "txt") {
    let tz = u.get("tz") || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      tz = "UTC";
    }
    const file = `${t.title.replace(/[^\w .-]+/g, "").trim() || "meeting"} transcript.txt`;
    return new Response(asText(t, t.segments_list, tz), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
    });
  }
  return NextResponse.json(t);
}
