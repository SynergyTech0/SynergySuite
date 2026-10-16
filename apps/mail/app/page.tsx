import { MailApp } from "@/components/MailApp";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  const who = await currentUser();
  if (!who) return <p className="pad">Sign in to the suite to use Mail.</p>;
  return <MailApp me={who.email} />;
}
