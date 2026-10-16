/**
 * Butler-style automation rules: when something happens on a board, do something to the card.
 *
 * **One pass, deliberately.** An action never triggers another rule. Two rules pointing at each
 * other ("when it lands in Done, move it to Doing" / "when it lands in Doing, move it to Done") is
 * not a hypothetical — it is what people write first — and a rule engine that cascades turns that
 * into a request that never returns. One pass means the worst case is a rule that did not fire,
 * which someone can see and fix, rather than a board that fights itself.
 *
 * Rules run after the user's own write has committed, and failures are logged rather than raised:
 * the person's change succeeded, and an automation that cannot run must not turn it into a 500.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { automations, cardLabels, cards, comments, lists } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { completionFor } from "@/lib/workflow";

type Card = typeof cards.$inferSelect;
export type Rule = typeof automations.$inferSelect;

/**
 * Conditions live inside the trigger rather than in their own column: "when does this fire" is the
 * trigger's whole job, and keeping them together means one jsonb to read, write and validate.
 */
export type Conditions = { issueType?: string; priority?: string; listId?: string };
export type Trigger = { when?: Conditions } & (
  | { on: "card_created" }
  | { on: "card_moved"; toListId?: string }
  | { on: "card_completed" }
);

export type Action =
  | { do: "move"; toListId: string }
  | { do: "assign"; userId: string | null }
  | { do: "label"; labelId: string; remove?: boolean }
  | { do: "comment"; text: string }
  | { do: "complete" }
  | { do: "archive" }
  | { do: "priority"; value: string }
  | { do: "due"; plusDays: number };

export type Event = { type: Trigger["on"]; card: Card };

export const TRIGGERS: Trigger["on"][] = ["card_created", "card_moved", "card_completed"];
export const ACTIONS: Action["do"][] = ["move", "assign", "label", "comment", "complete", "archive", "priority", "due"];

function fires(trigger: Trigger, event: Event): boolean {
  if (trigger.on !== event.type) return false;
  // A move rule with no list named fires on any move; with one, only on arrival there.
  if (trigger.on === "card_moved" && trigger.toListId) return trigger.toListId === event.card.listId;
  return true;
}

function passes(when: Conditions | undefined | null, card: Card): boolean {
  if (!when) return true;
  if (when.issueType && when.issueType !== card.issueType) return false;
  if (when.priority && when.priority !== card.priority) return false;
  if (when.listId && when.listId !== card.listId) return false;
  return true;
}

/** The rules that should run for this event, in the order they were created. Pure: no database. */
export function planFor(rules: Rule[], event: Event): Rule[] {
  return rules.filter((r) => {
    const trigger = r.trigger as Trigger;
    return r.isEnabled && fires(trigger, event) && passes(trigger.when, event.card);
  });
}

/** Validate a rule's shape before it is stored — a malformed rule is a silent no-op forever. */
export async function validateRule(boardId: string, trigger: unknown, action: unknown): Promise<string | null> {
  const t = trigger as Trigger, a = action as Action;
  if (!t || !TRIGGERS.includes(t.on)) return "trigger must be one of: " + TRIGGERS.join(", ");
  if (!a || !ACTIONS.includes(a.do)) return "action must be one of: " + ACTIONS.join(", ");

  // Any list an automation names must belong to this board, or a rule would move cards across a
  // tenancy boundary every time it ran.
  const onThisBoard = async (listId: string) =>
    Boolean((await db.select({ id: lists.id }).from(lists).where(and(eq(lists.id, listId), eq(lists.boardId, boardId))))[0]);
  if (t.on === "card_moved" && t.toListId && !(await onThisBoard(t.toListId))) return "that trigger list is not on this board";
  if (a.do === "move" && !(await onThisBoard(a.toListId))) return "that destination list is not on this board";
  if (a.do === "comment" && !String(a.text ?? "").trim()) return "a comment rule needs something to say";
  if (a.do === "due" && !Number.isFinite(Number(a.plusDays))) return "a due-date rule needs a number of days";
  if (t.when && typeof t.when !== "object") return "conditions must be an object";
  return null;
}

/** Apply one rule. Returns a short description for the history row, or null if it did nothing. */
async function apply(rule: Rule, card: Card, userId: string): Promise<string | null> {
  const a = rule.action as Action;
  switch (a.do) {
    case "move": {
      if (card.listId === a.toListId) return null;
      await db.update(cards).set({ listId: a.toListId, updatedAt: new Date() }).where(eq(cards.id, card.id));
      return "moved it";
    }
    case "assign":
      if (card.assigneeId === a.userId) return null;
      await db.update(cards).set({ assigneeId: a.userId, updatedAt: new Date() }).where(eq(cards.id, card.id));
      return a.userId ? "assigned it" : "unassigned it";
    case "label":
      if (a.remove) {
        await db.delete(cardLabels).where(and(eq(cardLabels.cardId, card.id), eq(cardLabels.labelId, a.labelId)));
        return "removed a label";
      }
      await db.insert(cardLabels).values({ cardId: card.id, labelId: a.labelId }).onConflictDoNothing();
      return "added a label";
    case "comment":
      // userId null: nobody typed this, and attributing it to whoever moved the card would be a lie.
      await db.insert(comments).values({ cardId: card.id, userId: null, body: `🤖 ${a.text}` });
      return "commented";
    case "complete":
      if (card.isComplete) return null;
      await db.update(cards).set({ ...completionFor(true, card, undefined), updatedAt: new Date() }).where(eq(cards.id, card.id));
      return "marked it complete";
    case "archive":
      if (card.isArchived) return null;
      await db.update(cards).set({ isArchived: true, updatedAt: new Date() }).where(eq(cards.id, card.id));
      return "archived it";
    case "priority":
      if (card.priority === a.value) return null;
      await db.update(cards).set({ priority: a.value as Card["priority"], updatedAt: new Date() }).where(eq(cards.id, card.id));
      return `set priority to ${a.value}`;
    case "due": {
      const due = new Date(Date.now() + Number(a.plusDays) * 86400000);
      await db.update(cards).set({ dueDate: due, updatedAt: new Date() }).where(eq(cards.id, card.id));
      return `set the due date to ${due.toISOString().slice(0, 10)}`;
    }
  }
  return null;
}

/**
 * Run the board's rules for one event. The card is re-read between rules so a second rule sees what
 * the first one did — within the single pass, rules compose; across events, they do not cascade.
 */
export async function runAutomations(event: Event, userId: string): Promise<void> {
  try {
    const rules = await db.select().from(automations).where(eq(automations.boardId, event.card.boardId));
    const due = planFor(rules as Rule[], event);
    if (!due.length) return;

    let card = event.card;
    for (const rule of due) {
      const did = await apply(rule, card, userId);
      if (!did) continue;
      const [fresh] = await db.select().from(cards).where(eq(cards.id, card.id));
      if (fresh) card = fresh;
      await logActivity({
        boardId: card.boardId, cardId: card.id, userId,
        type: "automation_ran", data: { rule: rule.name, did },
      });
    }
  } catch (err) {
    // The user's own change already committed; an automation failure is logged, not raised.
    console.error("automation run failed", err);
  }
}
