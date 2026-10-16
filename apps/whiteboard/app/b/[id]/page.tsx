import { redirect } from "next/navigation";
import { BoardScreen } from "@/components/BoardScreen";
import { boardAiConfig } from "@/lib/ai";
import { currentUser } from "@/lib/api";
import { collabUrl } from "@/lib/collab";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const { id } = await params;
  return <BoardScreen id={id} me={{ ...me, ai: !!boardAiConfig() }} collabUrl={collabUrl()} />;
}
