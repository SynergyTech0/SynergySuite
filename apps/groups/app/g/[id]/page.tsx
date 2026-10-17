import { redirect } from "next/navigation";
import { GroupsApp } from "@/components/GroupsApp";
import { meInfo } from "@/lib/me";

export const dynamic = "force-dynamic";

/** A group or team's own page: /g/<id>. */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await meInfo();
  if (!me) redirect("/signed-out");
  return <GroupsApp me={me} initialId={(await params).id} />;
}
