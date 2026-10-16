import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, lists, users } from "@/db/schema";
import { notFound, requireBoard } from "@/lib/authz";
import { toCsv } from "@/lib/csv";

/**
 * GET /api/boards/[id]/export — the board as CSV, with the column names Jira's importer recognises,
 * so a board can leave here as easily as it arrived. Archived cards are included with a flag rather
 * than dropped: an export is a backup, and a backup that quietly omits things is not one.
 */
const COLUMNS = ["Key", "Summary", "Description", "Status", "Issue Type", "Priority", "Points",
  "Assignee", "Due Date", "Start Date", "Resolution", "Archived", "Created"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();

  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) return notFound();

  const rows = await db
    .select({ card: cards, list: lists.title, assignee: users.name })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .leftJoin(users, eq(users.id, cards.assigneeId))
    .where(eq(cards.boardId, id))
    .orderBy(asc(lists.position), asc(cards.position));

  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const csv = toCsv(rows.map((r) => ({
    Key: r.card.issueKey ?? "",
    Summary: r.card.title,
    Description: r.card.description ?? "",
    Status: r.list,
    "Issue Type": r.card.issueType,
    Priority: r.card.priority,
    Points: r.card.points ?? "",
    Assignee: r.assignee ?? "",
    "Due Date": day(r.card.dueDate),
    "Start Date": day(r.card.startDate),
    Resolution: r.card.resolution ?? "",
    Archived: r.card.isArchived ? "yes" : "",
    Created: day(r.card.createdAt),
  })), COLUMNS);

  const name = `${board.title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "board"}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
}
