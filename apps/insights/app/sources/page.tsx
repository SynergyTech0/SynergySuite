import Link from "next/link";
import { redirect } from "next/navigation";
import { SourcesPanel } from "@/components/SourcesPanel";
import { currentUser } from "@/lib/api";
import { isAdmin } from "@/lib/config";
import { metabase } from "@/lib/metabase";

export const dynamic = "force-dynamic";

export default async function Sources() {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const c = metabase().c;
  if (!isAdmin(c, me.email)) redirect("/");
  return (
    <div className="page">
      <div className="head">
        <Link className="crumb" href="/">Insights</Link>
        <span className="muted">/</span>
        <h1 className="grow">Data sources</h1>
        <a className="btn" href={`${c.studioPath}/admin/permissions/data`}>Permissions</a>
      </div>
      <p className="muted">
        These suite databases are connected as read-only sources (set by <code>INSIGHTS_SOURCES</code>). Insights reads
        them through its own Postgres role, <code>{c.readerRole}</code>, which can&apos;t change anything and never sees
        columns that look like passwords, tokens, keys, hashes, PINs or encrypted values. New tables appear after the next
        sync. Everyone can view dashboards they have access to; admins and the people in{" "}
        <code>INSIGHTS_ANALYST_EMAILS</code> can also write their own queries.
      </p>
      <SourcesPanel />
    </div>
  );
}
