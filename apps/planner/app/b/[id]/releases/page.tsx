import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { canAdminister, requireBoard } from "@/lib/authz";
import { boardComponents, versionsWithProgress } from "@/lib/releases";
import { Releases } from "./Releases";

export const dynamic = "force-dynamic";

// Releases (Jira's versions page) and components. Same guard as the board and backlog pages:
// versions and components are board data, so membership decides access.
export default async function ReleasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) notFound();
  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) notFound();
  return (
    <Releases board={{ id: board.id, title: board.title, keyPrefix: board.keyPrefix }}
      initialVersions={await versionsWithProgress(id)} initialComponents={await boardComponents(id)}
      canAdmin={canAdminister(access.role)} />
  );
}
