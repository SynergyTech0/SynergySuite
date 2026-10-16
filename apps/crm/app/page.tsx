import { redirect } from "next/navigation";
import { CrmApp } from "@/components/CrmApp";
import { currentCtx } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const ctx = await currentCtx();
  if (!ctx) redirect("/signed-out");
  return <CrmApp me={ctx} />;
}
