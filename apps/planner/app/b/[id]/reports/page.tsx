import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireBoard } from "@/lib/authz";
import { Reports } from "./Reports";

export const dynamic = "force-dynamic";

// Reports read board data, so membership decides access — the same guard as the board itself.
export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) notFound();
  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) notFound();
  return <Reports board={{ id: board.id, title: board.title }} />;
}
