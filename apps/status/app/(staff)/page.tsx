import { redirect } from "next/navigation";
import { StatusApp } from "@/components/StatusApp";
import { currentUser, isAdmin } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <StatusApp me={{ email: me.email, admin: isAdmin(me.email) }} suiteDomain={process.env.SUITE_DOMAIN || ""} />;
}
