import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lists } from "@/db/schema";

/**
 * Jira workflow semantics on top of Trello lists.
 *
 * Every list is a status in one of three categories. Entering a Done-category list resolves the card
 * (complete, stamped, resolution "done" unless one was given); leaving Done for a non-done list
 * reopens it. Moves between two non-done lists do not touch completion, so ticking "complete" on a
 * card in To Do still means something.
 *
 * inferCategory mirrors the SQL CASE in migration 0006 — change both together.
 */
export type StatusCategory = "todo" | "in_progress" | "done";
export const STATUS_CATEGORIES: StatusCategory[] = ["todo", "in_progress", "done"];
export const RESOLUTIONS = ["done", "wont_do", "duplicate", "cannot_reproduce"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

const DONE = /(^|[^a-z])(done|complete|completed|closed|shipped|released|resolved|finished|archive)([^a-z]|$)/;
const IN_PROGRESS = /(^|[^a-z])(doing|in progress|progress|review|qa|test|testing|wip|active|started|blocked|ready for)/;

export function inferCategory(title: string): StatusCategory {
  const t = title.toLowerCase();
  if (DONE.test(t)) return "done";
  if (IN_PROGRESS.test(t)) return "in_progress";
  return "todo";
}

export const isStatusCategory = (v: unknown): v is StatusCategory => STATUS_CATEGORIES.includes(v as StatusCategory);
export const isResolution = (v: unknown): v is Resolution => RESOLUTIONS.includes(v as Resolution);

type Completion = { isComplete?: boolean; completedAt?: Date | null; resolution?: Resolution | null };

/** The completion fields implied by setting isComplete explicitly. */
export function completionFor(nowComplete: boolean, before: { isComplete: boolean; resolution: string | null }, resolution?: Resolution | null): Completion {
  if (!nowComplete) return { isComplete: false, completedAt: null, resolution: null };
  return {
    isComplete: true,
    // Re-saving an already-complete card keeps the original completion time: the burndown reads it.
    ...(before.isComplete ? {} : { completedAt: new Date() }),
    resolution: resolution ?? (before.resolution as Resolution | null) ?? "done",
  };
}

/** The completion fields implied by moving a card from one list to another. Empty if none. */
export async function completionOnMove(
  before: { listId: string; isComplete: boolean; resolution: string | null },
  targetListId: string,
  resolution?: Resolution | null,
): Promise<Completion> {
  if (before.listId === targetListId) return {};
  const [from] = await db.select({ c: lists.statusCategory }).from(lists).where(eq(lists.id, before.listId));
  const [to] = await db.select({ c: lists.statusCategory }).from(lists).where(eq(lists.id, targetListId));
  if (to?.c === "done" && !before.isComplete) return completionFor(true, before, resolution);
  if (to && to.c !== "done" && from?.c === "done" && before.isComplete) return completionFor(false, before);
  return {};
}
