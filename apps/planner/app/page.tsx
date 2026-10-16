import { db } from "@/db";
import { boards, boardStars } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getCurrentUserOrNull } from "@/lib/session";
import { visibleBoardIds } from "@/lib/authz";
import { NewBoard } from "./NewBoard";
import { ClosedBoards } from "./ClosedBoards";
import { ImportBoard } from "./ImportBoard";

export const dynamic = "force-dynamic";

type Tile = typeof boards.$inferSelect & { starred: boolean };

function BoardTile({ b }: { b: Tile }) {
  return (
    <a href={`/b/${b.id}`} className="board-tile" style={b.background ? { background: b.background } : undefined}>
      <span className="tiletitle">{b.title}</span>
      <span className="tilemeta">
        <span className="ikey">{b.keyPrefix}</span>
        {b.starred && <span className="tilestar" title="Starred">★</span>}
      </span>
    </a>
  );
}

// Scoped to the caller's boards. This used to select every non-closed board in the table, so the
// index enumerated every tenant — the API was locked down while the page that renders it was not.
export default async function Home() {
  const user = await getCurrentUserOrNull();
  const ids = user ? await visibleBoardIds(user.id) : [];
  const rows: Tile[] = ids.length && user
    ? (await db.select({ board: boards, starredAt: boardStars.createdAt })
        .from(boards)
        .leftJoin(boardStars, and(eq(boardStars.boardId, boards.id), eq(boardStars.userId, user.id)))
        .where(and(eq(boards.isClosed, false), inArray(boards.id, ids)))
        .orderBy(asc(boards.title)))
        .map((r) => ({ ...r.board, starred: r.starredAt !== null }))
    : [];
  const starred = rows.filter((b) => b.starred);

  return (
    <div className="wrap">
      <div className="h1">Boards</div>
      <NewBoard />
      <ImportBoard />
      {starred.length > 0 && (
        <>
          <div className="mlabel" style={{ marginTop: 6 }}>★ Starred</div>
          <div className="boards-grid" style={{ marginBottom: 18 }}>
            {starred.map((b) => <BoardTile key={`s-${b.id}`} b={b} />)}
          </div>
        </>
      )}
      <div className="mlabel">All boards</div>
      <div className="boards-grid">
        {rows.map((b) => <BoardTile key={b.id} b={b} />)}
        {rows.length === 0 && <div style={{ color: "var(--muted)" }}>No boards yet — create one above.</div>}
      </div>
      <ClosedBoards />
    </div>
  );
}
