import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  automations,
  boardMembers,
  boards,
  cards,
  comments,
  components,
  customFields,
  checklistItems,
  checklists,
  labels,
  lists,
  sprints,
  versions,
  workspaceMembers,
} from "@/db/schema";
import { getCurrentUserOrNull } from "@/lib/session";

/**
 * Tenancy seam. A caller may see a board if they are a member of that board, or a member of the
 * workspace the board belongs to. Everything else answers 404 — never 403, because a 403 confirms
 * the resource exists, which is itself a cross-tenant leak.
 *
 * Deliberately NOT routed through here: /api/mind. It authenticates with a service token, has no
 * session, and is exempted at the proxy (OAUTH2_PROXY_SKIP_AUTH_ROUTES). Its board lookup is
 * global-by-title, which IS a cross-tenant flaw — but the live "Mind Ops" board holds 781 cards in
 * the shared workspace, so rescoping it is a data migration, not an edit to this file.
 */

export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Roles. Seeing a board (above) and changing it are different questions: an observer can read
 * everything and change nothing, as in Trello and Jira. Refusing a write is a 403 rather than a 404,
 * because the caller can already see the board, so the refusal confirms nothing new.
 */
export type Role = "owner" | "admin" | "member" | "observer";
export const canWrite = (r: Role | null) => r === "owner" || r === "admin" || r === "member";
export const canAdminister = (r: Role | null) => r === "owner" || r === "admin";
export const forbidden = () => NextResponse.json({ error: "insufficient role" }, { status: 403 });

/**
 * The caller's effective role on a board: their board membership if they have one — so a board can
 * restrict a workspace member to observer, or lift a workspace observer to member — otherwise their
 * role in the board's workspace. Null when they have neither.
 */
export async function boardRole(userId: string, boardId: string): Promise<Role | null> {
  const [onBoard] = await db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));
  if (onBoard) return onBoard.role as Role;

  const [inWorkspace] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(boards, eq(boards.workspaceId, workspaceMembers.workspaceId))
    .where(and(eq(boards.id, boardId), eq(workspaceMembers.userId, userId)));
  return (inWorkspace?.role as Role) ?? null;
}

/** Board ids this user may see, via board membership or workspace membership. */
export async function visibleBoardIds(userId: string): Promise<string[]> {
  const direct = await db
    .select({ id: boardMembers.boardId })
    .from(boardMembers)
    .where(eq(boardMembers.userId, userId));

  const viaWorkspace = await db
    .select({ id: boards.id })
    .from(boards)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, boards.workspaceId))
    .where(eq(workspaceMembers.userId, userId));

  return [...new Set([...direct.map((r) => r.id), ...viaWorkspace.map((r) => r.id)])];
}

export async function canSeeBoard(userId: string, boardId?: string | null): Promise<boolean> {
  if (!boardId) return false;

  const [board] = await db
    .select({ workspaceId: boards.workspaceId })
    .from(boards)
    .where(eq(boards.id, boardId));
  if (!board) return false;

  const [inWorkspace] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, board.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  if (inWorkspace) return true;

  const [onBoard] = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));
  return Boolean(onBoard);
}

/* ---- which board does an entity belong to (null when it does not exist) ---- */

export async function boardOfList(listId?: string | null) {
  if (!listId) return null;
  const [row] = await db.select({ boardId: lists.boardId }).from(lists).where(eq(lists.id, listId));
  return row?.boardId ?? null;
}

export async function boardOfCard(cardId?: string | null) {
  if (!cardId) return null;
  const [row] = await db.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, cardId));
  return row?.boardId ?? null;
}

export async function boardOfLabel(labelId?: string | null) {
  if (!labelId) return null;
  const [row] = await db.select({ boardId: labels.boardId }).from(labels).where(eq(labels.id, labelId));
  return row?.boardId ?? null;
}

export async function boardOfChecklist(checklistId?: string | null) {
  if (!checklistId) return null;
  const [row] = await db
    .select({ boardId: cards.boardId })
    .from(checklists)
    .innerJoin(cards, eq(cards.id, checklists.cardId))
    .where(eq(checklists.id, checklistId));
  return row?.boardId ?? null;
}

export async function boardOfChecklistItem(itemId?: string | null) {
  if (!itemId) return null;
  const [row] = await db
    .select({ boardId: cards.boardId })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .innerJoin(cards, eq(cards.id, checklists.cardId))
    .where(eq(checklistItems.id, itemId));
  return row?.boardId ?? null;
}

export async function boardOfComment(commentId?: string | null) {
  if (!commentId) return null;
  const [row] = await db
    .select({ boardId: cards.boardId })
    .from(comments)
    .innerJoin(cards, eq(cards.id, comments.cardId))
    .where(eq(comments.id, commentId));
  return row?.boardId ?? null;
}

export async function boardOfAttachment(attachmentId?: string | null) {
  if (!attachmentId) return null;
  const [row] = await db
    .select({ boardId: cards.boardId })
    .from(attachments)
    .innerJoin(cards, eq(cards.id, attachments.cardId))
    .where(eq(attachments.id, attachmentId));
  return row?.boardId ?? null;
}

export async function boardOfVersion(versionId?: string | null) {
  if (!versionId) return null;
  const [row] = await db.select({ boardId: versions.boardId }).from(versions).where(eq(versions.id, versionId));
  return row?.boardId ?? null;
}

export async function boardOfComponent(componentId?: string | null) {
  if (!componentId) return null;
  const [row] = await db.select({ boardId: components.boardId }).from(components).where(eq(components.id, componentId));
  return row?.boardId ?? null;
}

export async function boardOfCustomField(fieldId?: string | null) {
  if (!fieldId) return null;
  const [row] = await db.select({ boardId: customFields.boardId }).from(customFields).where(eq(customFields.id, fieldId));
  return row?.boardId ?? null;
}

export async function boardOfSprint(sprintId?: string | null) {
  if (!sprintId) return null;
  const [row] = await db.select({ boardId: sprints.boardId }).from(sprints).where(eq(sprints.id, sprintId));
  return row?.boardId ?? null;
}

/* ---- guards: resolve the caller and assert access, or return null ---- */

// Ids arrive from URLs and JSON bodies. Postgres rejects a malformed uuid with a cast error, which
// would surface as a 500; a malformed id is simply a thing that does not exist.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Resolve the caller and the board an entity belongs to, and assert they can see that board. */
export async function requireVia(resolveBoard: () => Promise<string | null>) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  const boardId = await resolveBoard();
  if (!boardId || !(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId, role: await boardRole(user.id, boardId) };
}

export async function boardOfAutomation(automationId?: string | null) {
  if (!isUuid(automationId)) return null;
  const [row] = await db.select({ boardId: automations.boardId }).from(automations).where(eq(automations.id, automationId));
  return row?.boardId ?? null;
}

export const requireAutomation = (id?: string | null) =>
  isUuid(id) ? requireVia(() => boardOfAutomation(id)) : Promise.resolve(null);

export const requireComment = (id?: string | null) =>
  isUuid(id) ? requireVia(() => boardOfComment(id)) : Promise.resolve(null);
export const requireLabel = (id?: string | null) =>
  isUuid(id) ? requireVia(() => boardOfLabel(id)) : Promise.resolve(null);
export const requireVersion = (id?: string | null) =>
  isUuid(id) ? requireVia(() => boardOfVersion(id)) : Promise.resolve(null);
export const requireComponent = (id?: string | null) =>
  isUuid(id) ? requireVia(() => boardOfComponent(id)) : Promise.resolve(null);
export const requireAttachment = (id?: string | null) =>
  isUuid(id) ? requireVia(() => boardOfAttachment(id)) : Promise.resolve(null);

// Every guard resolves identity through getCurrentUserOrNull: a request with no trusted identity is
// refused exactly like a request for someone else's board (404), never raised as a 500.
export async function requireBoard(boardId?: string | null) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  if (!(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId: boardId!, role: await boardRole(user.id, boardId!) };
}

export async function requireCard(cardId?: string | null) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  const boardId = await boardOfCard(cardId);
  if (!boardId || !(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId, cardId: cardId!, role: await boardRole(user.id, boardId) };
}

export async function requireList(listId?: string | null) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  const boardId = await boardOfList(listId);
  if (!boardId || !(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId, listId: listId!, role: await boardRole(user.id, boardId) };
}

export async function requireChecklist(checklistId?: string | null) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  const boardId = await boardOfChecklist(checklistId);
  if (!boardId || !(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId, checklistId: checklistId!, role: await boardRole(user.id, boardId) };
}

export async function requireChecklistItem(itemId?: string | null) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  const boardId = await boardOfChecklistItem(itemId);
  if (!boardId || !(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId, itemId: itemId!, role: await boardRole(user.id, boardId) };
}

export async function requireSprint(sprintId?: string | null) {
  const user = await getCurrentUserOrNull();
  if (!user) return null;
  const boardId = await boardOfSprint(sprintId);
  if (!boardId || !(await canSeeBoard(user.id, boardId))) return null;
  return { user, boardId, sprintId: sprintId!, role: await boardRole(user.id, boardId) };
}

/** Everyone who shares at least one workspace with this user — the assignable set. */
export async function workspacePeerIds(userId: string): Promise<string[]> {
  const mine = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  if (!mine.length) return [userId];

  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      inArray(
        workspaceMembers.workspaceId,
        mine.map((m) => m.id),
      ),
    );
  return [...new Set([userId, ...rows.map((r) => r.userId)])];
}
