import { NextResponse } from "next/server";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { getCurrentUserOrNull } from "@/lib/session";
import { canSeeBoard, notFound, visibleBoardIds } from "@/lib/authz";
import { SearchInputError } from "@synergy/search";
import { searchBoards, searchUser } from "@/lib/suite-search";

const LIMIT = 50;

/**
 * GET /api/search?q=…&boardId=… — find cards by title or description.
 *
 * Scoped to the boards the caller can actually see. Searching is the easiest place to leak another
 * tenant's data by accident, so the board filter is applied in the query, never after the fact.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const boardId = url.searchParams.get("boardId");

  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  const user = await getCurrentUserOrNull();
  if (!user) return notFound();

  let boardScope: string[];
  if (boardId) {
    if (!(await canSeeBoard(user.id, boardId))) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    boardScope = [boardId];
  } else {
    boardScope = await visibleBoardIds(user.id);
    if (!boardScope.length) return NextResponse.json({ cards: [] });
  }

  const term = `%${q}%`;
  const hits = await db
    .select()
    .from(cards)
    .where(
      and(
        inArray(cards.boardId, boardScope),
        eq(cards.isArchived, false),
        or(ilike(cards.title, term), ilike(cards.description, term), ilike(cards.issueKey, term)),
      ),
    )
    .orderBy(desc(cards.updatedAt))
    .limit(LIMIT);

  return NextResponse.json({ cards: hits });
}

/**
 * POST /api/search — the suite's Search app, on the signed-in person's behalf (SearchQuery →
 * SearchResults from @synergy/search): plans, tasks and comments on the boards they can see.
 */
export async function POST(req: Request) {
  const user = await searchUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await searchBoards(user.id, body));
  } catch (e) {
    if (e instanceof SearchInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
