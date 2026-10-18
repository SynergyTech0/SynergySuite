import { redirect } from "next/navigation";
import { SmsApp } from "@/components/SmsApp";
import { currentUser } from "@/lib/api";
import { canUseSms } from "@/lib/access";
import { status } from "@/lib/sms";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  if (!canUseSms(me.email)) {
    return (
      <div className="pad">
        <h1>No access to SMS</h1>
        <p className="muted">{me.email} is not on the access list for texting. Ask your administrator to add you.</p>
      </div>
    );
  }
  return <SmsApp sender={status()} />;
}
