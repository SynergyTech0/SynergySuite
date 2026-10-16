import { db } from "@/db";
import {
  boardMembers,
  boards,
  cards,
  checklists,
  comments,
  labels,
  lists,
  sprints,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";

export type Tenant = {
  userId: string;
  sub: string;
  email: string;
  name: string;
  workspaceId: string;
  boardId: string;
  listId: string;
  cardId: string;
  labelId: string;
  checklistId: string;
  commentId: string;
  sprintId: string;
};

/**
 * One self-contained tenant, written straight to the database rather than through the API, so
 * tenancy tests exercise authorization and never depend on the create paths they are testing.
 */
export async function seedTenant(slug: string): Promise<Tenant> {
  const [user] = await db
    .insert(users)
    .values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: `User ${slug}` })
    .returning();

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Workspace ${slug}`, slug })
    .returning();

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" });

  const [board] = await db
    .insert(boards)
    .values({ workspaceId: workspace.id, title: `${slug} board`, createdBy: user.id })
    .returning();

  await db.insert(boardMembers).values({ boardId: board.id, userId: user.id, role: "owner" });

  const [list] = await db
    .insert(lists)
    .values({ boardId: board.id, title: "To Do", position: 1024 })
    .returning();

  const [card] = await db
    .insert(cards)
    .values({
      listId: list.id,
      boardId: board.id,
      title: `${slug} card`,
      position: 1024,
      createdBy: user.id,
    })
    .returning();

  const [label] = await db
    .insert(labels)
    .values({ boardId: board.id, name: `${slug} label`, color: "#ff0000" })
    .returning();

  const [checklist] = await db
    .insert(checklists)
    .values({ cardId: card.id, title: "Checklist", position: 1024 })
    .returning();

  const [comment] = await db
    .insert(comments)
    .values({ cardId: card.id, userId: user.id, origin: "human", body: `${slug} comment` })
    .returning();

  const [sprint] = await db
    .insert(sprints)
    .values({ boardId: board.id, name: `${slug} sprint`, state: "future" })
    .returning();

  return {
    userId: user.id,
    sub: user.authSub!,
    email: user.email!,
    name: user.name,
    workspaceId: workspace.id,
    boardId: board.id,
    listId: list.id,
    cardId: card.id,
    labelId: label.id,
    checklistId: checklist.id,
    commentId: comment.id,
    sprintId: sprint.id,
  };
}
