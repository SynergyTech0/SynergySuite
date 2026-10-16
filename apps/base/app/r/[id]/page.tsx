import { notFound } from "next/navigation";
import { PrintBar } from "@/components/PrintBar";
import { ReportBody } from "@/components/ReportBody";
import { HttpError } from "@/lib/http";
import { getReport, runReport } from "@/lib/reports";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A report on a page of its own, for printing or saving as PDF from the browser's print dialog. */
export default async function PrintReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) return <p className="signed-out">Sign in to see this report.</p>;
  const report = await getReport(id, me.email).catch((e) => {
    if ((e as HttpError).status === 404) notFound();
    throw e;
  });
  let data;
  try {
    data = await runReport(id, me.email);
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) return <p className="signed-out">{e.message}</p>;
    throw e;
  }
  return (
    <div className="print-page">
      <PrintBar landscape={report.layout.landscape} />
      <ReportBody data={data} landscape={report.layout.landscape} />
    </div>
  );
}
