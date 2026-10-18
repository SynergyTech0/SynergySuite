import { redirect } from "next/navigation";
import { LiveChatApp } from "@/components/LiveChatApp";
import { currentUser, isAdmin } from "@/lib/api";
import { deskConfigured } from "@/lib/chat";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <LiveChatApp me={{ email: me.email, admin: isAdmin(me.email) }} desk={deskConfigured()} />;
}
