import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PenSquare } from "lucide-react";
import { DashboardFrame } from "@/components/DashboardFrame";
import { currentUser } from "@/lib/api";
import { getDashboard } from "@/lib/dashboards";
import { metabase } from "@/lib/metabase";

export const dynamic = "force-dynamic";

export default async function Dashboard({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const mb = metabase();
  const d = await getDashboard(mb, me.email, me.name, id);
  if (!d) notFound();
  return (
    <div className="viewer">
      <div className="head">
        <Link className="crumb" href="/">Insights</Link>
        <span className="muted">/</span>
        <h1 className="grow">{d.name}</h1>
        <a className="btn" href={`${mb.c.studioPath}/dashboard/${d.id}`}>
          <PenSquare size={16} /> {d.canWrite ? "Edit in designer" : "Open in designer"}
        </a>
      </div>
      <DashboardFrame id={d.id} title={d.name} />
    </div>
  );
}
