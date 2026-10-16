import { NextResponse } from "next/server";
import { boardActivity } from "@/lib/activity";
import { notFound, requireBoard } from "@/lib/authz";

// GET /api/boards/[id]/activity?limit=50&before=<iso> — the board's activity feed, newest first.
// Reading history needs only visibility, so observers see it too.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();

  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const beforeDate = before ? new Date(before) : null;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) {
    return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 });
  }
  const limit = Number(url.searchParams.get("limit")) || undefined;

  return NextResponse.json(await boardActivity(id, { limit, before: beforeDate }));
}
