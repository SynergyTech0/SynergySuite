import { redirect } from "next/navigation";
import { ContractsApp } from "@/components/ContractsApp";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <ContractsApp me={{ email: me.email, name: me.name }} />;
}
