import { db } from "@/db";
import { cards, lists, users } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { mentionedIds, notify, plainMentions, watch, watcherIds } from "@/lib/notify";

type Card = typeof cards.$inferSelect;

/**
 * Notifications for a card update, the counterpart of recordCardChanges (which writes history):
 *  - a new assignee is told they were assigned, and starts watching;
 *  - people newly @mentioned in the description are told — only newly, so re-saving an unchanged
 *    mention does not re-notify;
 *  - watchers hear about changes to where the work stands (list, completion, archive, due date,
 *    priority, assignee), not about every keystroke in a title or description.
 */
export async function notifyCardChanges(actorId: string | null, before: Card, after: Card) {
  const base = { actorId, boardId: after.boardId, cardId: after.id };
  const told = new Set<string>();

  if (after.assigneeId && after.assigneeId !== before.assigneeId) {
    for (const u of await notify({ ...base, recipients: [after.assigneeId], type: "assigned", data: { title: after.title } })) told.add(u);
    if (after.assigneeId !== actorId) await watch(after.id, after.assigneeId);
  }

  const newMentions = [...mentionedIds(after.description)].filter((id) => !mentionedIds(before.description).has(id));
  if (newMentions.length) {
    const excerpt = plainMentions(after.description ?? "").slice(0, 200);
    for (const u of await notify({ ...base, recipients: newMentions, type: "mentioned", data: { excerpt, where: "description", title: after.title } })) told.add(u);
  }

  const changes: Record<string, unknown> = {};
  if (before.listId !== after.listId) {
    const ls = await db.select({ id: lists.id, title: lists.title }).from(lists).where(inArray(lists.id, [before.listId, after.listId]));
    changes.list = { from: ls.find((l) => l.id === before.listId)?.title ?? null, to: ls.find((l) => l.id === after.listId)?.title ?? null };
  }
  if (before.isComplete !== after.isComplete) changes.complete = after.isComplete;
  if (before.isArchived !== after.isArchived) changes.archived = after.isArchived;
  if (String(before.dueDate) !== String(after.dueDate)) changes.due = after.dueDate;
  if (before.priority !== after.priority) changes.priority = after.priority;
  if (before.assigneeId !== after.assigneeId) {
    const [u] = after.assigneeId ? await db.select({ name: users.name }).from(users).where(eq(users.id, after.assigneeId)) : [];
    changes.assignee = u?.name ?? null;
  }
  if (Object.keys(changes).length) {
    await notify({ ...base, recipients: await watcherIds(after.id), exclude: told, type: "updated", data: { title: after.title, changes } });
  }
}
