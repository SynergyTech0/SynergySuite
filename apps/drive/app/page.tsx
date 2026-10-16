import { redirect } from "next/navigation";
import { DriveApp } from "@/components/DriveApp";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  if (!(await currentUser())) redirect("/signed-out");
  return <DriveApp />;
}
