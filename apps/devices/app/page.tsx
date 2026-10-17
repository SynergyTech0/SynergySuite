import { redirect } from "next/navigation";
import { DevicesApp } from "@/components/DevicesApp";
import { aiEnabled } from "@/lib/ai";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <DevicesApp me={{ ...me, ai: await aiEnabled() }} />;
}
