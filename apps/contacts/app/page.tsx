import { redirect } from "next/navigation";
import { ContactsApp } from "@/components/ContactsApp";
import { currentUser } from "@/lib/api";
import { touch } from "@/lib/directory";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  await touch(me.email, me.name).catch(() => {});
  return <ContactsApp me={me} />;
}
