import { redirect } from "next/navigation";
import { TechApp } from "@/components/TechApp";
import { currentUser } from "@/lib/api";
import { roleOf } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** The technician's phone view: their visits, and each job they're working. */
export default async function Page() {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const role = await roleOf(me.email, me.name);
  if (!role) redirect("/");
  return <TechApp me={{ email: me.email, name: me.name }} role={role} />;
}
