import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cardWatchers, notifications } from "@/db/schema";
import { canSeeBoard } from "@/lib/authz";

type NotificationType = (typeof notifications.$inferInsert)["type"];

/**
 * Mentions are written as `@[Display Name](user-uuid)` — the comment box inserts that token, and the
 * renderer shows it as "@Display Name". Names are not unique and change; the id is what is notified.
 */
const MENTION = /@\[[^\]\n]{1,100}\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function mentionedIds(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of (text ?? "").matchAll(MENTION)) out.add(m[1].toLowerCase());
  return out;
}

/** Replace mention tokens with plain "@Name" for excerpts and anywhere markup is not rendered. */
export const plainMentions = (text: string) => text.replace(MENTION, (tok) => tok.slice(0, tok.indexOf("](")).replace("@[", "@"));

export async function watch(cardId: string, userId: string) {
  await db.insert(cardWatchers).values({ cardId, userId }).onConflictDoNothing();
}

export async function watcherIds(cardId: string) {
  return (await db.select({ userId: cardWatchers.userId }).from(cardWatchers).where(eq(cardWatchers.cardId, cardId))).map((w) => w.userId);
}

/**
 * Deliver one kind of notification to several people. Three filters, always applied here so no caller
 * can forget one:
 *  - never notify the actor about their own action;
 *  - never notify the same person twice for the same event (pass `exclude` for people already told
 *    about it in a more specific way, e.g. someone mentioned in a comment is not also "a watcher saw a
 *    comment");
 *  - never notify someone who cannot see the board, because the notification carries the card title
 *    and an excerpt. That covers a mention of an outsider and a watcher who has since lost access.
 */
export async function notify(opts: {
  recipients: Iterable<string>;
  actorId: string | null;
  type: NotificationType;
  boardId: string;
  cardId?: string | null;
  data?: Record<string, unknown>;
  exclude?: Iterable<string>;
}): Promise<string[]> {
  const skip = new Set([...(opts.exclude ?? []), ...(opts.actorId ? [opts.actorId] : [])]);
  const delivered: string[] = [];
  for (const userId of new Set(opts.recipients)) {
    if (skip.has(userId)) continue;
    if (!(await canSeeBoard(userId, opts.boardId))) continue;
    delivered.push(userId);
  }
  if (!delivered.length) return [];
  try {
    await db.insert(notifications).values(delivered.map((userId) => ({
      userId, actorId: opts.actorId, type: opts.type, boardId: opts.boardId, cardId: opts.cardId ?? null, data: opts.data ?? null,
    })));
  } catch (err) {
    // Like history: best-effort after the user's change has committed. A lost notification must not
    // turn a successful comment into a 500.
    console.error("notification write failed", err);
    return [];
  }
  return delivered;
}
