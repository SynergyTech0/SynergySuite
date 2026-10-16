import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Allocate the next issue key on a board (SYN-124). The increment is a single UPDATE ... RETURNING,
 * so two cards created at once can never share a key.
 */
export async function nextIssueKey(boardId: string, tx: Tx | typeof db = db): Promise<string | null> {
  const [b] = await tx.update(boards).set({ seq: sql`${boards.seq} + 1` }).where(eq(boards.id, boardId)).returning();
  return b ? `${b.keyPrefix}-${b.seq}` : null;
}
