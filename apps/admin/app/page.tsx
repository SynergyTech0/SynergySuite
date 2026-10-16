import { redirect } from "next/navigation";
import { appUrl } from "@synergy/config";
import { AdminApp } from "@/components/AdminApp";
import { ROLE_LABEL } from "@/lib/access";
import { currentAccess } from "@/lib/api";
import { complianceApps, suiteApps } from "@/lib/apps";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const { who, access } = await currentAccess();
  if (!who) redirect("/signed-out");
  if (access.kind === "setup") {
    return (
      <div className="gate">
        <h1>Set up the Admin center</h1>
        <p>Nobody can use the Admin center yet: no admins are configured.</p>
        <p>Set <code>ADMIN_EMAILS</code> to the email addresses of the people who run the suite, separated by commas, and restart the Admin center:</p>
        <pre>ADMIN_EMAILS=you@example.com,colleague@example.com</pre>
        <p className="muted small">Until then every Admin center page and API refuses requests. Admins can then make other people eDiscovery managers from Roles.</p>
      </div>
    );
  }
  if (access.kind !== "ok") {
    return (
      <div className="gate">
        <p className="code">403</p>
        <h1>You don&apos;t have access to the Admin center</h1>
        <p>You&apos;re signed in as <strong>{who.email}</strong>, who is not an admin or eDiscovery manager.</p>
        <p className="muted">Ask one of your organization&apos;s admins to give you access, or go back to <a href={appUrl("home")}>your apps</a>.</p>
      </div>
    );
  }
  const content = new Set(complianceApps());
  const apps = suiteApps().filter((a) => a.id !== "auth" && a.id !== "home").map((a) => ({ id: a.id, name: a.name, content: content.has(a.id) }));
  return <AdminApp me={{ ...who, role: access.role }} roleLabel={ROLE_LABEL[access.role]} authConsole={`${appUrl("auth")}/admin`} apps={apps} />;
}
