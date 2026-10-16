import { redirect } from "next/navigation";
import { AdminApp } from "@/components/AdminApp";
import { adminEmails, currentUser, isAdmin } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  if (!isAdmin(me)) {
    return (
      <div className="pad">
        <h1>Phone admin</h1>
        <p className="muted">
          Only phone admins can set up trunks and numbers. {adminEmails().length ? "Ask one of them." : "Set PHONE_ADMIN_EMAILS (or the suite's ADMIN_EMAILS) on the Phone server."}
        </p>
        <a className="btn" href="/">Back to Phone</a>
      </div>
    );
  }
  return <AdminApp sipHost={process.env.PHONE_SIP_HOST || (process.env.SUITE_DOMAIN ? `sip.${process.env.SUITE_DOMAIN}` : "")} />;
}
