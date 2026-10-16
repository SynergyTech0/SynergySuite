import { NextResponse } from "next/server";
import { JqlError, parseJql } from "@/lib/jql";
import { runJql } from "@/lib/jql-sql";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound, visibleBoardIds } from "@/lib/authz";

/**
 * GET /api/search/jql?q=<query>&limit=<n> — search every board the caller can see.
 *
 * A malformed query is a 400 with the parser's message (so the box can show what is wrong), never a
 * 500. The board scope is applied in runJql and cannot be widened by the query.
 */
export async function GET(req: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit")) || 100;

  try {
    const query = parseJql(q);
    const cards = await runJql(query, { userId: user.id }, await visibleBoardIds(user.id), limit);
    return NextResponse.json({ cards, count: cards.length });
  } catch (err) {
    if (err instanceof JqlError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
