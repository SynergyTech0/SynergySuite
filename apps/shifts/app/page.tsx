import { redirect } from "next/navigation";
import { ShiftsApp } from "@/components/ShiftsApp";
import { currentUser } from "@/lib/api";
import { isScheduler } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <ShiftsApp admin={isScheduler(me.email)} />;
}
