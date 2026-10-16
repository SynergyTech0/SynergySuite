"use client";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { STATUS_LABELS, api, money, relDays, shortDate } from "./client";
import type { ContractSummary, Me } from "./ContractsApp";

type Dash = {
  byStatus: Record<string, number>;
  activeValue: { currency: string; total: number }[];
  expiring: { d30: number; d60: number; d90: number };
  alerts: ContractSummary[];
  obligations: { id: string; title: string; due_day: string; assignee: string | null; contract_id: string; number: string; contract_title: string }[];
  approvals: { id: string; number: string; title: string; counterparty: string; requested_by: string; requested_at: string }[];
};

function daysFromToday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

export function Dashboard({ me, onOpen, onNew }: { me: Me; onOpen: (id: string) => void; onNew: () => void }) {
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Dash>("/api/dashboard").then(setD).catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <p className="pad error">{error}</p>;
  if (!d) return <p className="pad muted">Loading…</p>;
  const total = Object.values(d.byStatus).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Contracts</h1>
          <p className="sub muted">Drafts, approvals, signatures, renewals and what each contract commits you to.</p>
        </div>
      </div>
      <div className="body">
        {!total ? (
          <div className="empty">
            <p>No contracts yet, {me.name || me.email.split("@")[0]}.</p>
            <button className="btn primary" onClick={onNew}><Plus size={16} /> New contract</button>
          </div>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi"><span className="muted">In force</span><b>{d.byStatus.active}</b></div>
              <div className="kpi"><span className="muted">Being drafted or approved</span><b>{d.byStatus.draft + d.byStatus.review + d.byStatus.approved}</b></div>
              <div className="kpi"><span className="muted">Out for signature</span><b>{d.byStatus.signing}</b></div>
              <div className="kpi"><span className="muted">Ending in 30 / 60 / 90 days</span><b>{d.expiring.d30} / {d.expiring.d60} / {d.expiring.d90}</b></div>
              <div className="kpi">
                <span className="muted">Value in force</span>
                <b>{d.activeValue.length ? money(d.activeValue[0].total, d.activeValue[0].currency) : "None"}</b>
                {d.activeValue.slice(1).map((v) => <span key={v.currency} className="muted small">+ {money(v.total, v.currency)}</span>)}
              </div>
            </div>
            {d.approvals.length > 0 && (
              <section>
                <h2>Waiting for your approval</h2>
                <div className="tablewrap">
                  <table className="grid">
                    <tbody>
                      {d.approvals.map((a) => (
                        <tr key={a.id} className="click" onClick={() => onOpen(a.id)}>
                          <td><span className="muted small">{a.number}</span> {a.title}</td>
                          <td>{a.counterparty}</td>
                          <td className="muted">from {a.requested_by.split("@")[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <section>
              <h2>Renewal deadlines</h2>
              <p className="muted small" style={{ margin: "0 0 8px" }}>Contracts in force whose last day to give notice is within two weeks, or has passed.</p>
              {!d.alerts.length ? (
                <p className="muted">Nothing coming up.</p>
              ) : (
                <div className="tablewrap">
                  <table className="grid">
                    <thead><tr><th>Contract</th><th>Counterparty</th><th>Notice by</th><th>Ends</th><th>Renews</th></tr></thead>
                    <tbody>
                      {d.alerts.map((c) => {
                        const n = c.notice_day ? daysFromToday(c.notice_day) : null;
                        return (
                          <tr key={c.id} className="click" onClick={() => onOpen(c.id)}>
                            <td><span className="muted small">{c.number}</span> {c.title}</td>
                            <td>{c.counterparty}</td>
                            <td className={n !== null && n < 0 ? "error" : ""}>{shortDate(c.notice_day)} <span className="muted small">({relDays(n)})</span></td>
                            <td>{shortDate(c.end_day)}</td>
                            <td>{c.auto_renew ? "By itself" : "No"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2>Obligations due in 30 days</h2>
              {!d.obligations.length ? (
                <p className="muted">Nothing due.</p>
              ) : (
                <div className="tablewrap">
                  <table className="grid">
                    <thead><tr><th>Obligation</th><th>Contract</th><th>Due</th><th>Who</th></tr></thead>
                    <tbody>
                      {d.obligations.map((o) => {
                        const n = daysFromToday(o.due_day);
                        return (
                          <tr key={o.id} className="click" onClick={() => onOpen(o.contract_id)}>
                            <td>{o.title}</td>
                            <td><span className="muted small">{o.number}</span> {o.contract_title}</td>
                            <td className={n < 0 ? "error" : ""}>{shortDate(o.due_day)} <span className="muted small">({relDays(n)})</span></td>
                            <td className="muted">{o.assignee ? o.assignee.split("@")[0] : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2>By status</h2>
              <div className="toolbar">
                {Object.entries(d.byStatus).filter(([, n]) => n > 0).map(([s, n]) => (
                  <span key={s} className={`pill ${s}`}>{STATUS_LABELS[s]} {n}</span>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
