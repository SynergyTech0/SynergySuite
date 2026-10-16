"use client";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Posting } from "@/lib/types";
import { api, formatDate, formatDateTime, money, useData } from "./client";
import { Badge, label, type AppCtx } from "./shared";

type Data = { postings: Posting[]; connected: boolean; waiting: number; failed: number };

/** What Commerce has sent to Books, and anything still waiting or refused. */
export function Accounting({ app }: { app: AppCtx }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useData<Data>(`/api/postings?status=${status}`, [app.version]);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: number }>("/api/postings/retry", { method: "POST", json: {} });
      app.say(r.sent ? `${r.sent} sent to Books` : "Nothing new went through; see the reasons below");
      reload();
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Books</h1>
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Everything</option>
            <option value="pending">Waiting</option>
            <option value="failed">Failed</option>
            <option value="posted">Posted</option>
          </select>
          {app.manager && (
            <button className="btn" onClick={retry} disabled={busy || !data?.connected}>
              <RefreshCw size={15} /> Send now
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        Every sale, refund, delivery and stock adjustment becomes a journal entry in Books. Account numbers are set in Settings.
      </p>
      {data && !data.connected && <div className="notice warn">Books isn&apos;t connected: set BOOKS_INTERNAL_URL and BOOKS_SVC_TOKEN. Entries wait here until it is.</div>}
      {error && <p className="error">{error}</p>}
      {data && (
        <section className="panel">
          <h3>{data.waiting} waiting · {data.failed} failed</h3>
          {data.postings.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <table className="mini">
              <thead><tr><th>Date</th><th>Entry</th><th>Kind</th><th className="num">Amount</th><th>Status</th></tr></thead>
              <tbody>
                {data.postings.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td>
                      {p.description}
                      {p.status === "failed" && <div className="error small">{p.error}</div>}
                      {p.status === "posted" && p.booksRef && <div className="muted small">Books {p.booksRef} · {formatDateTime(p.postedAt)}</div>}
                    </td>
                    <td>{label(p.kind)}</td>
                    <td className="num">{money(p.total)}</td>
                    <td><Badge value={p.status} text={p.status === "pending" ? "Waiting" : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
