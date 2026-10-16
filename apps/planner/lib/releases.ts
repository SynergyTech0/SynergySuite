import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cardFixVersions, cards, components, users, versions } from "@/db/schema";

/** A board's versions, oldest first, each with its progress (done / total non-archived issues). */
export async function versionsWithProgress(boardId: string) {
  const vs = await db.select().from(versions).where(eq(versions.boardId, boardId)).orderBy(asc(versions.createdAt));
  const counts = await db.select({
    versionId: cardFixVersions.versionId,
    total: count(),
    done: sql<number>`count(*) filter (where ${cards.isComplete})`.mapWith(Number),
  }).from(cardFixVersions)
    .innerJoin(cards, eq(cards.id, cardFixVersions.cardId))
    .innerJoin(versions, eq(versions.id, cardFixVersions.versionId))
    .where(and(eq(versions.boardId, boardId), eq(cards.isArchived, false)))
    .groupBy(cardFixVersions.versionId);
  return vs.map((v) => {
    const c = counts.find((x) => x.versionId === v.id);
    return { ...v, total: c?.total ?? 0, done: c?.done ?? 0 };
  });
}

export async function boardComponents(boardId: string) {
  return db.select({
    id: components.id, name: components.name, description: components.description,
    leadId: components.leadId, lead: users.name,
  }).from(components).leftJoin(users, eq(users.id, components.leadId))
    .where(eq(components.boardId, boardId)).orderBy(asc(components.name));
}

/** Unique-name violations surface as Postgres 23505; routes turn that into a 409. */
export const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505"
  || (err as { cause?: { code?: string } })?.cause?.code === "23505";
