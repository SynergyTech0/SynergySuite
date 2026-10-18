import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { currentUser } from "@/lib/api";
import { certificate } from "@/lib/learn";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** A printable certificate for a finished course. */
export default async function Certificate({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  let cert: Awaited<ReturnType<typeof certificate>>;
  try {
    cert = await certificate(me, (await params).id);
  } catch (e) {
    if (e instanceof UserError && e.status === 404) notFound();
    if (e instanceof UserError) {
      return (
        <div className="pad">
          <h1>No certificate yet</h1>
          <p className="muted">{e.message}.</p>
        </div>
      );
    }
    throw e;
  }
  const org = process.env.LEARN_ORG_NAME || "";
  const on = cert.completedAt ? new Date(cert.completedAt).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" }) : "";
  return (
    <div className="certwrap">
      <div className="noprint actions" style={{ justifyContent: "center", padding: 16 }}>
        <a className="btn" href="/">Back to Learn</a>
        <PrintButton />
      </div>
      <div className="cert">
        <p className="certkicker">Certificate of completion</p>
        <p className="muted">This certifies that</p>
        <h1>{cert.learner}</h1>
        <p className="muted">has completed</p>
        <h2>{cert.course}</h2>
        <p className="muted">
          {cert.lessons} lesson{cert.lessons === 1 ? "" : "s"}{on ? ` · ${on}` : ""}
        </p>
        {org && <p className="certorg">{org}</p>}
      </div>
    </div>
  );
}
