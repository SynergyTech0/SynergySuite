import { redirect } from "next/navigation";
import { WorkspaceView } from "@/components/Workspace";
import { currentUser } from "@/lib/api";
import { collabUrl } from "@/lib/collab-url";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const { id } = await params;
  const { page } = await searchParams;
  return <WorkspaceView id={id} initialPage={page ?? null} me={me} collabUrl={collabUrl()} />;
}
