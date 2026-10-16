import { db, pool } from "./index";
import { users, workspaces, workspaceMembers, boards, boardMembers, lists, cards } from "./schema";

async function main() {
  const [mind] = await db.insert(users)
    .values({ name: "Synergy Mind", isMind: true, email: "mind@localhost" })
    .onConflictDoNothing().returning();
  const [ws] = await db.insert(workspaces).values({ name: "Synergy", slug: "synergy" }).returning();
  const [board] = await db.insert(boards).values({ workspaceId: ws.id, title: "Synergy Dev" }).returning();
  if (mind) await db.insert(boardMembers).values({ boardId: board.id, userId: mind.id, role: "member" });

  const listRows = await db.insert(lists).values([
    { boardId: board.id, title: "Backlog", position: 1024 },
    { boardId: board.id, title: "In Progress", position: 2048 },
    { boardId: board.id, title: "Review", position: 3072 },
    { boardId: board.id, title: "Done", position: 4096 },
  ]).returning();
  const [backlog, , review] = listRows;

  await db.insert(cards).values([
    { listId: backlog.id, boardId: board.id, title: "Wire SynergyBoards to SynergyAuth SSO", position: 1024 },
    { listId: backlog.id, boardId: board.id, title: "Realtime WebSocket sync (Phase 2)", position: 2048 },
    { listId: review.id, boardId: board.id, title: "Fixed asyncpg bug in SynergyDrive", position: 1024,
      origin: "mind", mindRef: "code-review", createdBy: mind?.id,
      description: "The mind flagged this from a code review." },
  ]);

  console.log(`seeded: workspace ${ws.slug}, board "${board.title}" (${board.id})`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
