import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { cards, issueLinks } from "@/db/schema";

export const LINK_TYPES = ["blocks", "relates", "duplicates", "clones"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** How a link reads from each end, as in Jira: [outward (from the source), inward (from the target)]. */
export const LINK_LABELS: Record<LinkType, [string, string]> = {
  blocks: ["blocks", "is blocked by"],
  relates: ["relates to", "relates to"],
  duplicates: ["duplicates", "is duplicated by"],
  clones: ["clones", "is cloned by"],
};

export const isLinkType = (v: unknown): v is LinkType => LINK_TYPES.includes(v as LinkType);

/**
 * A card's links as the reader sees them. The other end may sit on a board the reader cannot see; such
 * links are dropped entirely rather than shown redacted, because even "linked to a card you can't see"
 * confirms that something exists there.
 */
export async function linksForCard(cardId: string, visibleBoards: string[]) {
  const other = alias(cards, "other");
  const cols = {
    id: issueLinks.id, type: issueLinks.type, sourceId: issueLinks.sourceId, createdAt: issueLinks.createdAt,
    card: {
      id: other.id, issueKey: other.issueKey, title: other.title, isComplete: other.isComplete,
      issueType: other.issueType, priority: other.priority, boardId: other.boardId,
    },
  };
  if (!visibleBoards.length) return [];

  const outward = await db.select(cols).from(issueLinks)
    .innerJoin(other, eq(other.id, issueLinks.targetId))
    .where(and(eq(issueLinks.sourceId, cardId), inArray(other.boardId, visibleBoards)));
  const inward = await db.select(cols).from(issueLinks)
    .innerJoin(other, eq(other.id, issueLinks.sourceId))
    .where(and(eq(issueLinks.targetId, cardId), inArray(other.boardId, visibleBoards)));

  return [
    ...outward.map((l) => ({ id: l.id, type: l.type, direction: "outward" as const, label: LINK_LABELS[l.type][0], card: l.card, createdAt: l.createdAt })),
    ...inward.map((l) => ({ id: l.id, type: l.type, direction: "inward" as const, label: LINK_LABELS[l.type][1], card: l.card, createdAt: l.createdAt })),
  ].sort((a, b) => a.label.localeCompare(b.label) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Does this exact link (or, for the symmetric "relates", its reverse) already exist? */
export async function linkExists(sourceId: string, targetId: string, type: LinkType) {
  const same = and(eq(issueLinks.sourceId, sourceId), eq(issueLinks.targetId, targetId), eq(issueLinks.type, type));
  const reverse = and(eq(issueLinks.sourceId, targetId), eq(issueLinks.targetId, sourceId), eq(issueLinks.type, type));
  const [row] = await db.select({ id: issueLinks.id }).from(issueLinks).where(type === "relates" ? or(same, reverse) : same);
  return Boolean(row);
}
