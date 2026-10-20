import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { listTranscripts, transcribeEveryMeeting } from "@/lib/transcripts";

export const dynamic = "force-dynamic";

/** Transcripts of meetings the signed-in person was in, hosted, or was invited to. */
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Sign in to see transcripts" }, { status: 401 });
  return NextResponse.json({ always: transcribeEveryMeeting(), transcripts: await listTranscripts(session.user.email) });
}
