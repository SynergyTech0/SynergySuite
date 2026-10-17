import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/api";
import { listDashboards } from "@/lib/dashboards";
import { findExecutive } from "@/lib/executive";
import { metabase } from "@/lib/metabase";

export const dynamic = "force-dynamic";

/** A fixed address for the Executive overview (insights.<domain>/executive), for links from the rest of the suite. */
export default async function Executive() {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const dashboards = await listDashboards(metabase(), me.email, me.name).catch(() => []);
  const d = findExecutive(dashboards);
  if (d) redirect(`/d/${d.id}`);
  return (
    <div className="page">
      <div className="head">
        <Link className="crumb" href="/">Insights</Link>
        <span className="muted">/</span>
        <h1 className="grow">Executive overview</h1>
      </div>
      <div className="panel">
        <h2>Not available</h2>
        <p className="muted">
          The Executive overview shows the business&apos;s finance figures, so only Insights admins can open it unless an
          admin shares it. If you are an admin, it appears after Insights has connected Books, CRM, Desk or Planner (see
          Data sources).
        </p>
      </div>
    </div>
  );
}
