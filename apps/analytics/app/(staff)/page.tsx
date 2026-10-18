import { redirect } from "next/navigation";
import { AnalyticsApp } from "@/components/AnalyticsApp";
import { currentUser, isAdmin } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <AnalyticsApp me={{ email: me.email, admin: isAdmin(me.email) }} />;
}
