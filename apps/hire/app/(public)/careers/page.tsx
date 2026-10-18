import type { Metadata } from "next";
import Link from "next/link";
import { careersSettings, publicJobs } from "@/lib/hire";
import { TYPE_LABELS } from "@/components/labels";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await careersSettings();
  return { title: s.company ? `Careers at ${s.company}` : "Careers" };
}

/** The public list of open jobs, grouped by department. */
export default async function Careers() {
  const [s, jobs] = await Promise.all([careersSettings(), publicJobs()]);
  const groups = new Map<string, typeof jobs>();
  for (const j of jobs) groups.set(j.department, [...(groups.get(j.department) ?? []), j]);
  return (
    <div className="pub">
      <div className="band" />
      <div className="pubwrap">
        <div className="pubhead">
          <h1>{s.company ? `Careers at ${s.company}` : "Careers"}</h1>
          {s.intro && <p>{s.intro}</p>}
        </div>
        {jobs.length === 0 && <div className="box muted">There are no open jobs right now. Please check back later.</div>}
        {[...groups].map(([dept, list]) => (
          <div key={dept} className="jobs">
            {dept && <p className="dept">{dept}</p>}
            {list.map((j) => (
              <Link key={j.slug} className="jobrow" href={`/careers/${j.slug}`}>
                <div>
                  <b>{j.title}</b>
                  <div className="muted small">{[j.location, j.remote ? "Remote possible" : "", TYPE_LABELS[j.employment_type]].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="btn small">View</span>
              </Link>
            ))}
          </div>
        ))}
        {s.contact && <p className="muted small">Questions? Write to <a href={`mailto:${s.contact}`}>{s.contact}</a>.</p>}
      </div>
    </div>
  );
}
