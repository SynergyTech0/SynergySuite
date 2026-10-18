import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyForm } from "@/components/ApplyForm";
import { Prose } from "@/components/Prose";
import { TYPE_LABELS } from "@/components/labels";
import { careersSettings, publicJob } from "@/lib/hire";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await publicJob((await params).slug);
  return { title: job ? job.title : "Job not found" };
}

/** One open job and its application form. */
export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  const [job, s] = await Promise.all([publicJob(slug), careersSettings()]);
  if (!job) notFound();
  return (
    <div className="pub">
      <div className="band" />
      <div className="pubwrap">
        <p className="small"><Link href="/careers">← All jobs{s.company ? ` at ${s.company}` : ""}</Link></p>
        <div className="pubhead">
          <h1>{job.title}</h1>
          <p className="muted">
            {[job.department, job.location, job.remote ? "Remote possible" : "", TYPE_LABELS[job.employment_type], job.salary].filter(Boolean).join(" · ")}
          </p>
        </div>
        {job.description && (
          <div className="box">
            <Prose text={job.description} />
          </div>
        )}
        <div className="box">
          <h2>Apply</h2>
          <ApplyForm slug={job.slug} />
        </div>
      </div>
    </div>
  );
}
