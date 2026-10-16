/**
 * Write a whole board — the shape an import produces, and what a copy passes through — in one
 * transaction, so a half-imported board is never left behind for someone to clean up by hand.
 *
 * Issue keys are allocated here rather than reused from the source: a Jira key belongs to the Jira
 * project it came from, and pretending SYN-14 means the same thing on this instance would make the
 * keys lie. The original key, where there was one, goes in the card's description instead.
 */
import { and, eq, ne, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  boardMembers, boards, cardLabels, cards, checklistItems, checklists, comments, labels, lists,
  workspaceMembers, workspaces,
} from "@/db/schema";
import { uniquePrefixFor } from "@/lib/key-prefix";
import { inferCategory } from "@/lib/workflow";
import type { ImportBoard } from "@/lib/import-trello";

/**
 * The caller's OWN workspace — the same rule as POST /api/boards: owned, else administered, else one
 * they are a member of, never one they merely observe, and a fresh one if they have none.
 */
export async function ownWorkspaceFor(userId: string, name: string) {
  const [mine] = await db
    .select({ ws: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), ne(workspaceMembers.role, "observer")))
    .orderBy(
      sql`case ${workspaceMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
      asc(workspaces.createdAt),
    )
    .limit(1);
  if (mine) return mine.ws;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace"}-${userId.slice(0, 8)}`;
  const [ws] = await db.insert(workspaces).values({ name, slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" }).onConflictDoNothing();
  return ws;
}

export type CreatedBoard = { boardId: string; summary: { lists: number; cards: number; labels: number; skipped: string[] } };

export async function createBoardFrom(spec: ImportBoard, userId: string, userName: string): Promise<CreatedBoard> {
  const ws = await ownWorkspaceFor(userId, `${userName}'s workspace`);
  const keyPrefix = await uniquePrefixFor(ws.id, spec.title);

  return db.transaction(async (tx) => {
    const [board] = await tx.insert(boards)
      .values({ workspaceId: ws.id, title: spec.title, keyPrefix, createdBy: userId }).returning();
    await tx.insert(boardMembers).values({ boardId: board.id, userId, role: "owner" }).onConflictDoNothing();

    const labelId = new Map<string, string>();
    if (spec.labels.length) {
      const made = await tx.insert(labels)
        .values(spec.labels.map((l) => ({ boardId: board.id, name: l.name, color: l.color }))).returning();
      made.forEach((row, i) => labelId.set(spec.labels[i].name, row.id));
    }

    let cardCount = 0;
    // Sequential on purpose: issue keys come from a counter on the board row, and the keys should
    // read in the order the lists and cards were laid out.
    for (const l of spec.lists) {
      const [col] = await tx.insert(lists)
        .values({ boardId: board.id, title: l.title, position: l.position, statusCategory: inferCategory(l.title) })
        .returning();

      for (const c of l.cards) {
        const [b] = await tx.update(boards).set({ seq: sql`${boards.seq} + 1` }).where(eq(boards.id, board.id)).returning();
        const [card] = await tx.insert(cards).values({
          boardId: board.id, listId: col.id, title: c.title, description: c.description || null,
          position: c.position, issueKey: `${b.keyPrefix}-${b.seq}`, createdBy: userId,
          dueDate: c.dueDate ? new Date(c.dueDate) : null,
          isComplete: c.isComplete, completedAt: c.isComplete ? new Date() : null,
          resolution: c.isComplete ? "done" : null,
          issueType: c.issueType ?? "task", priority: c.priority ?? "medium", points: c.points ?? null,
        }).returning();
        cardCount++;

        const ids = c.labels.map((n) => labelId.get(n)).filter(Boolean) as string[];
        if (ids.length) await tx.insert(cardLabels).values(ids.map((id) => ({ cardId: card.id, labelId: id }))).onConflictDoNothing();

        for (const [ki, k] of c.checklists.entries()) {
          const [made] = await tx.insert(checklists)
            .values({ cardId: card.id, title: k.title, position: (ki + 1) * 1024 }).returning();
          if (k.items.length) {
            await tx.insert(checklistItems).values(k.items.map((it, i) => ({
              checklistId: made.id, text: it.title, isChecked: it.isDone, position: (i + 1) * 1024,
            })));
          }
        }

        // The author was a user somewhere else, not here, so their name goes in the text rather than
        // being attributed to whoever happened to run the import.
        if (c.comments.length) {
          await tx.insert(comments).values(c.comments.map((cm) => ({
            cardId: card.id, userId: null,
            body: `**${cm.author}** (imported${cm.at ? ` ${cm.at.slice(0, 10)}` : ""}): ${cm.text}`,
          })));
        }
      }
    }

    return {
      boardId: board.id,
      summary: { lists: spec.lists.length, cards: cardCount, labels: spec.labels.length, skipped: spec.skipped },
    };
  });
}
