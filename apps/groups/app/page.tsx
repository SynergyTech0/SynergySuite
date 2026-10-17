import { redirect } from "next/navigation";
import { GroupsApp } from "@/components/GroupsApp";
import { meInfo } from "@/lib/me";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await meInfo();
  if (!me) redirect("/signed-out");
  return <GroupsApp me={me} />;
}
