import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { activities, cards, lists, sprints, users } from "@/db/schema";

/**
 * History: the Trello activity feed and the Jira History tab, from one table.
 *
 * Writes go through here so every route records the same shape. A card-scoped row carries cardId
 * and cascades away with the card; anything that must outlive the card (its deletion) is written at
 * board level with the card's key and title copied into `data`.
 *
 * Recording is best-effort by design: the user's change has already committed when this runs, and a
 * history insert that fails must not turn a successful edit into a 500. It logs instead.
 */

type ActivityType = (typeof activities.$inferInsert)["type"];
type Card = typeof cards.$inferSelect;

export type ActivityEvent = {
  boardId: string;
  cardId?: string | null;
  userId?: string | null;
  type: ActivityType;
  data?: Record<string, unknown>;
};

export async function logActivity(events: ActivityEvent | ActivityEvent[]) {
  const rows = (Array.isArray(events) ? events : [events]).map((e) => ({
    boardId: e.boardId,
    cardId: e.cardId ?? null,
    userId: e.userId ?? null,
    type: e.type,
    data: e.data ?? null,
  }));
  if (!rows.length) return;
  try {
    await db.insert(activities).values(rows);
  } catch (err) {
    console.error("activity log write failed", err);
  }
}

// Long text is summarised rather than copied whole: history is for "what changed", and a full
// description stored on every keystroke-save would bloat the table without helping anyone read it.
const clip = (v: unknown, n = 280) => (typeof v === "string" && v.length > n ? v.slice(0, n) + "…" : v);
const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);

const PLAIN_FIELDS = ["title", "description", "isComplete", "issueType", "priority", "points"] as const;

/**
 * Diff a card before and after an update and record one event per meaningful change. Position is
 * deliberately ignored: dragging a card up or down its own list is not history in Trello or Jira.
 */
export async function recordCardChanges(userId: string | null, before: Card, after: Card) {
  const base = { boardId: after.boardId, cardId: after.id, userId };
  const events: ActivityEvent[] = [];

  if (before.listId !== after.listId) {
    const ls = await db.select({ id: lists.id, title: lists.title }).from(lists)
      .where(inArray(lists.id, [before.listId, after.listId]));
    const name = (id: string) => ls.find((l) => l.id === id)?.title ?? null;
    events.push({ ...base, type: "card_moved", data: { from: name(before.listId), to: name(after.listId) } });
  }

  if (before.isArchived !== after.isArchived) {
    events.push({ ...base, type: after.isArchived ? "card_archived" : "card_restored" });
  }

  for (const field of PLAIN_FIELDS) {
    const from = norm(before[field]);
    const to = norm(after[field]);
    if (from === to) continue;
    events.push({ ...base, type: "card_updated", data: { field, from: clip(from), to: clip(to) } });
  }

  if (norm(before.startDate) !== norm(after.startDate)) {
    events.push({ ...base, type: "card_updated", data: { field: "startDate", from: norm(before.startDate), to: norm(after.startDate) } });
  }

  if (norm(before.dueDate) !== norm(after.dueDate)) {
    events.push({ ...base, type: "due_changed", data: { from: norm(before.dueDate), to: norm(after.dueDate) } });
  }

  // References are recorded by name as well as id: the sprint or parent may be renamed or deleted
  // later, and history should still read the way it did when the change was made.
  if (before.sprintId !== after.sprintId) {
    const ids = [before.sprintId, after.sprintId].filter(Boolean) as string[];
    const sp = ids.length ? await db.select({ id: sprints.id, name: sprints.name }).from(sprints).where(inArray(sprints.id, ids)) : [];
    const name = (id: string | null) => (id ? sp.find((s) => s.id === id)?.name ?? null : null);
    events.push({ ...base, type: "card_updated", data: { field: "sprint", from: name(before.sprintId), to: name(after.sprintId) } });
  }

  if (before.parentId !== after.parentId) {
    const ids = [before.parentId, after.parentId].filter(Boolean) as string[];
    const ps = ids.length ? await db.select({ id: cards.id, issueKey: cards.issueKey, title: cards.title }).from(cards).where(inArray(cards.id, ids)) : [];
    const name = (id: string | null) => {
      const p = id ? ps.find((x) => x.id === id) : null;
      return p ? p.issueKey ?? p.title : null;
    };
    events.push({ ...base, type: "card_updated", data: { field: "parent", from: name(before.parentId), to: name(after.parentId) } });
  }

  await logActivity(events);
}

const feedColumns = {
  id: activities.id,
  type: activities.type,
  data: activities.data,
  createdAt: activities.createdAt,
  cardId: activities.cardId,
  actor: users.name,
  actorIsMind: users.isMind,
};

/** One card's history, newest first. */
export async function cardActivity(cardId: string, limit = 100) {
  return db.select(feedColumns).from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(eq(activities.cardId, cardId))
    .orderBy(desc(activities.createdAt))
    .limit(limit);
}

/** A board's feed, newest first, paged by `before` (an ISO timestamp from the previous page). */
export async function boardActivity(boardId: string, opts: { limit?: number; before?: Date | null } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return db.select({ ...feedColumns, cardTitle: cards.title, issueKey: cards.issueKey })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .leftJoin(cards, eq(cards.id, activities.cardId))
    .where(opts.before
      ? and(eq(activities.boardId, boardId), lt(activities.createdAt, opts.before))
      : eq(activities.boardId, boardId))
    .orderBy(desc(activities.createdAt))
    .limit(limit);
}
