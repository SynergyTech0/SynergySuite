import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Database, Info, PenSquare, Plus } from "lucide-react";
import { currentUser } from "@/lib/api";
import { isAdmin, isAnalyst } from "@/lib/config";
import { type DashboardSummary, listDashboards } from "@/lib/dashboards";
import { metabase } from "@/lib/metabase";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export default async function Home() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const mb = metabase();
  const studio = mb.c.studioPath;
  let dashboards: DashboardSummary[] = [];
  let problem: string | null = null;
  try {
    if (!mb.c.secret) throw new Error("Insights isn't set up: INSIGHTS_SECRET is empty in the suite's settings (deploy/.env).");
    dashboards = await listDashboards(mb, me.email, me.name);
  } catch (err) {
    console.error("[insights] listing dashboards:", (err as Error).message);
    problem =
      (await mb.version()) === null
        ? "The reporting engine is still starting (this takes a minute or two after the suite starts). Refresh in a moment."
        : (err as Error).message;
  }
  const author = isAnalyst(mb.c, me.email);
  return (
    <div className="page">
      <div className="head">
        <h1 className="grow">Insights</h1>
        {author && (
          <a className="btn" href={`${studio}/question/notebook`}>
            <Plus size={16} /> New report
          </a>
        )}
        <a className="btn primary" href={`${studio}/`}>
          <PenSquare size={16} /> Open designer
        </a>
        {isAdmin(mb.c, me.email) && (
          <Link className="btn" href="/sources">
            <Database size={16} /> Data sources
          </Link>
        )}
        <Link className="btn" href="/about" aria-label="About Insights">
          <Info size={16} />
        </Link>
      </div>

      {problem ? (
        <div className="panel">
          <h2>Insights isn&apos;t ready</h2>
          <p className="muted">{problem}</p>
        </div>
      ) : dashboards.length === 0 ? (
        <div className="panel empty">
          <BarChart3 size={40} color="var(--accent)" />
          <h2>No dashboards yet</h2>
          <p className="muted">
            {author
              ? "Build reports over Books, CRM, Desk, Base and the suite's other business data in the designer, then put them on a dashboard. Dashboards you can open show up here."
              : "Dashboards shared with you show up here. Ask an analyst or admin to build one."}
          </p>
          {author && (
            <a className="btn primary" href={`${studio}/question/notebook`}>
              <Plus size={16} /> New report
            </a>
          )}
        </div>
      ) : (
        <div className="cards">
          {dashboards.map((d) => (
            <Link key={d.id} className="card" href={`/d/${d.id}`}>
              <div className="name">
                <BarChart3 size={16} color="var(--accent)" /> {d.name}
              </div>
              {d.description && <div className="desc">{d.description}</div>}
              <div className="meta">
                {[d.collection, when(d.updatedAt)].filter(Boolean).join(" · ")}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
