import { notFound, redirect } from "next/navigation";
import { ContractText } from "@/components/ContractText";
import { PrintNow } from "@/components/PrintNow";
import { currentUser } from "@/lib/api";
import { getContract } from "@/lib/contracts";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** The contract as a clean page, for the browser's Print or Save as PDF (and for sending from Sign). */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const c = await getContract(me, (await params).id).catch((e) => {
    if (e instanceof UserError) notFound();
    throw e;
  });
  return (
    <div className="print">
      <PrintNow />
      <p className="muted small">{c.number}{c.status !== "active" ? ` · ${c.status === "draft" ? "Draft" : "Not yet signed"}` : ""}</p>
      <h1>{c.title}</h1>
      <ContractText body={c.body} />
      <div className="sigblocks">
        {[c.counterparty || "Counterparty", "Our company"].map((who) => (
          <div key={who}>
            <p><b>{who}</b></p>
            <p>Signature: ______________________</p>
            <p>Name: __________________________</p>
            <p>Date: ___________________________</p>
          </div>
        ))}
      </div>
    </div>
  );
}
