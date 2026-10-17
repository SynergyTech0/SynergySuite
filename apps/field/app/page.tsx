import { redirect } from "next/navigation";
import { FieldApp } from "@/components/FieldApp";
import { currentUser } from "@/lib/api";
import { roleOf } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const role = await roleOf(me.email, me.name);
  if (role === "technician") redirect("/tech");
  return <FieldApp me={{ email: me.email, name: me.name }} role={role} />;
}
