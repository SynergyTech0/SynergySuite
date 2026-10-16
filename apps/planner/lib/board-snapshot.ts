import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { boardFields } from "@/lib/custom-fields";
import { db } from "@/db";
import {
  attachments, boards, cardComponents, cardFieldValues, cardFixVersions, cardLabels, cardMembers, cards, checklistItems, checklists, comments,
  components, issueLinks, labels, lists, versions,
  sprints, users,
} from "@/db/schema";

/**
 * Everything a board view renders, in one place. The server page and GET /api/boards/[id] both used
 * to assemble this separately and had already drifted; the card-face badges would have made that
 * worse. Counts are aggregated in SQL per board, not per card, so a 700-card board is a handful of
 * queries rather than thousands.
 *
 * Callers are responsible for authorization; this only reads.
 */
export async function boardSnapshot(boardId: string) {
  const board = await db.query.boards.findFirst({ where: eq(boards.id, boardId) });
  const sp = await db.select().from(sprints).where(eq(sprints.boardId, boardId)).orderBy(asc(sprints.createdAt));
  const ls = await db.select().from(lists)
    .where(and(eq(lists.boardId, boardId), eq(lists.isArchived, false))).orderBy(asc(lists.position));
  const cs = await db.select().from(cards)
    .where(and(eq(cards.boardId, boardId), eq(cards.isArchived, false))).orderBy(asc(cards.position));

  const live = and(eq(cards.boardId, boardId), eq(cards.isArchived, false));

  const labelRows = await db.select({ cardId: cardLabels.cardId, id: labels.id, name: labels.name, color: labels.color })
    .from(cardLabels).innerJoin(labels, eq(cardLabels.labelId, labels.id))
    .innerJoin(cards, eq(cards.id, cardLabels.cardId)).where(live);

  const memberRows = await db.select({ cardId: cardMembers.cardId, id: users.id, name: users.name, isMind: users.isMind })
    .from(cardMembers).innerJoin(users, eq(users.id, cardMembers.userId))
    .innerJoin(cards, eq(cards.id, cardMembers.cardId)).where(live);

  const checklistRows = await db.select({
    cardId: checklists.cardId,
    total: count(checklistItems.id),
    done: sql<number>`count(*) filter (where ${checklistItems.isChecked})`.mapWith(Number),
  }).from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .innerJoin(cards, eq(cards.id, checklists.cardId))
    .where(live).groupBy(checklists.cardId);

  const commentRows = await db.select({ cardId: comments.cardId, n: count() })
    .from(comments).innerJoin(cards, eq(cards.id, comments.cardId)).where(live).groupBy(comments.cardId);

  const attachmentRows = await db.select({ cardId: attachments.cardId, n: count() })
    .from(attachments).innerJoin(cards, eq(cards.id, attachments.cardId)).where(live).groupBy(attachments.cardId);

  // Blocked = at least one "blocks" link from a card that is still open. A finished blocker no longer
  // blocks, and an archived one is out of play.
  const blocker = alias(cards, "blocker");
  const blockedRows = await db.select({ cardId: issueLinks.targetId, n: count() })
    .from(issueLinks)
    .innerJoin(blocker, eq(blocker.id, issueLinks.sourceId))
    .innerJoin(cards, eq(cards.id, issueLinks.targetId))
    .where(and(live, eq(issueLinks.type, "blocks"), eq(blocker.isComplete, false), eq(blocker.isArchived, false)))
    .groupBy(issueLinks.targetId);

  // An image cover points at an attachment; resolve its URL so the face can render it. An uploaded
  // file has no url of its own — it is served from our own route by attachment id.
  const coverIds = cs.map((c) => c.cover).filter((v): v is string => !!v && !v.startsWith("#"));
  const coverRows = coverIds.length
    ? (await db.select({ id: attachments.id, url: attachments.url, storageKey: attachments.storageKey })
        .from(attachments).where(inArray(attachments.id, coverIds)))
        .map((r) => ({ id: r.id, url: r.storageKey ? `/api/attachments/${r.id}/file` : r.url }))
    : [];

  const versionRows = await db.select({ cardId: cardFixVersions.cardId, id: versions.id, name: versions.name })
    .from(cardFixVersions).innerJoin(versions, eq(versions.id, cardFixVersions.versionId))
    .innerJoin(cards, eq(cards.id, cardFixVersions.cardId)).where(live);
  const componentRows = await db.select({ cardId: cardComponents.cardId, id: components.id, name: components.name })
    .from(cardComponents).innerJoin(components, eq(components.id, cardComponents.componentId))
    .innerJoin(cards, eq(cards.id, cardComponents.cardId)).where(live);
  const boardVersions = await db.select({ id: versions.id, name: versions.name, releasedAt: versions.releasedAt, isArchived: versions.isArchived })
    .from(versions).where(eq(versions.boardId, boardId)).orderBy(asc(versions.createdAt));
  const boardComponentList = await db.select({ id: components.id, name: components.name })
    .from(components).where(eq(components.boardId, boardId)).orderBy(asc(components.name));
  const fieldDefs = await boardFields(boardId);
  const fieldRows = await db.select({ cardId: cardFieldValues.cardId, fieldId: cardFieldValues.fieldId, value: cardFieldValues.value })
    .from(cardFieldValues).innerJoin(cards, eq(cards.id, cardFieldValues.cardId)).where(live);

  const byCard = <T extends { cardId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.cardId, [...(m.get(r.cardId) ?? []), r]);
    return m;
  };
  const L = byCard(labelRows), M = byCard(memberRows), FV = byCard(versionRows), CO = byCard(componentRows), CF = byCard(fieldRows);
  const CL = new Map(checklistRows.map((r) => [r.cardId, r]));
  const CM = new Map(commentRows.map((r) => [r.cardId, r.n]));
  const AT = new Map(attachmentRows.map((r) => [r.cardId, r.n]));
  const BL = new Map(blockedRows.map((r) => [r.cardId, r.n]));

  const assigneeIds = [...new Set(cs.map((c) => c.assigneeId).filter((v): v is string => !!v))];
  const assignees = assigneeIds.length
    ? await db.select({ id: users.id, name: users.name, isMind: users.isMind }).from(users).where(inArray(users.id, assigneeIds))
    : [];

  const cardsOut = cs.map((c) => ({
    ...c,
    assignee: c.assigneeId ? assignees.find((u) => u.id === c.assigneeId) ?? null : null,
    labels: (L.get(c.id) ?? []).map(({ id, name, color }) => ({ id, name, color })),
    members: (M.get(c.id) ?? []).map(({ id, name, isMind }) => ({ id, name, isMind })),
    fixVersions: (FV.get(c.id) ?? []).map(({ id, name }) => ({ id, name })),
    components: (CO.get(c.id) ?? []).map(({ id, name }) => ({ id, name })),
    fields: Object.fromEntries((CF.get(c.id) ?? []).map((f) => [f.fieldId, f.value])),
    coverUrl: c.cover && !c.cover.startsWith("#") ? coverRows.find((r) => r.id === c.cover)?.url ?? null : null,
    badges: {
      checklistDone: CL.get(c.id)?.done ?? 0,
      checklistTotal: CL.get(c.id)?.total ?? 0,
      comments: CM.get(c.id) ?? 0,
      attachments: AT.get(c.id) ?? 0,
      hasDescription: !!c.description?.trim(),
      blockedBy: BL.get(c.id) ?? 0,
    },
  }));

  return { board, lists: ls, sprints: sp, cards: cardsOut, versions: boardVersions, components: boardComponentList, customFields: fieldDefs };
}

export type BoardSnapshot = Awaited<ReturnType<typeof boardSnapshot>>;
