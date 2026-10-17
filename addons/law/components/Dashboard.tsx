"use client";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, hours, money, relDays, shortDate } from "./client";
import type { Go } from "./LawApp";
import type { AppInfo, Deadline, Me } from "./types";

type Dash = {
  openMatters: number; myMatters: number; deadlines: Deadline[]; weekMinutes: number; unbilledCents: number;
  pendingChecks: { id: string; names: string[]; hits: number; checked_by: string; checked_at: string }[];
  trust: { totalCents: number; overdue: { id: string; name: string; last: string | null; every: number }[]; booksFailed: number } | null;
};

export function Dashboard({ me, info, go, onNew }: { me: Me; info: AppInfo; go: Go; onNew: () => void }) {
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Dash>("/api/dashboard").then(setD).catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <p className="pad error">{error}</p>;
  if (!d) return <p className="pad muted">Loading…</p>;
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Law</h1>
          <p className="sub muted">Your matters, what&apos;s due, your time, and the firm&apos;s trust accounts.</p>
        </div>
      </div>
      <div className="body">
        {!d.openMatters ? (
          <div className="empty">
            <p>No open matters yet, {me.name || me.email.split("@")[0]}. Opening one starts with a conflict check.</p>
            <button className="btn primary" onClick={onNew}><Plus size={16} /> New matter</button>
          </div>
        ) : (
          <div className="kpis">
            <div className="kpi"><span className="muted">Your open matters</span><b>{d.myMatters}</b></div>
            <div className="kpi"><span className="muted">Open in the firm (that you can see)</span><b>{d.openMatters}</b></div>
            <div className="kpi"><span className="muted">Your hours this week</span><b>{hours(d.weekMinutes)}</b></div>
            <div className="kpi"><span className="muted">Your unbilled work</span><b>{money(d.unbilledCents)}</b></div>
            {d.trust && <div className="kpi"><span className="muted">Held in trust</span><b>{money(d.trust.totalCents)}</b></div>}
          </div>
        )}
        {d.trust && (d.trust.overdue.length > 0 || d.trust.booksFailed > 0) && (
          <section className="notice">
            {d.trust.overdue.map((a) => (
              <p key={a.id}>
                <b>{a.name}</b> needs reconciling: {a.last ? `last done for ${shortDate(a.last)}` : "never reconciled"}, and the rule is every {a.every} days.{" "}
                <button className="linkbtn" onClick={() => go.page("trust")}>Reconcile</button>
              </p>
            ))}
            {d.trust.booksFailed > 0 && <p>{d.trust.booksFailed} trust entries didn&apos;t reach Books. Open Trust accounts to send them again.</p>}
          </section>
        )}
        <section>
          <h2>Due in the next two weeks</h2>
          {!d.deadlines.length ? (
            <p className="muted">Nothing due.</p>
          ) : (
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>Due</th><th>What</th><th>Matter</th><th>Who</th></tr></thead>
                <tbody>
                  {d.deadlines.map((x) => (
                    <tr key={x.id} className="click" onClick={() => go.matter(x.matter_id, "deadlines")}>
                      <td className={x.days_left < 0 ? "error" : x.days_left <= 3 ? "warn" : ""}>{shortDate(x.due_day)} <span className="muted small">({relDays(x.days_left)})</span></td>
                      <td>{x.title}{x.basis && <div className="muted small">{x.basis}</div>}</td>
                      <td><span className="muted small">{x.number}</span> {x.matter_title}</td>
                      <td className="muted">{x.assignee ? x.assignee.split("@")[0] : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {d.pendingChecks.length > 0 && (
          <section>
            <h2>Conflict checks waiting for a decision</h2>
            <div className="tablewrap">
              <table className="grid">
                <tbody>
                  {d.pendingChecks.map((c) => (
                    <tr key={c.id} className="click" onClick={() => go.page("conflicts")}>
                      <td>{c.names.join(", ")}</td>
                      <td>{c.hits} possible {c.hits === 1 ? "match" : "matches"}</td>
                      <td className="muted">{shortDate(c.checked_at.slice(0, 10))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {!info.ai && <p className="muted small">AI reading of case documents is off. An administrator can turn it on with the AI settings.</p>}
      </div>
    </>
  );
}
