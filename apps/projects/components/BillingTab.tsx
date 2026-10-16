"use client";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BillingPreview, Grouping } from "@/lib/billing";
import type { InvoiceRecord, Project } from "@/lib/types";
import { api, money, shortDate, todayStr } from "./client";
import { Confirm } from "./Modal";
import type { AppStatus } from "./ProjectsApp";

export function BillingTab({ project, status }: { project: Project; status: AppStatus }) {
  const [through, setThrough] = useState(todayStr());
  const [groupBy, setGroupBy] = useState<Grouping>("task");
  const [fee, setFee] = useState("");
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [history, setHistory] = useState<InvoiceRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [cancelling, setCancelling] = useState<InvoiceRecord | null>(null);
  const cur = project.currency;

  const load = useCallback(async () => {
    setError("");
    try {
      const qs = new URLSearchParams({ through, groupBy, ...(fee ? { fee } : {}) });
      setPreview(await api<BillingPreview>(`/api/projects/${project.id}/billing?${qs}`));
      setHistory(await api<InvoiceRecord[]>(`/api/projects/${project.id}/invoices`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project.id, through, groupBy, fee]);
  useEffect(() => {
    void load();
  }, [load]);

  const bill = async () => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const inv = await api<InvoiceRecord>(`/api/projects/${project.id}/billing`, { method: "POST", json: { through, groupBy, fee: fee || undefined } });
      setDone(inv.status === "sent" ? `Draft invoice ${inv.booksNumber} is in Books for review and sending.` : "Billing recorded. Download the lines to invoice the client.");
      setFee("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="body">
      <div className="toolbar">
        <label className="toolbar">Bill work up to <input className="cellin" type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></label>
        {project.billing === "time" && (
          <label className="toolbar">Lines by
            <select className="cellin" value={groupBy} onChange={(e) => setGroupBy(e.target.value as Grouping)}>
              <option value="task">Task</option><option value="person">Person</option><option value="entry">Each entry</option>
            </select>
          </label>
        )}
        {project.billing === "fixed" && (
          <label className="toolbar">Fee to bill now
            <input className="cellin" inputMode="decimal" style={{ width: 120 }} placeholder={preview ? String(Math.max(0, ((preview.feeCents ?? 0) - preview.feeBilledCents) / 100)) : ""}
              value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        )}
      </div>
      {project.billing === "fixed" && preview && (
        <p className="muted" style={{ margin: 0 }}>
          {money(preview.feeBilledCents, cur)} of the {money(preview.feeCents, cur)} fee billed so far. Time isn&apos;t billed on a fixed fee; billable expenses are.
        </p>
      )}
      {!status.books && (
        <p className="muted" style={{ margin: 0 }}>
          Books isn&apos;t connected (set BOOKS_SVC_TOKEN on Projects and Books), so billing is recorded here and you can download the lines.
        </p>
      )}
      <p className="error" role="alert">{error}</p>
      {done && <p className="ok" style={{ margin: 0 }}>{done}</p>}
      {preview && (
        !preview.lines.length ? <div className="empty">Nothing approved and unbilled up to {shortDate(through)}.</div> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Line</th><th className="num">Quantity</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td className="num">{l.kind === "time" ? `${l.quantity} h` : l.quantity}</td>
                    <td className="num">{money(l.unitCents, cur)}</td>
                    <td className="num">{money(l.amountCents, cur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(preview.totalCents, cur)}</td></tr></tfoot>
            </table>
          </div>
        )
      )}
      {preview && preview.lines.length > 0 && (
        <div className="toolbar">
          <span className="grow muted small">{status.books ? `Goes to Books as a draft invoice for ${project.clientName || project.clientEmail || "the client"}.` : ""}</span>
          <button className="btn primary" disabled={busy || preview.totalCents <= 0} onClick={() => void bill()}>
            <FileText size={15} /> {status.books ? "Create draft invoice in Books" : "Record billing"}
          </button>
        </div>
      )}
      <section>
        <h2>Billed</h2>
        {!history.length ? <p className="muted">Nothing billed yet.</p> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Billed on</th><th>Work up to</th><th>Invoice</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{shortDate(h.createdAt.slice(0, 10))}</td>
                    <td>{shortDate(h.throughDay)}</td>
                    <td>
                      {h.booksNumber ? (
                        <a className="linkbtn" href={h.booksUrl ?? "#"} target="_blank" rel="noreferrer">{h.booksNumber} in Books <ExternalLink size={12} /></a>
                      ) : <span className="muted">Recorded here</span>}
                    </td>
                    <td className="num">{money(h.totalCents, h.currency)}</td>
                    <td className="num">
                      <a className="iconbtn small" aria-label="Download lines" title="Download lines (CSV)" href={`/api/projects/${project.id}/invoices/${h.id}`}><Download size={14} /></a>
                      <button className="linkbtn" onClick={() => setCancelling(h)}>Undo</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {cancelling && (
        <Confirm
          title="Undo billing"
          action="Undo"
          danger
          message={cancelling.booksNumber
            ? <>Its time and expenses go back to unbilled here. Invoice {cancelling.booksNumber} stays in Books: delete or void it there.</>
            : <>Its time and expenses go back to unbilled.</>}
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            await api(`/api/projects/${project.id}/invoices/${cancelling.id}`, { method: "DELETE" });
            await load();
          }}
        />
      )}
    </div>
  );
}
